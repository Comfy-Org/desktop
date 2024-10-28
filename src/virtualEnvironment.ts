import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import log from 'electron-log/main';
import { pathAccessible } from './utils';
import { app } from 'electron';

export class VirtualEnvironment {
  readonly venvRootPath: string;
  readonly venvPath: string;
  readonly venvName: string;
  readonly pythonVersion: string;
  readonly uvPath: string;
  readonly requirementsCompiledPath: string;
  readonly cacheDir: string;
  readonly pythonInterpreterPath: string;

  constructor(venvPath: string, venvName: string = 'ComfyUI-uv', pythonVersion: string = '3.12.4') {
    this.venvRootPath = venvPath;
    this.venvPath = path.join(venvPath, venvName);
    this.venvName = venvName;
    this.pythonVersion = pythonVersion;
    this.cacheDir = path.join(venvPath, 'uv-cache');
    this.requirementsCompiledPath = app.isPackaged
      ? path.join(app.getAppPath(), 'requirements.compiled')
      : path.join(path.join(app.getAppPath(), 'assets'), 'requirements.compiled');
    this.pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.venvPath, 'Scripts', 'python.exe')
        : path.join(this.venvPath, 'bin', 'python');

    // Set platform-specific paths
    // uv will be in assets/uv on Windows and use the global uv on macOS and Linux
    // uv executable is not codesigned, so we need to use the global one on macOS and Linux
    if (process.platform === 'win32') {
      if (app.isPackaged) {
        this.uvPath = path.join(app.getAppPath(), 'uv.exe');
      } else {
        this.uvPath = path.join(app.getAppPath(), 'assets', 'uv', 'uv.exe');
      }
    } else if (process.platform === 'linux') {
      if (app.isPackaged) {
        this.uvPath = path.join(app.getAppPath(), 'uv.exe');
      } else {
        this.uvPath = path.join(app.getAppPath(), 'assets', 'uv', 'uv.exe');
      }
    } else if (process.platform === 'darwin') {
      if (app.isPackaged) {
        this.uvPath = path.join(app.getAppPath(), 'uv', 'uv');
      } else {
        //this.uvPath = path.join('uv'); // Use global uv on macOS.
        this.uvPath = path.join(app.getAppPath(), 'assets', 'uv', 'uv');
      }
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
    log.info(`Using uv at ${this.uvPath}, and created virtual environment at ${this.venvPath}`);
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

      log.info(`Creating virtual environment at ${this.venvPath}`);

      // Create virtual environment using uv
      const args = ['venv', '--python', this.pythonVersion, this.venvName];
      const { exitCode } = await this.runUvCommand(args);

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
    log.info(
      `Running uv command: ${this.uvPath} ${args.join(' ')} in ${this.venvRootPath}, with cache dir ${this.cacheDir}`
    );
    return this.runCommand(this.uvPath, args, {
      UV_CACHE_DIR: this.cacheDir,
      UV_HOME: this.cacheDir,
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

    childProcess.stdout.on('data', (data) => {
      log.info(data.toString());
    });

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

  async packWheels(): Promise<boolean> {
    return false;
    //return await pathAccessible(this.wheelsPath);
  }

  //TODO refactor into ComfyEnvironment class.
  async installRequirements(): Promise<void> {
    // install python pkgs from wheels if packed in bundle, otherwise just use requirements.compiled
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
