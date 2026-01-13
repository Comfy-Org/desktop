import { app } from 'electron';
import log from 'electron-log/main';
import pty from 'node-pty';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import os, { EOL } from 'node:os';
import path from 'node:path';

import {
  AMD_ROCM_SDK_PACKAGES,
  AMD_TORCH_PACKAGES,
  InstallStage,
  LEGACY_NVIDIA_TORCH_MIRROR,
  NVIDIA_TORCHVISION_VERSION,
  NVIDIA_TORCH_PACKAGES,
  NVIDIA_TORCH_VERSION,
  TorchMirrorUrl,
} from './constants';
import { PythonImportVerificationError } from './infrastructure/pythonImportVerificationError';
import { useAppState } from './main-process/appState';
import { createInstallStageInfo } from './main-process/installStages';
import type { TorchDeviceType } from './preload';
import { runPythonImportVerifyScript } from './services/pythonImportVerifier';
import { captureSentryException } from './services/sentry';
import { HasTelemetry, ITelemetry, trackEvent } from './services/telemetry';
import { getDefaultShell, getDefaultShellArgs } from './shell/util';
import { compareVersions, pathAccessible } from './utils';

export type ProcessCallbacks = {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

/** An environment that can run Python commands. */
export interface PythonExecutor {
  runPythonCommandAsync(
    args: string[],
    callbacks?: ProcessCallbacks,
    env?: NodeJS.ProcessEnv,
    cwd?: string
  ): Promise<{ exitCode: number | null }>;
}

interface PipInstallConfig {
  packages: string[];
  indexUrl?: string;
  extraIndexUrl?: string;
  prerelease?: boolean;
  upgradePackages?: boolean;
  requirementsFile?: string;
  indexStrategy?: 'compatible' | 'unsafe-best-match';
}

type TorchPackageName = 'torch' | 'torchaudio' | 'torchvision';
type TorchPackageVersions = Record<TorchPackageName, string | undefined>;

const TORCH_PACKAGE_NAMES: TorchPackageName[] = ['torch', 'torchaudio', 'torchvision'];

function getPipInstallArgs(config: PipInstallConfig): string[] {
  const installArgs = ['pip', 'install'];

  if (config.upgradePackages) {
    installArgs.push('-U');
  }

  if (config.prerelease) {
    installArgs.push('--pre');
  }

  if (config.requirementsFile) {
    installArgs.push('-r', config.requirementsFile);
  } else {
    installArgs.push(...config.packages);
  }

  if (config.indexUrl) {
    installArgs.push('--index-url', config.indexUrl);
  }

  if (config.extraIndexUrl) {
    installArgs.push('--extra-index-url', config.extraIndexUrl);
  }

  if (config.indexStrategy) {
    installArgs.push('--index-strategy', config.indexStrategy);
  }

  return installArgs;
}

/**
 * Returns the default torch mirror for the given device.
 * @param device The device type
 * @returns The default torch mirror
 */
function getDefaultTorchMirror(device: TorchDeviceType): string {
  log.debug('Falling back to default torch mirror');
  switch (device) {
    case 'mps':
      return TorchMirrorUrl.NightlyCpu;
    case 'nvidia':
      return TorchMirrorUrl.Cuda;
    default:
      return TorchMirrorUrl.Default;
  }
}

/** Disallows using the default mirror (CPU torch) when the selected device is not CPU. */
function fixDeviceMirrorMismatch(device: TorchDeviceType, mirror: string | undefined) {
  if (mirror === TorchMirrorUrl.Default) {
    if (device === 'nvidia') return TorchMirrorUrl.Cuda;
    else if (device === 'mps') return TorchMirrorUrl.NightlyCpu;
  }
  if (device === 'nvidia' && mirror === LEGACY_NVIDIA_TORCH_MIRROR) {
    return TorchMirrorUrl.Cuda;
  }
  return mirror;
}

/**
 * Manages a virtual Python environment using uv.
 *
 * Maintains its own node-pty instance; output from this is piped to the virtual terminal.
 * @todo Split either installation or terminal management to a separate class.
 */
export class VirtualEnvironment implements HasTelemetry, PythonExecutor {
  readonly basePath: string;
  readonly venvPath: string;
  readonly pythonVersion: string;
  readonly uvPath: string;
  readonly requirementsCompiledPath: string;
  readonly cacheDir: string;
  readonly pythonInterpreterPath: string;
  readonly comfyUIRequirementsPath: string;
  readonly comfyUIManagerRequirementsPath: string;
  readonly legacyComfyUIManagerRequirementsPath: string;
  readonly selectedDevice: TorchDeviceType;
  readonly telemetry: ITelemetry;
  readonly pythonMirror?: string;
  readonly pypiMirror?: string;
  readonly torchMirror?: string;
  uvPty: pty.IPty | undefined;

  /** The environment variables to set for uv. */
  get uvEnv() {
    return {
      VIRTUAL_ENV: this.venvPath,
      // Empty strings are not valid values for these env vars,
      // dropping them here to avoid passing them to uv.
      // `node-pty` does not support `undefined`.
      ...(this.pythonMirror ? { UV_PYTHON_INSTALL_MIRROR: this.pythonMirror } : {}),
    };
  }

  /** @todo Refactor to `using` */
  get uvPtyInstance() {
    const env = {
      ...process.env,
      ...this.uvEnv,
    };

    if (!this.uvPty) {
      const debugging = process.env.NODE_DEBUG === 'true';
      const shell = getDefaultShell();
      this.uvPty = pty.spawn(shell, getDefaultShellArgs(), {
        useConpty: !debugging,
        handleFlowControl: false,
        conptyInheritCursor: false,
        name: 'xterm',
        cwd: this.basePath,
        env,
      });
    }
    return this.uvPty;
  }

  constructor(
    basePath: string,
    {
      telemetry,
      selectedDevice,
      pythonVersion,
      pythonMirror,
      pypiMirror,
      torchMirror,
    }: {
      telemetry: ITelemetry;
      selectedDevice?: TorchDeviceType;
      pythonVersion?: string;
      pythonMirror?: string;
      pypiMirror?: string;
      torchMirror?: string;
    }
  ) {
    this.basePath = basePath;
    this.telemetry = telemetry;
    this.pythonVersion = pythonVersion ?? '3.12';
    this.selectedDevice = selectedDevice ?? 'cpu';
    this.pythonMirror = pythonMirror;
    this.pypiMirror = pypiMirror;
    this.torchMirror = fixDeviceMirrorMismatch(selectedDevice!, torchMirror);

    // uv defaults to .venv
    this.venvPath = path.join(basePath, '.venv');
    const resourcesPath = app.isPackaged ? path.join(process.resourcesPath) : path.join(app.getAppPath(), 'assets');
    this.comfyUIRequirementsPath = path.join(resourcesPath, 'ComfyUI', 'requirements.txt');
    const managerRequirementsPath = path.join(resourcesPath, 'ComfyUI', 'manager_requirements.txt');
    this.legacyComfyUIManagerRequirementsPath = path.join(
      resourcesPath,
      'ComfyUI',
      'custom_nodes',
      'ComfyUI-Manager',
      'requirements.txt'
    );
    this.comfyUIManagerRequirementsPath = this.resolveManagerRequirementsPath(
      managerRequirementsPath,
      this.legacyComfyUIManagerRequirementsPath
    );

    this.cacheDir = path.join(basePath, 'uv-cache');

    const filename = `${compiledRequirements()}.compiled`;
    this.requirementsCompiledPath = path.join(resourcesPath, 'requirements', filename);

    this.pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.venvPath, 'Scripts', 'python.exe')
        : path.join(this.venvPath, 'bin', 'python');

    const uvFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'uv')
      : path.join(app.getAppPath(), 'assets', 'uv');

    switch (process.platform) {
      case 'win32':
        this.uvPath = path.join(uvFolder, 'win', 'uv.exe');
        break;
      case 'linux':
        this.uvPath = path.join(uvFolder, 'linux', 'uv');
        break;
      case 'darwin':
        this.uvPath = path.join(uvFolder, 'macos', 'uv');
        break;
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
    log.info(`Using uv at ${this.uvPath}`);

    function compiledRequirements() {
      if (process.platform === 'darwin') return 'macos';
      if (process.platform === 'win32') {
        if (selectedDevice === 'cpu') return 'windows_cpu';
        if (selectedDevice === 'amd') return 'windows_amd';
        return 'windows_nvidia';
      }
    }
  }

  private resolveManagerRequirementsPath(primary: string, legacy: string) {
    if (existsSync(primary)) return primary;
    if (existsSync(legacy)) return legacy;
    return primary;
  }

  public async create(callbacks?: ProcessCallbacks): Promise<void> {
    try {
      await this.createEnvironment(callbacks);
    } finally {
      const pid = this.uvPty?.pid;
      if (pid) {
        process.kill(pid);
        this.uvPty = undefined;
      }
    }
  }

  /**
   * Activates the virtual environment.
   */
  public activateEnvironmentCommand(): string {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      return `source "${this.venvPath}/bin/activate"${EOL}`;
    }
    if (process.platform === 'win32') {
      return `Set-ExecutionPolicy Unrestricted -Scope Process -Force${EOL}& "${this.venvPath}\\Scripts\\activate.ps1"${EOL}Set-ExecutionPolicy Default -Scope Process -Force${EOL}`;
    }
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  /**
   * Creates the virtual environment if it does not exist.
   * Will add any missing requirements to an existing venv.
   * Designed for installation rather than troubleshooting.
   * @param callbacks - The callbacks to use for the installation.
   * @returns A promise that resolves when the virtual environment is created.
   */
  private async createEnvironment(callbacks?: ProcessCallbacks): Promise<void> {
    this.telemetry.track(`install_flow:virtual_environment_create_start`, {
      python_version: this.pythonVersion,
      device: this.selectedDevice,
    });
    if (this.selectedDevice === 'unsupported') {
      log.info('User elected to manually configure their environment.  Skipping python configuration.');
      this.telemetry.track(`install_flow:virtual_environment_create_end`, {
        reason: 'unsupported_device',
      });
      return;
    }

    try {
      // Gracefully handle existing / partial venvs
      if (await this.exists()) {
        log.info('Virtual environment directory already exists: ', this.venvPath);

        const requirementsStatus = await this.hasRequirements();

        if (requirementsStatus === 'OK') {
          log.info('Skipping requirements installation - all requirements already installed');
        } else {
          log.info('Starting manual install - venv missing requirements');
          await this.manualInstall(callbacks);
        }

        // Verify python imports actually work (limited set / common failures)
        const importsOk = await this.verifyPythonImports();
        if (importsOk) {
          this.telemetry.track(`install_flow:virtual_environment_create_end`, { reason: 'already_exists' });
          return;
        }

        // Python imports failed
        throw new PythonImportVerificationError(
          'We were unable to verify the state of your Python virtual environment. This will likely prevent ComfyUI from starting.'
        );
      }

      await this.createVenvWithPython(callbacks);
      await this.ensurePip(callbacks);
      await this.installRequirements(callbacks);
      this.telemetry.track('install_flow:virtual_environment_create_end', {
        reason: 'success',
      });
      log.info('Successfully created virtual environment at', this.venvPath);
    } catch (error) {
      const errorEventName = 'install_flow:virtual_environment_create_error';
      const sentryUrl = captureSentryException(
        error instanceof Error ? error : new Error(String(error)),
        errorEventName
      );
      this.telemetry.track(errorEventName, {
        error_name: error instanceof Error ? error.name : 'UnknownError',
        error_type: error instanceof Error ? error.constructor.name : typeof error,
        error_message: error instanceof Error ? error.message : 'Unknown error occurred',
        sentry_url: sentryUrl,
      });
      log.error('Error creating virtual environment:', error);
      throw error;
    }
  }

  /**
   * Uses `uv` to create a virtual environment with a managed python interpreter.
   * @param callbacks The callbacks to use for the command.
   */
  @trackEvent('install_flow:virtual_environment_create_python')
  public async createVenvWithPython(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Creating virtual environment at ${this.venvPath} with python ${this.pythonVersion}`);
    const args = ['venv', '--python', this.pythonVersion, '--python-preference', 'only-managed'];
    const { exitCode } = await this.runUvCommandAsync(args, callbacks);

    if (exitCode !== 0) {
      throw new Error(`Failed to create virtual environment: exit code ${exitCode}`);
    }
  }

  /**
   * Uses `ensurepip` to upgrade pip in the virtual environment.
   * @param callbacks The callbacks to use for the command.
   */
  @trackEvent('install_flow:virtual_environment_ensurepip')
  public async ensurePip(callbacks?: ProcessCallbacks): Promise<void> {
    const { exitCode } = await this.runPythonCommandAsync(['-m', 'ensurepip', '--upgrade'], callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to upgrade pip: exit code ${exitCode}`);
    }
  }

  /**
   * Installs the requirements for the virtual environment, preferring the compiled requirements where possible.
   *
   * Falls back to regular `pip install` commands if the compiled requirements are not available or fail for any reason.
   * @param callbacks The callbacks to use for the command.
   */
  @trackEvent('install_flow:virtual_environment_install_requirements')
  public async installRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    useAppState().setInstallStage(createInstallStageInfo(InstallStage.INSTALLING_REQUIREMENTS, { progress: 25 }));

    const installCmd = getPipInstallArgs({
      requirementsFile: this.requirementsCompiledPath,
      indexStrategy: 'unsafe-best-match',
      packages: [],
      indexUrl: this.pypiMirror,
      extraIndexUrl: this.pypiMirror ? TorchMirrorUrl.Default : undefined,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      log.error(
        `Failed to install requirements.compiled: exit code ${exitCode}. Falling back to installing requirements.txt`
      );
      return this.manualInstall(callbacks);
    }

    // Ensure Manager requirements are installed even if the compiled file did not include them.
    await this.installComfyUIManagerRequirements(callbacks);
  }

  /**
   * Runs a python command using the virtual environment's python interpreter.
   * @param args
   * @returns
   */
  public runPythonCommand(args: string[], callbacks?: ProcessCallbacks): ChildProcess {
    const pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.venvPath, 'Scripts', 'python.exe')
        : path.join(this.venvPath, 'bin', 'python');

    return this.runCommand(
      pythonInterpreterPath,
      args,
      {
        PYTHONIOENCODING: 'utf8',
      },
      callbacks
    );
  }

  /**
   * Runs a python command using the virtual environment's python interpreter and returns a promise with the exit code.
   * @param args
   * @returns
   */
  public async runPythonCommandAsync(
    args: string[],
    callbacks?: ProcessCallbacks,
    env?: NodeJS.ProcessEnv,
    cwd?: string
  ): Promise<{ exitCode: number | null }> {
    return this.runCommandAsync(
      this.pythonInterpreterPath,
      args,
      {
        ...env,
        PYTHONIOENCODING: 'utf8',
      },
      callbacks,
      cwd
    );
  }

  /**
   * Runs uv with the virtual environment env var set.
   * @param args The arguments to pass to uv.
   * @param callbacks The callbacks to use for the command.
   * @returns A promise with the exit code and signal.
   */
  private async runUvAsync(
    args: string[],
    callbacks?: ProcessCallbacks
  ): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
    log.info('Running uv child process: uv', args.join(' '));

    return this.runCommandAsync(this.uvPath, args, this.uvEnv, callbacks);
  }

  /**
   * Runs a uv command inside a managed, interactive shell. The virtual environment is set to this instance's venv.
   * @param args
   * @returns A promise with the exit code.
   */
  private async runUvCommandAsync(args: string[], callbacks?: ProcessCallbacks): Promise<{ exitCode: number | null }> {
    const uvCommand = os.platform() === 'win32' ? `& "${this.uvPath}"` : this.uvPath;
    const command = `${uvCommand} ${args.map((a) => `"${a}"`).join(' ')}`;
    log.info('Running uv command:', command);
    return this.runPtyCommandAsync(command, callbacks?.onStdout);
  }

  /**
   * Runs a command inside a managed, interactive shell. The shell can be reused for multiple commands.
   * @param command The command to run.
   * @param onData The callback to use for all output data.
   * @returns A promise with the exit code.
   */
  private async runPtyCommandAsync(command: string, onData?: (data: string) => void): Promise<{ exitCode: number }> {
    function hasExited(data: string, endMarker: string): string | undefined {
      // Remove ansi sequences to see if this the exit marker
      const lines = data.replaceAll(/\u001B\[[\d;?]*[A-Za-z]/g, '').split(/(\r\n|\n)/);
      for (const line of lines) {
        if (line.startsWith(endMarker)) {
          return line.substring(endMarker.length).trim();
        }
      }
    }

    function parseExitCode(exit: string): number {
      // Powershell outputs True / False for success
      if (exit === 'True') return 0;
      if (exit === 'False') return -999;
      // Bash should output a number
      const exitCode = Number.parseInt(exit);
      if (Number.isNaN(exitCode)) {
        console.warn('Unable to parse exit code:', exit);
        return -998;
      }
      return exitCode;
    }

    const id = Date.now();
    return new Promise((res) => {
      const endMarker = `_-end-${id}:`;
      const input = `${command}\recho "${endMarker}$?"`;
      const dataReader = this.uvPtyInstance.onData((data) => {
        onData?.(data);

        const exit = hasExited(data, endMarker);
        if (!exit) return;

        dataReader.dispose();
        res({ exitCode: parseExitCode(exit) });
      });
      this.uvPtyInstance.write(`${input}\r`);
    });
  }

  /**
   * Starts a process, piping all output to the {@link callbacks}.
   * @param command The command to run.
   * @param args The arguments to pass to the command.
   * @param env The environment variables to set for the command. Overrides process.env.
   * @param callbacks The callbacks to use for the command.
   * @param cwd The working directory for the command.
   * @returns The child process created by running {@link command} with {@link args}.
   */
  private runCommand(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    callbacks?: ProcessCallbacks,
    cwd: string = this.basePath
  ): ChildProcess {
    log.info(`Running command: ${command} ${args.join(' ')} in ${cwd}`);
    const childProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
    });

    if (callbacks) {
      childProcess.stdout.on('data', (data: Buffer) => {
        console.log(data.toString());
        callbacks.onStdout?.(data.toString());
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        console.log(data.toString());
        callbacks.onStderr?.(data.toString());
      });
    }

    return childProcess;
  }

  /**
   * Runs a command asynchronously, returning a promise with the exit code and signal.
   * @param command The command to run.
   * @param args The arguments to pass to the command.
   * @param env The environment variables to set for the command. Overrides
   * @param callbacks The callbacks to use for the command.
   * @param cwd The working directory for the command.
   * @returns A promise with the exit code and signal.
   */
  private async runCommandAsync(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    callbacks?: ProcessCallbacks,
    cwd?: string
  ): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      const childProcess = this.runCommand(command, args, env, callbacks, cwd);

      childProcess.on('close', (code, signal) => {
        resolve({ exitCode: code, signal });
      });

      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Installs PyTorch, ComfyUI core, and ComfyUI Manager, using pip install rather than compiled requirements.
   * @param callbacks The callbacks to use for the command.
   */
  private async manualInstall(callbacks?: ProcessCallbacks): Promise<void> {
    await this.installPytorch(callbacks);
    await this.installComfyUIRequirements(callbacks);
    await this.installComfyUIManagerRequirements(callbacks);
  }

  /**
   * Installs PyTorch, using `pip install` with direct package names.
   * @param callbacks The callbacks to use for the command.
   */
  async installPytorch(callbacks?: ProcessCallbacks): Promise<void> {
    useAppState().setInstallStage(
      createInstallStageInfo(InstallStage.INSTALLING_PYTORCH, {
        progress: 25,
        message: 'Installing PyTorch',
      })
    );

    if (this.selectedDevice === 'amd') {
      await this.installAmdRocmSdk(callbacks);
      await this.installAmdTorch(callbacks);
      return;
    }

    const torchMirror = this.torchMirror || getDefaultTorchMirror(this.selectedDevice);
    const config: PipInstallConfig = {
      packages: ['torch', 'torchvision', 'torchaudio'],
      indexUrl: torchMirror,
      prerelease: torchMirror.includes('nightly'),
    };

    const installArgs = getPipInstallArgs(config);

    log.info('Installing PyTorch with config:', config);
    const { exitCode } = await this.runUvCommandAsync(installArgs, callbacks);

    if (exitCode !== 0) {
      throw new Error(`Failed to install PyTorch: exit code ${exitCode}`);
    }
  }

  /**
   * Ensures NVIDIA installs use the recommended PyTorch packages.
   * @param callbacks The callbacks to use for the command.
   */
  async ensureRecommendedNvidiaTorch(callbacks?: ProcessCallbacks): Promise<void> {
    if (this.selectedDevice !== 'nvidia') return;

    const installedVersions = await this.getInstalledTorchPackageVersions();
    if (installedVersions && this.meetsMinimumNvidiaTorchVersions(installedVersions)) {
      log.info('NVIDIA PyTorch packages already satisfy minimum recommended versions.', installedVersions);
      return;
    }

    const torchMirror = this.torchMirror || getDefaultTorchMirror(this.selectedDevice);
    const config: PipInstallConfig = {
      packages: NVIDIA_TORCH_PACKAGES,
      indexUrl: torchMirror,
      prerelease: torchMirror.includes('nightly'),
    };

    const installArgs = getPipInstallArgs(config);
    log.info('Installing recommended NVIDIA PyTorch packages.', { installedVersions });
    const { exitCode: pinnedExitCode } = await this.runUvCommandAsync(installArgs, callbacks);

    if (pinnedExitCode === 0) return;

    log.warn('Failed to install recommended NVIDIA PyTorch packages. Falling back to unpinned install.', {
      exitCode: pinnedExitCode,
    });

    const fallbackConfig: PipInstallConfig = {
      packages: ['torch', 'torchvision', 'torchaudio'],
      indexUrl: torchMirror,
      prerelease: torchMirror.includes('nightly'),
      upgradePackages: true,
    };
    const fallbackArgs = getPipInstallArgs(fallbackConfig);
    const { exitCode: fallbackExitCode } = await this.runUvCommandAsync(fallbackArgs, callbacks);
    if (fallbackExitCode !== 0) {
      throw new Error(
        `Failed to install NVIDIA PyTorch packages (pinned exit ${pinnedExitCode}, fallback exit ${fallbackExitCode})`
      );
    }
  }

  /**
   * Reads installed torch package versions using `uv pip list --format=json`.
   * @returns The torch package versions when available, otherwise `undefined`.
   */
  private async getInstalledTorchPackageVersions(): Promise<TorchPackageVersions | undefined> {
    let stdout = '';
    let stderr = '';
    const callbacks: ProcessCallbacks = {
      onStdout: (data) => {
        stdout += data;
      },
      onStderr: (data) => {
        stderr += data;
      },
    };

    const { exitCode } = await this.runUvAsync(['pip', 'list', '--format=json', '--color=never'], callbacks);

    if (exitCode !== 0) {
      log.warn('Failed to read torch package versions.', { exitCode, stderr });
      return undefined;
    }

    if (!stdout.trim()) {
      log.warn('Torch package list output was empty.', { stderr });
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      log.warn('Failed to parse torch package list output.', { error, stdout, stderr });
      return undefined;
    }

    if (!Array.isArray(parsed)) {
      log.warn('Torch package list output was not an array.', { stdout, stderr });
      return undefined;
    }

    const versions: TorchPackageVersions = {
      torch: undefined,
      torchaudio: undefined,
      torchvision: undefined,
    };
    let matched = 0;
    const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

    for (const entry of parsed) {
      if (!isRecord(entry)) continue;
      const name = entry.name;
      const version = entry.version;
      if (typeof name !== 'string' || typeof version !== 'string') continue;
      const packageName = TORCH_PACKAGE_NAMES.find((pkg) => pkg === name.trim().toLowerCase());
      if (!packageName) continue;
      matched += 1;
      versions[packageName] = version.trim() || undefined;
    }
    if (matched === 0) {
      log.warn('Torch package list did not contain expected packages.', { stdout, stderr });
      return undefined;
    }

    return versions;
  }

  /**
   * Installs AMD ROCm SDK packages on Windows.
   * @param callbacks The callbacks to use for the command.
   */
  private async installAmdRocmSdk(callbacks?: ProcessCallbacks): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('AMD ROCm packages are currently supported only on Windows.');
    }

    const installArgs = getPipInstallArgs({
      packages: AMD_ROCM_SDK_PACKAGES,
    });

    log.info('Installing AMD ROCm SDK packages.');
    const { exitCode } = await this.runUvCommandAsync(installArgs, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install AMD ROCm SDK packages: exit code ${exitCode}`);
    }
  }

  /**
   * Installs AMD ROCm PyTorch wheels on Windows.
   * @param callbacks The callbacks to use for the command.
   */
  private async installAmdTorch(callbacks?: ProcessCallbacks): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('AMD ROCm packages are currently supported only on Windows.');
    }

    const installArgs = getPipInstallArgs({
      packages: AMD_TORCH_PACKAGES,
    });

    log.info('Installing AMD ROCm PyTorch packages.');
    const { exitCode } = await this.runUvCommandAsync(installArgs, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install AMD ROCm PyTorch packages: exit code ${exitCode}`);
    }
  }

  /**
   * Installs the requirements for ComfyUI core using `requirements.txt`.
   * @param callbacks The callbacks to use for the command.
   */
  async installComfyUIRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    useAppState().setInstallStage(
      createInstallStageInfo(InstallStage.INSTALLING_COMFYUI_REQUIREMENTS, {
        progress: 45,
        message: 'Installing ComfyUI requirements',
      })
    );

    log.info(`Installing ComfyUI requirements from ${this.comfyUIRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
      extraIndexUrl: this.pypiMirror ? TorchMirrorUrl.Default : undefined,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install ComfyUI requirements.txt: exit code ${exitCode}`);
    }
  }

  /**
   * Installs the requirements for ComfyUI Manager using `requirements.txt`.
   * @param callbacks The callbacks to use for the command.
   */
  async installComfyUIManagerRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    useAppState().setInstallStage(
      createInstallStageInfo(InstallStage.INSTALLING_MANAGER_REQUIREMENTS, {
        progress: 60,
        message: 'Installing ComfyUI Manager requirements',
      })
    );

    if (!(await pathAccessible(this.comfyUIManagerRequirementsPath))) {
      throw new Error(
        `Manager requirements file was not found at ${this.comfyUIManagerRequirementsPath}. ` +
          `If you are using a legacy build, ensure the ComfyUI-Manager custom node is present at ${this.legacyComfyUIManagerRequirementsPath}.`
      );
    }

    log.info(`Installing ComfyUIManager requirements from ${this.comfyUIManagerRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIManagerRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
      extraIndexUrl: this.pypiMirror ? TorchMirrorUrl.Default : undefined,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install ComfyUI-Manager requirements.txt: exit code ${exitCode}`);
    }
  }

  /**
   * Checks if the virtual environment exists.
   * @returns `true` if the virtual environment exists, otherwise `false`.
   */
  async exists(): Promise<boolean> {
    const pathExists = await pathAccessible(this.venvPath);
    if (!pathExists) return false;

    try {
      const entries = await readdir(this.venvPath);
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Checks if the virtual environment has all the required packages of ComfyUI core.
   *
   * Parses the text output of `uv pip install --dry-run -r requirements.txt`.
   * @returns `'OK'` if pip install does not detect any missing packages,
   * `'manager-upgrade'` if `uv` and `toml` are missing,
   * or `'error'` when any other combination of packages are missing.
   */
  async hasRequirements(): Promise<'OK' | 'error' | 'package-upgrade'> {
    const checkRequirements = async (requirementsPath: string) => {
      const args = ['pip', 'install', '--dry-run', '-r', requirementsPath];
      log.info(`Running uv command directly: ${args.join(' ')}`);

      // Get packages as json string
      let output = '';
      const callbacks: ProcessCallbacks = {
        onStdout: (data) => (output += data.toString()),
        onStderr: (data) => (output += data.toString()),
      };
      const result = await this.runUvAsync(args, callbacks);

      if (result.exitCode !== 0)
        throw new Error(`Failed to get packages: Exit code ${result.exitCode}, signal ${result.signal}`);
      if (!output) throw new Error('Failed to get packages: uv output was empty');

      return output;
    };

    const hasAllPackages = (output: string) => {
      const venvOk = output.search(/\bWould make no changes\s+$/) !== -1;
      if (!venvOk) log.warn(output);
      return venvOk;
    };

    // Manager upgrade in 0.4.18 - uv, toml (exactly)
    const isManagerUpgrade = (output: string) => {
      // Match the original case: 2 packages (uv + toml) | Added in https://github.com/ltdrdata/ComfyUI-Manager/commit/816a53a7b1a057af373c458ebf80aaae565b996b
      // Match the new case: 1 package (chardet) | Added in https://github.com/ltdrdata/ComfyUI-Manager/commit/60a5e4f2614c688b41a1ebaf0694953eb26db38a
      const anyCombination = /\bWould install [1-3] packages?(\s+\+ (toml|uv|chardet)==[\d.]+){1,3}\s*$/;
      return anyCombination.test(output);
    };

    // Package upgrade in 0.4.21 - aiohttp, av, yarl
    const isCoreUpgrade = (output: string) => {
      const lines = output.split('\n');
      let adds = 0;
      for (const line of lines) {
        // Reject upgrade if removing an unrecognised package
        if (
          line.search(
            /^\s*- (?!aiohttp|av|yarl|comfyui-workflow-templates|comfyui-embedded-docs|pydantic|pydantic-core|pydantic-settings|annotated-types|typing-inspection|alembic|sqlalchemy|greenlet|mako|python-dotenv).*==/
          ) !== -1
        )
          return false;
        if (line.search(/^\s*\+ /) !== -1) {
          if (
            line.search(
              /^\s*\+ (aiohttp|av|yarl|comfyui-workflow-templates|comfyui-embedded-docs|pydantic|pydantic-core|pydantic-settings|annotated-types|typing-inspection|alembic|sqlalchemy|greenlet|mako|python-dotenv)==/
            ) === -1
          )
            return false;
          adds++;
        }
        // An unexpected package means this is not a package upgrade
      }
      return adds > 0;
    };

    const coreOutput = await checkRequirements(this.comfyUIRequirementsPath);
    if (!(await pathAccessible(this.comfyUIManagerRequirementsPath))) {
      throw new Error(
        `Manager requirements file was not found at ${this.comfyUIManagerRequirementsPath}. ` +
          `If you are using a legacy build, ensure the ComfyUI-Manager custom node is present at ${this.legacyComfyUIManagerRequirementsPath}.`
      );
    }
    const managerOutput = await checkRequirements(this.comfyUIManagerRequirementsPath);

    const coreOk = hasAllPackages(coreOutput);
    const managerOk = hasAllPackages(managerOutput);

    const upgradeCore = !coreOk && isCoreUpgrade(coreOutput);
    const upgradeManager = !managerOk && isManagerUpgrade(managerOutput);

    if ((managerOk && upgradeCore) || (coreOk && upgradeManager) || (upgradeCore && upgradeManager)) {
      log.info('Package update of known packages required. Core:', upgradeCore, 'Manager:', upgradeManager);
      return 'package-upgrade';
    }

    if (!coreOk || !managerOk) {
      log.info('Requirements are out of date. Treating as package upgrade.', {
        coreOk,
        managerOk,
        upgradeCore,
        upgradeManager,
      });
      return 'package-upgrade';
    }

    if (await this.needsNvidiaTorchUpgrade()) {
      log.info('NVIDIA PyTorch version out of date. Treating as package upgrade.');
      return 'package-upgrade';
    }

    log.debug('hasRequirements result:', 'OK');
    return 'OK';
  }

  /**
   * Returns `true` when NVIDIA PyTorch should be upgraded to the recommended version.
   * @returns `true` when NVIDIA PyTorch is out of date, otherwise `false`.
   */
  private async needsNvidiaTorchUpgrade(): Promise<boolean> {
    if (this.selectedDevice !== 'nvidia') return false;

    const installedVersions = await this.getInstalledTorchPackageVersions();
    if (!installedVersions) {
      log.warn('Unable to read NVIDIA torch package versions. Skipping NVIDIA torch upgrade check.');
      return false;
    }

    return !this.meetsMinimumNvidiaTorchVersions(installedVersions);
  }

  private meetsMinimumNvidiaTorchVersions(installedVersions: TorchPackageVersions): boolean {
    const torch = installedVersions.torch;
    const torchaudio = installedVersions.torchaudio;
    const torchvision = installedVersions.torchvision;
    if (!torch || !torchaudio || !torchvision) return false;

    const requiredCudaTag = '+cu130';
    if (
      !torch.includes(requiredCudaTag) ||
      !torchaudio.includes(requiredCudaTag) ||
      !torchvision.includes(requiredCudaTag)
    )
      return false;

    if (compareVersions(torch, NVIDIA_TORCH_VERSION) < 0) return false;
    if (compareVersions(torchaudio, NVIDIA_TORCH_VERSION) < 0) return false;
    if (compareVersions(torchvision, NVIDIA_TORCHVISION_VERSION) < 0) return false;

    return true;
  }

  /**
   * Verifies that the Python environment can import modules that frequently show up in errors.
   * @returns `true` if the Python environment successfully imports the modules, otherwise `false`.
   */
  async verifyPythonImports(): Promise<boolean> {
    const verification = await runPythonImportVerifyScript(this, [
      'yaml',
      'torch',
      'uv',
      'toml',
      'numpy',
      'PIL',
      'sqlalchemy',
    ]);

    return verification.success;
  }

  /**
   * Clears the system-wide uv cache.
   * @param onData The callback to use for all output data.
   * @returns `true` if the cache was cleared successfully, otherwise `false`.
   */
  async clearUvCache(onData: ((data: string) => void) | undefined): Promise<boolean> {
    const callbacks = { onStdout: onData };
    const args = ['cache', 'clean'];
    const { exitCode } = await this.runUvCommandAsync(args, callbacks);
    if (exitCode !== 0) log.error('Failed to clear uv cache: exit code', exitCode);
    return exitCode === 0;
  }

  /**
   * Removes the virtual environment directory.
   * @returns `true` if the directory was removed successfully, otherwise `false`.
   */
  async removeVenvDirectory(): Promise<boolean> {
    return await this.#rmdir(this.venvPath, '.venv directory');
  }

  /**
   * Removes a directory, logging the event.
   * @param dir The path of the directory to remove.
   * @param logName Human-readable name of the directory to remove, used for the log message.
   * @returns `true` if the directory was removed successfully, otherwise `false`.
   */
  async #rmdir(dir: string, logName: string): Promise<boolean> {
    if (await pathAccessible(dir)) {
      log.info(`Removing ${logName} [${dir}]`);
      try {
        await rm(dir, { recursive: true });
      } catch (error) {
        log.error(`Error removing ${logName}: ${error}`);
        return false;
      }
    } else {
      log.warn(`Attempted to remove ${logName}, but directory does not exist [${dir}]`);
    }
    return true;
  }

  /**
   * Reinstalls the required packages for ComfyUI core.
   */
  async reinstallRequirements(onData: (data: string) => void) {
    const callbacks = { onStdout: onData };

    try {
      await this.#using(() => this.manualInstall(callbacks));
    } catch (error) {
      log.error('Failed to reinstall requirements:', error);

      const created = await this.createVenv(onData);
      if (!created) return false;

      const pipEnsured = await this.upgradePip(callbacks);
      if (!pipEnsured) return false;

      await this.#using(() => this.manualInstall(callbacks));
    }
    return true;
  }

  /**
   * Upgrades pip in the virtual environment.
   * @returns `true` if the virtual environment was created successfully, otherwise `false`
   */
  async upgradePip(callbacks?: ProcessCallbacks): Promise<boolean> {
    try {
      await this.#using(() => this.ensurePip(callbacks));
      return true;
    } catch (error) {
      log.error('Failed to upgrade pip:', error);
      return false;
    }
  }

  /**
   * Create virtual environment using uv
   * @returns `true` if the virtual environment was created successfully, otherwise `false`
   */
  async createVenv(onData: ((data: string) => void) | undefined): Promise<boolean> {
    try {
      const callbacks: ProcessCallbacks = { onStdout: onData };
      await this.#using(() => this.createVenvWithPython(callbacks));
      return true;
    } catch (error) {
      log.error('Failed to create virtual environment:', error);
      return false;
    }
  }

  /**
   * Similar to `using` functionality, this ensures that {@link uvPty} is terminated after the command has run.
   * @param command The command to run
   * @returns The result of the command
   * @todo Refactor to `using`
   */
  async #using<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } finally {
      const pid = this.uvPty?.pid;
      if (pid) {
        process.kill(pid);
        this.uvPty = undefined;
      }
    }
  }
}
