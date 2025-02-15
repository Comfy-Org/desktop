import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getComfyUIAppDataPath, getDefaultInstallLocation } from 'tests/shared/utils';

import type { DesktopSettings } from '@/store/desktopSettings';

import { TempDirectory } from './tempDirectory';
import { assertPlaywrightEnabled } from './testExtensions';

export class TestEnvironment {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly configPath: string = path.join(this.appDataDir, 'config.json');

  readonly installLocation: TempDirectory = new TempDirectory();
  readonly defaultInstallLocation: string = getDefaultInstallLocation();

  readonly mainLogPath: string = path.join(this.appDataDir, 'logs', 'main.log');
  readonly comfyuiLogPath: string = path.join(this.appDataDir, 'logs', 'comfyui.log');

  async readConfig() {
    const config = await readFile(this.configPath, 'utf8');
    return JSON.parse(config) as DesktopSettings;
  }

  async breakInstallPath() {
    const config = await this.readConfig();
    config.basePath = `${config.basePath}-invalid`;
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async restoreInstallPath() {
    const config = await this.readConfig();
    config.basePath = config.basePath?.replace(/-invalid$/, '');
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
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
}
