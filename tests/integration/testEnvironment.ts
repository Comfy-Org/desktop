import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getComfyUIAppDataPath, getDefaultInstallLocation, pathExists } from 'tests/shared/utils';

import { LogFile } from '@/constants';
import type { DesktopSettings } from '@/store/desktopSettings';

import { TempDirectory } from './tempDirectory';
import { assertPlaywrightEnabled } from './testExtensions';

export class TestEnvironment implements AsyncDisposable {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly configPath: string = path.join(this.appDataDir, 'config.json');

  readonly installLocation: TempDirectory = new TempDirectory();
  readonly defaultInstallLocation: string = getDefaultInstallLocation();

  readonly mainLogPath: string = path.join(this.appDataDir, 'logs', LogFile.Main);
  readonly comfyuiLogPath: string = path.join(this.appDataDir, 'logs', LogFile.ComfyUI);

  #haveBrokenInstallPath = false;
  #haveBrokenVenv = false;
  #haveBrokenServerStart = false;

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
    if (!this.#haveBrokenInstallPath) return;
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
    if (!this.#haveBrokenVenv) return;
    this.#haveBrokenVenv = false;

    const venvPath = path.join(this.defaultInstallLocation, '.venv');
    const invalidVenvExists = await pathExists(`${venvPath}-invalid`);
    if (!invalidVenvExists) throw new Error('Invalid venv does not exist');

    if (await pathExists(venvPath)) {
      await rm(venvPath, { recursive: true, force: true });
    }
    await rename(`${venvPath}-invalid`, venvPath);
  }

  async breakServerStart() {
    this.#haveBrokenServerStart = true;
    try {
      const filePath = path.join(this.defaultInstallLocation, 'user', 'default', 'comfy.settings.json');
      const json = await fs.readFile(filePath, 'utf8');

      const comfySettings = JSON.parse(json);
      const launchArgs = comfySettings['Comfy.Server.LaunchArgs'];
      if (!launchArgs) throw new Error('Could not reach launch args from comfy.settings.json');

      delete launchArgs.cpu;
      comfySettings['Comfy.Server.LaunchArgs'] = launchArgs;

      await fs.writeFile(filePath, JSON.stringify(comfySettings, null, 2));
    } catch (error) {
      this.#haveBrokenServerStart = false;
      throw error;
    }
  }

  async restoreServerStart() {
    if (!this.#haveBrokenServerStart) return;
    this.#haveBrokenServerStart = false;
    try {
      const filePath = path.join(this.defaultInstallLocation, 'user', 'default', 'comfy.settings.json');
      const json = await fs.readFile(filePath, 'utf8');

      const comfySettings = JSON.parse(json);
      comfySettings['Comfy.Server.LaunchArgs'].cpu = '';

      await fs.writeFile(filePath, JSON.stringify(comfySettings, null, 2));
    } catch (error) {
      this.#haveBrokenServerStart = true;
      throw error;
    }
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

  async deleteLogsIfPresent() {
    assertPlaywrightEnabled();
    await rm(this.mainLogPath, { force: true });
    await rm(this.comfyuiLogPath, { force: true });
  }

  async [Symbol.asyncDispose]() {
    await this.restoreInstallPath();
    await this.restoreVenv();
    await this.restoreServerStart();
    await this.installLocation[Symbol.asyncDispose]();
  }
}
