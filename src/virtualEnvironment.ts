import { app } from 'electron';
import log from 'electron-log/main';
import pty from 'node-pty';
import { ChildProcess, spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os, { EOL } from 'node:os';
import path from 'node:path';

import type { TorchDeviceType } from './preload';
import { HasTelemetry, ITelemetry, trackEvent } from './services/telemetry';
import { getDefaultShell } from './shell/util';
import { pathAccessible } from './utils';

export type ProcessCallbacks = {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

export type PipInstallConfig = {
  packages: string[];
  indexUrl?: string;
  extraIndexUrl?: string;
  prerelease?: boolean;
  upgradePackages?: boolean;
  requirementsFile?: string;
  indexStrategy?: 'compatible' | 'unsafe-best-match';
};

export function getPyTorchConfig(selectedDevice: TorchDeviceType, platform: string): PipInstallConfig {
  const basePackages = ['torch', 'torchvision', 'torchaudio'];

  // CPU-only configuration
  if (selectedDevice === 'cpu') {
    return {
      packages: basePackages,
    };
  }

  // NVIDIA/Windows configuration
  if (selectedDevice === 'nvidia' || platform === 'win32') {
    return {
      packages: basePackages,
      indexUrl: 'https://download.pytorch.org/whl/cu121',
    };
  }

  // macOS/MPS configuration
  if (selectedDevice === 'mps' || platform === 'darwin') {
    return {
      packages: basePackages,
      extraIndexUrl: 'https://download.pytorch.org/whl/nightly/cpu',
      prerelease: true,
      upgradePackages: true,
    };
  }

  // Default fallback configuration
  return { packages: basePackages };
}

export function getPipInstallArgs(config: PipInstallConfig): string[] {
  const installArgs = ['pip', 'install'];

  if (config.upgradePackages) {
    installArgs.push('-U');
  }

  if (config.prerelease) {
    installArgs.push('--prerelease', 'allow');
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
 * Manages a virtual Python environment using uv.
 *
 * Maintains its own node-pty instance; output from this is piped to the virtual terminal.
 * @todo Split either installation or terminal management to a separate class.
 */
export class VirtualEnvironment implements HasTelemetry {
  readonly venvRootPath: string;
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
      UV_CACHE_DIR: this.cacheDir,
      UV_TOOL_DIR: this.cacheDir,
      UV_TOOL_BIN_DIR: this.cacheDir,
      UV_PYTHON_INSTALL_DIR: this.cacheDir,
      VIRTUAL_ENV: this.venvPath,
      // Empty strings are not valid values for these env vars,
      // dropping them here to avoid passing them to uv.
      UV_PYTHON_INSTALL_MIRROR: this.pythonMirror || undefined,
    };

    if (!this.uvPty) {
      const shell = getDefaultShell();
      this.uvPty = pty.spawn(shell, [], {
        handleFlowControl: false,
        conptyInheritCursor: false,
        name: 'xterm',
        cwd: this.venvRootPath,
        env,
      });
    }
    return this.uvPty;
  }

  constructor(
    venvPath: string,
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
    this.venvRootPath = venvPath;
    this.telemetry = telemetry;
    this.pythonVersion = pythonVersion ?? '3.12';
    this.selectedDevice = selectedDevice ?? 'cpu';
    this.pythonMirror = pythonMirror;
    this.pypiMirror = pypiMirror;
    this.torchMirror = torchMirror;

    // uv defaults to .venv
    this.venvPath = path.join(venvPath, '.venv');
    const resourcesPath = app.isPackaged ? path.join(process.resourcesPath) : path.join(app.getAppPath(), 'assets');
    this.comfyUIRequirementsPath = path.join(resourcesPath, 'ComfyUI', 'requirements.txt');
    this.comfyUIManagerRequirementsPath = path.join(
      resourcesPath,
      'ComfyUI',
      'custom_nodes',
      'ComfyUI-Manager',
      'requirements.txt'
    );

    this.cacheDir = path.join(venvPath, 'uv-cache');

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
        log.info(`Virtual environment already exists at ${this.venvPath}`);
        return;
      }

      await this.createVenvWithPython(callbacks);
      await this.ensurePip(callbacks);
      await this.installRequirements(callbacks);
      this.telemetry.track(`install_flow:virtual_environment_create_end`, {
        reason: 'success',
      });
      log.info(`Successfully created virtual environment at ${this.venvPath}`);
    } catch (error) {
      this.telemetry.track(`install_flow:virtual_environment_create_error`, {
        error_name: error instanceof Error ? error.name : 'UnknownError',
        error_type: error instanceof Error ? error.constructor.name : typeof error,
        error_message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      log.error(`Error creating virtual environment: ${error}`);
      throw error;
    }
  }

  @trackEvent('install_flow:virtual_environment_create_python')
  public async createVenvWithPython(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Creating virtual environment at ${this.venvPath} with python ${this.pythonVersion}`);
    const args = ['venv', '--python', this.pythonVersion];
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
    log.info(`Running uv command: ${uvCommand} ${args.join(' ')}`);
    return this.runPtyCommandAsync(`${uvCommand} ${args.map((a) => `"${a}"`).join(' ')}`, callbacks?.onStdout);
  }

  private async runPtyCommandAsync(command: string, onData?: (data: string) => void): Promise<{ exitCode: number }> {
    const id = Date.now();
    return new Promise((res) => {
      const endMarker = `_-end-${id}:`;
      const input = `${command}\recho "${endMarker}$?"`;
      const dataReader = this.uvPtyInstance.onData((data) => {
        // Remove ansi sequences to see if this the exit marker
        const lines = data.replaceAll(/\u001B\[[\d;?]*[A-Za-z]/g, '').split(/(\r\n|\n)/);
        for (const line of lines) {
          if (line.startsWith(endMarker)) {
            const exit = line.substring(endMarker.length).trim();
            let exitCode: number;
            // Powershell outputs True / False for success
            if (exit === 'True') {
              exitCode = 0;
            } else if (exit === 'False') {
              exitCode = -999;
            } else {
              // Bash should output a number
              exitCode = Number.parseInt(exit);
              if (Number.isNaN(exitCode)) {
                console.warn('Unable to parse exit code:', exit);
                exitCode = -998;
              }
            }
            dataReader.dispose();
            res({ exitCode });
            break;
          }
        }
        onData?.(data);
      });
      this.uvPtyInstance.write(`${input}\r`);
    });
  }

  private runCommand(
    command: string,
    args: string[],
    env: Record<string, string>,
    callbacks?: ProcessCallbacks,
    cwd: string = this.venvRootPath
  ): ChildProcess {
    log.info(`Running command: ${command} ${args.join(' ')} in ${cwd}`);
    const childProcess: ChildProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
    });

    if (callbacks) {
      childProcess.stdout?.on('data', (data: Buffer) => {
        console.log(data.toString());
        callbacks.onStdout?.(data.toString());
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
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
    const config = getPyTorchConfig(this.selectedDevice, process.platform);
    if (this.torchMirror) {
      config.indexUrl = this.torchMirror;
    }
    const installArgs = getPipInstallArgs(config);

    log.info(`Installing PyTorch with config: ${JSON.stringify(config)}`);
    const { exitCode } = await this.runUvCommandAsync(installArgs, callbacks);

    if (exitCode !== 0) {
      throw new Error(`Failed to install PyTorch: exit code ${exitCode}`);
    }
  }

  private async installComfyUIRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUI requirements from ${this.comfyUIRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install requirements.txt: exit code ${exitCode}`);
    }
  }

  private async installComfyUIManagerRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUIManager requirements from ${this.comfyUIManagerRequirementsPath}`);
    const installCmd = getPipInstallArgs({
      requirementsFile: this.comfyUIManagerRequirementsPath,
      packages: [],
      indexUrl: this.pypiMirror,
    });
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install requirements.txt: exit code ${exitCode}`);
    }
  }

  async exists(): Promise<boolean> {
    return await pathAccessible(this.venvPath);
  }

  /**
   * Checks if the virtual environment has all the required packages of ComfyUI core.
   *
   * Parses the text output of `uv pip install --dry-run -r requirements.txt`.
   * @returns `true` if pip install does not detect any missing packages, otherwise `false`
   */
  async hasRequirements() {
    const args = ['pip', 'install', '--dry-run', '-r', this.comfyUIRequirementsPath];
    log.info(`Running direct process command: ${args.join(' ')}`);

    // Get packages as json string
    let output = '';
    const callbacks: ProcessCallbacks = {
      onStdout: (data) => (output += data.toString()),
      onStderr: (data) => (output += data.toString()),
    };
    const result = await this.runCommandAsync(
      this.uvPath,
      args,
      { PYTHONIOENCODING: 'utf8' },
      callbacks,
      this.venvRootPath
    );

    if (result.exitCode !== 0)
      throw new Error(`Failed to get packages: Exit code ${result.exitCode}, signal ${result.signal}`);
    if (!output) throw new Error('Failed to get packages: uv output was empty');

    const venvOk = output.search(/\bWould make no changes\s+$/) !== -1;
    if (!venvOk) log.warn(output);

    return venvOk;
  }

  async clearUvCache(): Promise<boolean> {
    return await this.#rmdir(this.cacheDir, 'uv cache');
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
      log.error(`Failed to reinstall requirements: ${error}`);

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
    } catch {
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
    } catch {
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
