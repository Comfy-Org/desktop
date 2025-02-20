import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getComfyUIAppDataPath, getDefaultInstallLocation, pathExists } from 'tests/shared/utils';

import { COMFYUI_LOG_FILENAME, MAIN_LOG_FILENAME } from '@/constants';
import type { DesktopSettings } from '@/store/desktopSettings';

import { TempDirectory } from './tempDirectory';
import { assertPlaywrightEnabled } from './testExtensions';

export class TestEnvironment implements AsyncDisposable {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly configPath: string = path.join(this.appDataDir, 'config.json');

  readonly installLocation: TempDirectory = new TempDirectory();
  readonly defaultInstallLocation: string = getDefaultInstallLocation();

  readonly mainLogPath: string = path.join(this.appDataDir, 'logs', MAIN_LOG_FILENAME);
  readonly comfyuiLogPath: string = path.join(this.appDataDir, 'logs', COMFYUI_LOG_FILENAME);

  #haveBrokenInstallPath = false;
  #haveBrokenVenv = false;

  async readConfig() {
    const config = await readFile(this.configPath, 'utf8');
    return JSON.parse(config) as DesktopSettings;
  }

  async breakInstallPath() {
    const config = await this.readConfig();
    config.basePath = `${config.basePath}-invalid`;
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
    this.#haveBrokenInstallPath = true;
  }

  async restoreInstallPath() {
    if (!this.#haveBrokenInstallPath) {
      console.warn('Attempt to restore install path ignored - have not called breakInstallPath()');
      return;
    }
    this.#haveBrokenInstallPath = false;

    const config = await this.readConfig();
    config.basePath = config.basePath?.replace(/-invalid$/, '');
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async breakVenv() {
    const venvPath = path.join(this.defaultInstallLocation, '.venv');
    await rename(venvPath, `${venvPath}-invalid`);
    this.#haveBrokenVenv = true;
  }

  async restoreVenv() {
    if (!this.#haveBrokenVenv) {
      console.warn('Attempt to restore venv ignored - have not called breakVenv()');
      return;
    }
    this.#haveBrokenVenv = false;

    const venvPath = path.join(this.defaultInstallLocation, '.venv');
    const invalidVenvExists = await pathExists(`${venvPath}-invalid`);
    if (!invalidVenvExists) throw new Error('Invalid venv does not exist');

    if (await pathExists(venvPath)) {
      await rm(venvPath, { recursive: true, force: true });
    }
    await rename(`${venvPath}-invalid`, venvPath);
  }

  async deleteEverything() {
    await this.deleteAppData();
    await this.deleteInstallLocation();
  }

  async deleteAppData() {
    assertPlaywrightEnabled();
    await rm(this.appDataDir, { recursive: true, force: true });
  }

  async deleteInstallLocation() {
    assertPlaywrightEnabled();
    await this.installLocation[Symbol.asyncDispose]();
  }

  async deleteDefaultInstallLocation() {
    assertPlaywrightEnabled();
    await rm(this.defaultInstallLocation, { recursive: true, force: true });
  }

  async [Symbol.asyncDispose]() {
    await this.restoreInstallPath();
    await this.restoreVenv();
  }
}
