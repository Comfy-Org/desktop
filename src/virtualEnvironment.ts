import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import log from 'electron-log/main';
import { pathAccessible } from './utils';
import { app } from 'electron';

export class VirtualEnvironment {
  readonly venvRootPath: string;
  readonly venvPath: string;
  readonly pythonVersion: string;
  readonly uvPath: string;
  readonly requirementsCompiledPath: string;
  readonly cacheDir: string;
  readonly pythonInterpreterPath: string;

  constructor(venvPath: string, pythonVersion: string = '3.12.4') {
    this.venvRootPath = venvPath;
    this.venvPath = path.join(venvPath, '.venv'); // uv defaults to .venv
    this.pythonVersion = pythonVersion;
    this.cacheDir = path.join(venvPath, 'uv-cache');
    this.requirementsCompiledPath = app.isPackaged
      ? path.join(process.resourcesPath, 'requirements.compiled')
      : path.join(path.join(app.getAppPath(), 'assets'), 'requirements.compiled');
    this.pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.venvPath, 'Scripts', 'python.exe')
        : path.join(this.venvPath, 'bin', 'python');

    const uvFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'uv')
      : path.join(app.getAppPath(), 'assets', 'uv');

    if (process.platform === 'win32') {
      this.uvPath = path.join(uvFolder, 'win', 'uv.exe');
    } else if (process.platform === 'linux') {
      this.uvPath = path.join(uvFolder, 'linux', 'uv');
    } else if (process.platform === 'darwin') {
      this.uvPath = path.join(uvFolder, 'macos', 'uv');
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
    log.info(`Using uv at ${this.uvPath}`);
  }

  async exists(): Promise<boolean> {
    return await pathAccessible(this.venvPath);
  }

  async create(): Promise<void> {
    try {
      if (await this.exists()) {
        log.info(`Virtual environment already exists at ${this.venvPath}`);
        return;
      }

      log.info(`Creating virtual environment at ${this.venvPath} with python ${this.pythonVersion}`);

      // Create virtual environment using uv
      const args = ['venv', '--python', this.pythonVersion];
      const { exitCode } = await this.runUvCommandAsync(args);

      if (exitCode !== 0) {
        throw new Error(`Failed to create virtual environment: exit code ${exitCode}`);
      }

      log.info(`Successfully created virtual environment at ${this.venvPath}`);
    } catch (error) {
      log.error(`Error creating virtual environment: ${error}`);
      throw error;
    }
  }
  /**
   * Automatically appends uv to the front of every command.
   * @param command
   * @param args
   * @returns
   */
  async runUvCommandAsync(args: string[]): Promise<{ exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const childProcess = this.runUvCommand(args);
      childProcess.on('close', (code) => {
        resolve({ exitCode: code });
      });

      childProcess.on('error', (err) => {
        reject(err);
      });
    });
  }

  runUvCommand(args: string[]): ChildProcess {
    return this.runCommand(this.uvPath, args, {
      UV_CACHE_DIR: this.cacheDir,
      UV_TOOL_DIR: this.cacheDir,
      UV_TOOL_BIN_DIR: this.cacheDir,
      UV_PYTHON_INSTALL_DIR: this.cacheDir,
      VIRTUAL_ENV: this.venvPath,
    });
  }

  runCommand(command: string, args: string[], env?: any): ChildProcess {
    log.info(`Running command: ${command} ${args.join(' ')} in ${this.venvRootPath}`);
    const childProcess: ChildProcess = spawn(command, args, {
      cwd: this.venvRootPath,
      env: {
        ...process.env,
        ...env,
      },
    });

    childProcess.stdout &&
      childProcess.stdout.on('data', (data) => {
        log.info(data.toString());
      });

    childProcess.stderr &&
      childProcess.stderr.on('data', (data) => {
        log.error(data.toString());
      });

    return childProcess;
  }

  async runCommandAsync(command: string, args: string[], env?: any): Promise<{ exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const childProcess = this.runCommand(command, args, env);

      childProcess.on('close', (code) => {
        resolve({ exitCode: code });
      });

      childProcess.on('error', (err) => {
        reject(err);
      });
    });
  }

  //TODO refactor into ComfyEnvironment class.
  async installRequirements(): Promise<void> {
    const installCmd = ['pip', 'install', '-r', this.requirementsCompiledPath, '--index-strategy', 'unsafe-best-match'];

    const { exitCode } = await this.runUvCommandAsync(installCmd);
    if (exitCode !== 0) {
      throw new Error(`Failed to install requirements: exit code ${exitCode}`);
    }
  }

  runPythonCommand(args: string[]): ChildProcess {
    const pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.venvPath, 'Scripts', 'python.exe')
        : path.join(this.venvPath, 'bin', 'python');

    return this.runCommand(pythonInterpreterPath, args);
  }

  async runPythonCommandAsync(args: string[]): Promise<{ exitCode: number | null }> {
    return this.runCommandAsync(this.pythonInterpreterPath, args);
  }
}
