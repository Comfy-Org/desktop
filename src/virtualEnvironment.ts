import { app } from 'electron';
import log from 'electron-log/main';
import pty from 'node-pty';
import { ChildProcess, spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os, { EOL } from 'node:os';
import path from 'node:path';

import { TorchMirrorUrl } from './constants';
import type { TorchDeviceType } from './preload';
import { captureSentryException } from './services/sentry';
import { HasTelemetry, ITelemetry, trackEvent } from './services/telemetry';
import { getDefaultShell, getDefaultShellArgs } from './shell/util';
import { pathAccessible } from './utils';

export type ProcessCallbacks = {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

interface PipInstallConfig {
  packages: string[];
  indexUrl?: string;
  extraIndexUrl?: string;
  prerelease?: boolean;
  upgradePackages?: boolean;
  requirementsFile?: string;
  indexStrategy?: 'compatible' | 'unsafe-best-match';
}

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
  return mirror;
}

/**
 * Manages a virtual Python environment using uv.
 *
 * Maintains its own node-pty instance; output from this is piped to the virtual terminal.
 * @todo Split either installation or terminal management to a separate class.
 */
export class VirtualEnvironment implements HasTelemetry {
  readonly basePath: string;
  readonly venvPath: string;
  readonly pythonVersion: string;
  readonly uvPath: string;
  readonly requirementsCompiledPath: string;
  readonly cacheDir: string;
  readonly pythonInterpreterPath: string;
  readonly comfyUIRequirementsPath: string;
  readonly comfyUIManagerRequirementsPath: string;
  readonly selectedDevice: TorchDeviceType;
  readonly telemetry: ITelemetry;
  readonly pythonMirror?: string;
  readonly pypiMirror?: string;
  readonly torchMirror?: string;
  uvPty: pty.IPty | undefined;

  /** @todo Refactor to `using` */
  get uvPtyInstance() {
    const env = {
      ...(process.env as Record<string, string>),
      VIRTUAL_ENV: this.venvPath,
      // Empty strings are not valid values for these env vars,
      // dropping them here to avoid passing them to uv.
      ...(this.pythonMirror ? { UV_PYTHON_INSTALL_MIRROR: this.pythonMirror } : {}),
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
    this.comfyUIManagerRequirementsPath = path.join(
      resourcesPath,
      'ComfyUI',
      'custom_nodes',
      'ComfyUI-Manager',
      'requirements.txt'
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
        return selectedDevice === 'cpu' ? 'windows_cpu' : 'windows_nvidia';
      }
    }
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
      if (await this.exists()) {
        this.telemetry.track(`install_flow:virtual_environment_create_end`, {
          reason: 'already_exists',
        });
        log.info('Virtual environment already exists at', this.venvPath);
        return;
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

  @trackEvent('install_flow:virtual_environment_create_python')
  public async createVenvWithPython(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Creating virtual environment at ${this.venvPath} with python ${this.pythonVersion}`);
    const args = ['venv', '--python', this.pythonVersion, '--python-preference', 'only-managed'];
    const { exitCode } = await this.runUvCommandAsync(args, callbacks);

    if (exitCode !== 0) {
      throw new Error(`Failed to create virtual environment: exit code ${exitCode}`);
    }
  }

  @trackEvent('install_flow:virtual_environment_ensurepip')
  public async ensurePip(callbacks?: ProcessCallbacks): Promise<void> {
    const { exitCode } = await this.runPythonCommandAsync(['-m', 'ensurepip', '--upgrade'], callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to upgrade pip: exit code ${exitCode}`);
    }
  }

  @trackEvent('install_flow:virtual_environment_install_requirements')
  public async installRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    // pytorch nightly is required for MPS
    if (process.platform === 'darwin') {
      return this.manualInstall(callbacks);
    }

    const installCmd = getPipInstallArgs({
      requirementsFile: this.requirementsCompiledPath,
      indexStrategy: 'unsafe-best-match',
      packages: [],
      indexUrl: this.pypiMirror,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      log.error(
        `Failed to install requirements.compiled: exit code ${exitCode}. Falling back to installing requirements.txt`
      );
      return this.manualInstall(callbacks);
    }
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
    env?: Record<string, string>,
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
   * Runs a uv command with the virtual environment set to this instance's venv and returns a promise with the exit code.
   * @param args
   * @returns
   */
  private async runUvCommandAsync(args: string[], callbacks?: ProcessCallbacks): Promise<{ exitCode: number | null }> {
    const uvCommand = os.platform() === 'win32' ? `& "${this.uvPath}"` : this.uvPath;
    const command = `${uvCommand} ${args.map((a) => `"${a}"`).join(' ')}`;
    log.info('Running uv command:', command);
    return this.runPtyCommandAsync(command, callbacks?.onStdout);
  }

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

  private runCommand(
    command: string,
    args: string[],
    env: Record<string, string>,
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

  private async runCommandAsync(
    command: string,
    args: string[],
    env: Record<string, string>,
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

  private async manualInstall(callbacks?: ProcessCallbacks): Promise<void> {
    await this.installPytorch(callbacks);
    await this.installComfyUIRequirements(callbacks);
    await this.installComfyUIManagerRequirements(callbacks);
  }

  async installPytorch(callbacks?: ProcessCallbacks): Promise<void> {
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

  async installComfyUIRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUI requirements from ${this.comfyUIRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install ComfyUI requirements.txt: exit code ${exitCode}`);
    }
  }

  async installComfyUIManagerRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUIManager requirements from ${this.comfyUIManagerRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIManagerRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install ComfyUI-Manager requirements.txt: exit code ${exitCode}`);
    }
  }

  async exists(): Promise<boolean> {
    return await pathAccessible(this.venvPath);
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
      log.info(`Running direct process command: ${args.join(' ')}`);

      // Get packages as json string
      let output = '';
      const callbacks: ProcessCallbacks = {
        onStdout: (data) => (output += data.toString()),
        onStderr: (data) => (output += data.toString()),
      };
      const result = await this.runCommandAsync(this.uvPath, args, { VIRTUAL_ENV: this.venvPath }, callbacks);

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
        if (line.search(/^\s*- (?!aiohttp|av|yarl).*==/) !== -1) return false;
        if (line.search(/^\s*\+ /) !== -1) {
          if (line.search(/^\s*\+ (aiohttp|av|yarl|comfyui-workflow-templates)==/) === -1) return false;
          adds++;
        }
        // An unexpected package means this is not a package upgrade
      }
      return adds > 0;
    };

    const coreOutput = await checkRequirements(this.comfyUIRequirementsPath);
    const managerOutput = await checkRequirements(this.comfyUIManagerRequirementsPath);

    const coreOk = hasAllPackages(coreOutput);
    const managerOk = hasAllPackages(managerOutput);

    const upgradeCore = !coreOk && isCoreUpgrade(coreOutput);
    const upgradeManager = !managerOk && isManagerUpgrade(managerOutput);

    if ((managerOk && upgradeCore) || (coreOk && upgradeManager) || (upgradeCore && upgradeManager)) {
      log.info('Package update of known packages required. Core:', upgradeCore, 'Manager:', upgradeManager);
      return 'package-upgrade';
    }

    return coreOk && managerOk ? 'OK' : 'error';
  }

  async clearUvCache(onData: ((data: string) => void) | undefined): Promise<boolean> {
    const callbacks = { onStdout: onData };
    const args = ['cache', 'clean'];
    const { exitCode } = await this.runUvCommandAsync(args, callbacks);
    if (exitCode !== 0) log.error('Failed to clear uv cache: exit code', exitCode);
    return exitCode === 0;
  }

  async removeVenvDirectory(): Promise<boolean> {
    return await this.#rmdir(this.venvPath, '.venv directory');
  }

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
