import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import log from 'electron-log/main';
import { pathAccessible } from './utils';
import { app } from 'electron';
import pty from 'node-pty';
import os, { EOL } from 'node:os';
import { getDefaultShell } from './shell/util';
import type { TorchDeviceType } from './preload';
import { ITelemetry, trackEvent, HasTelemetry } from './services/telemetry';

export type ProcessCallbacks = {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
};

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
  readonly selectedDevice?: string;
  uvPty: pty.IPty | undefined;

  get uvPtyInstance() {
    if (!this.uvPty) {
      const shell = getDefaultShell();
      this.uvPty = pty.spawn(shell, [], {
        handleFlowControl: false,
        conptyInheritCursor: false,
        name: 'xterm',
        cwd: this.venvRootPath,
        env: {
          ...(process.env as Record<string, string>),
          UV_CACHE_DIR: this.cacheDir,
          UV_TOOL_DIR: this.cacheDir,
          UV_TOOL_BIN_DIR: this.cacheDir,
          UV_PYTHON_INSTALL_DIR: this.cacheDir,
          VIRTUAL_ENV: this.venvPath,
        },
      });
    }
    return this.uvPty;
  }

  constructor(
    venvPath: string,
    readonly telemetry: ITelemetry,
    selectedDevice: TorchDeviceType | undefined,
    pythonVersion: string = '3.12.8'
  ) {
    this.venvRootPath = venvPath;
    this.pythonVersion = pythonVersion;
    this.selectedDevice = selectedDevice;

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
    } catch (error) {
      throw error;
    } finally {
      const pid = this.uvPty?.pid;
      if (pid) process.kill(pid);
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

  @trackEvent('desktop:virtual_environment_create')
  private async createEnvironment(callbacks?: ProcessCallbacks): Promise<void> {
    if (this.selectedDevice === 'unsupported') {
      log.info('User elected to manually configure their environment.  Skipping python configuration.');
      return;
    }

    try {
      if (await this.exists()) {
        log.info(`Virtual environment already exists at ${this.venvPath}`);
        return;
      }
      await this.createVenvWithPython(callbacks);
      await this.ensurePip(callbacks);

      log.info(`Successfully created virtual environment at ${this.venvPath}`);
    } catch (error) {
      log.error(`Error creating virtual environment: ${error}`);
      throw error;
    }

    await this.installRequirements(callbacks);
  }

  @trackEvent('desktop:virtual_environment_create_python')
  public async createVenvWithPython(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Creating virtual environment at ${this.venvPath} with python ${this.pythonVersion}`);
    const args = ['venv', '--python', this.pythonVersion];
    const { exitCode } = await this.runUvCommandAsync(args, callbacks);

    if (exitCode !== 0) {
      throw new Error(`Failed to create virtual environment: exit code ${exitCode}`);
    }
  }

  @trackEvent('desktop:virtual_environment_create_ensurepip')
  public async ensurePip(callbacks?: ProcessCallbacks): Promise<void> {
    const { exitCode: ensurepipExitCode } = await this.runPythonCommandAsync(
      ['-m', 'ensurepip', '--upgrade'],
      callbacks
    );
    if (ensurepipExitCode !== 0) {
      throw new Error(`Failed to upgrade pip: exit code ${ensurepipExitCode}`);
    }
  }

  @trackEvent('desktop:virtual_environment_install_requirements')
  public async installRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    // pytorch nightly is required for MPS
    if (process.platform === 'darwin') {
      return this.manualInstall(callbacks);
    }

    const installCmd = ['pip', 'install', '-r', this.requirementsCompiledPath, '--index-strategy', 'unsafe-best-match'];
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
  public async runUvCommandAsync(args: string[], callbacks?: ProcessCallbacks): Promise<{ exitCode: number | null }> {
    const uvCommand = os.platform() === 'win32' ? `& "${this.uvPath}"` : this.uvPath;
    log.info(`Running uv command: ${uvCommand} ${args.join(' ')}`);
    return this.runPtyCommandAsync(`${uvCommand} ${args.map((a) => `"${a}"`).join(' ')}`, callbacks?.onStdout);
  }

  private async runPtyCommandAsync(command: string, onData?: (data: string) => void): Promise<{ exitCode: number }> {
    const id = Date.now();
    return new Promise((res) => {
      const endMarker = `_-end-${id}:`;
      const input = `clear${EOL}${command}${EOL}echo "${endMarker}$?"`;
      const dataReader = this.uvPtyInstance.onData((data) => {
        const lines = data.split(/(\r\n|\n)/);
        for (const line of lines) {
          // Remove ansi sequences to see if this the exit marker
          const clean = line.replaceAll(/\u001B\[[\d;?]*[A-Za-z]/g, '');
          if (clean.startsWith(endMarker)) {
            const exit = clean.substring(endMarker.length).trim();
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
            res({
              exitCode,
            });
            break;
          }
        }
        onData?.(data);
      });
      this.uvPtyInstance.write(`${input}${EOL}`);
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
  ): Promise<{ exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const childProcess = this.runCommand(command, args, env, callbacks, cwd);

      childProcess.on('close', (code) => {
        resolve({ exitCode: code });
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

  private async installPytorch(callbacks?: ProcessCallbacks): Promise<void> {
    const { selectedDevice } = this;

    if (selectedDevice === 'cpu') {
      // CPU mode
      log.info('Installing PyTorch CPU');
      await this.runUvCommandAsync(['pip', 'install', 'torch', 'torchvision', 'torchaudio'], callbacks);
    } else if (selectedDevice === 'nvidia' || process.platform === 'win32') {
      // Win32 default
      log.info('Installing PyTorch CUDA 12.1');
      await this.runUvCommandAsync(
        [
          'pip',
          'install',
          'torch',
          'torchvision',
          'torchaudio',
          '--index-url',
          'https://download.pytorch.org/whl/cu121',
        ],
        callbacks
      );
    } else if (selectedDevice === 'mps' || process.platform === 'darwin') {
      // macOS default
      log.info('Installing PyTorch Nightly for macOS.');
      await this.runUvCommandAsync(
        [
          'pip',
          'install',
          '-U',
          '--prerelease',
          'allow',
          'torch',
          'torchvision',
          'torchaudio',
          '--extra-index-url',
          'https://download.pytorch.org/whl/nightly/cpu',
        ],
        callbacks
      );
    }
  }

  private async installComfyUIRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUI requirements from ${this.comfyUIRequirementsPath}`);
    const installCmd = ['pip', 'install', '-r', this.comfyUIRequirementsPath];
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install requirements.txt: exit code ${exitCode}`);
    }
  }

  private async installComfyUIManagerRequirements(callbacks?: ProcessCallbacks): Promise<void> {
    log.info(`Installing ComfyUIManager requirements from ${this.comfyUIManagerRequirementsPath}`);
    const installCmd = ['pip', 'install', '-r', this.comfyUIManagerRequirementsPath];
    const { exitCode } = await this.runUvCommandAsync(installCmd, callbacks);
    if (exitCode !== 0) {
      throw new Error(`Failed to install requirements.txt: exit code ${exitCode}`);
    }
  }

  private async exists(): Promise<boolean> {
    return await pathAccessible(this.venvPath);
  }
}
