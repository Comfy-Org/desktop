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

  /**
   * Mac needs extra files to be code signed that on other platforms are included into the python.tgz
   */
  readonly macExtraFiles: Array<string>;

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
    this.pythonRecordPath = path.join(this.pythonRootPath, 'INSTALLER');
    this.pythonTarPath = path.join(appResourcesPath, 'python.tgz');
    this.wheelsPath = path.join(this.pythonRootPath, 'wheels');
    this.requirementsCompiledPath = path.join(this.pythonRootPath, 'requirements.compiled');
    this.macExtraFiles = [
      'lib/libpython3.12.dylib',
      'lib/python3.12/lib-dynload/_crypt.cpython-312-darwin.so',
      'bin/uv',
      'bin/uvx',
      'bin/python3.12',
    ];
  }

  async isInstalled(): Promise<boolean> {
    log.info(`Checking if Python is installed at ${this.pythonInterpreterPath} and ${this.pythonRecordPath}`);
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
    return exitCode ?? -1;
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

    if (process.platform === 'darwin') {
      // Mac need extra files to be codesigned, these now need to be unpacked and placed inside of the python folder.
      this.macExtraFiles.forEach(async (fileName) => {
        await fsPromises.cp(
          path.join(this.appResourcesPath, 'output', fileName),
          path.join(this.pythonRootPath, fileName)
        );
        await fsPromises.chmod(path.join(this.pythonRootPath, fileName), '755');
      });
      try {
        // TODO: If python tar is done more than once we could lose these so for now do not clean up
        // This is a cleanup step, and is non critical if failed.
        //await fsPromises.rm(path.join(this.appResourcesPath, 'output'), { recursive: true, force: true });
      } catch (error) {
        null;
      }
      // Mac seems to need a CPU cycle before allowing executing the python bin.
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      await sleep(1000);
    } else {
      try {
        // For non mac we can just delete these
        // This is a cleanup step, and is non critical if failed.
        await fsPromises.rm(path.join(this.appResourcesPath, 'output'), { recursive: true, force: true });
      } catch (error) {
        null;
      }
    }

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
