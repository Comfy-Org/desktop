import log from 'electron-log/main';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { pathAccessible } from './utils';
import tar from 'tar';

export class PythonEnvironment {
  readonly pythonRootPath: string;
  readonly pythonInterpreterPath: string;
  /**
   * The path to determine if Python is installed.
   * After we install Python, we write a file to this path to indicate that it is installed by us.
   */
  readonly pythonRecordPath: string;
  /**
   * The path to the python tar file in the app resources.
   */
  readonly pythonTarPath: string;
  /**
   * The path to the wheels directory.
   */
  readonly wheelsPath: string;
  /**
   * The path to the requirements.compiled file.
   */
  readonly requirementsCompiledPath: string;

  constructor(
    public pythonInstallPath: string,
    public appResourcesPath: string,
    // TODO(huchenlei): move spawnPythonAsync to this class
    public spawnPythonAsync: (
      pythonInterpreterPath: string,
      cmd: string[],
      cwd: string,
      options: { stdx: boolean }
    ) => Promise<{ exitCode: number | null }>
  ) {
    this.pythonRootPath = path.join(pythonInstallPath, 'python');
    this.pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(this.pythonRootPath, 'python.exe')
        : path.join(this.pythonRootPath, 'bin', 'python');
    this.pythonRecordPath = path.join(this.pythonInterpreterPath, 'INSTALLER');
    this.pythonTarPath = path.join(appResourcesPath, 'python.tgz');
    this.wheelsPath = path.join(this.pythonRootPath, 'wheels');
    this.requirementsCompiledPath = path.join(this.pythonRootPath, 'requirements.compiled');
  }

  async isInstalled(): Promise<boolean> {
    return (await pathAccessible(this.pythonInterpreterPath)) && (await pathAccessible(this.pythonRecordPath));
  }

  async packWheels(): Promise<boolean> {
    return await pathAccessible(this.wheelsPath);
  }

  async installRequirements(): Promise<number> {
    // install python pkgs from wheels if packed in bundle, otherwise just use requirements.compiled
    const rehydrateCmd = (await this.packWheels())
      ? // TODO: report space bug to uv upstream, then revert below mac fix
        [
          '-m',
          ...(process.platform !== 'darwin' ? ['uv'] : []),
          'pip',
          'install',
          '--no-index',
          '--no-deps',
          ...(await fsPromises.readdir(this.wheelsPath)).map((x) => path.join(this.wheelsPath, x)),
        ]
      : ['-m', 'uv', 'pip', 'install', '-r', this.requirementsCompiledPath, '--index-strategy', 'unsafe-best-match'];

    const { exitCode } = await this.spawnPythonAsync(this.pythonInterpreterPath, rehydrateCmd, this.pythonRootPath, {
      stdx: true,
    });
    return exitCode;
  }

  async install(): Promise<void> {
    try {
      // clean up any possible existing non-functional python env
      await fsPromises.rm(this.pythonRootPath, { recursive: true });
    } catch {
      null;
    }

    log.info(`Extracting python bundle from ${this.pythonTarPath} to ${this.pythonInstallPath}`);
    await tar.extract({
      file: this.pythonTarPath,
      cwd: this.pythonInstallPath,
      strict: true,
    });

    const exitCode = await this.installRequirements();

    if (exitCode === 0) {
      // write an INSTALLER record on successful completion of rehydration
      fsPromises.writeFile(this.pythonRecordPath, 'ComfyUI');

      if (await this.packWheels()) {
        // remove the now installed wheels
        fsPromises.rm(this.wheelsPath, { recursive: true });
        log.info(`Removed ${this.wheelsPath}`);
      }

      log.info(`Python successfully installed to ${this.pythonRootPath}`);
    } else {
      log.info(`Rehydration of python bundle exited with code ${exitCode}`);
      throw new Error('Python rehydration failed');
    }
  }

  async setup(): Promise<void> {
    if (await this.isInstalled()) {
      log.info(`Python environment already installed at ${this.pythonInstallPath}`);
      return;
    }

    log.info(
      `Running one-time python installation on first startup at ${this.pythonInstallPath} and ${this.pythonRootPath}`
    );
    await this.install();
  }
}
