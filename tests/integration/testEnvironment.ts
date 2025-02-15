import { rm } from 'node:fs/promises';
import path from 'node:path';
import { getComfyUIAppDataPath, getDefaultInstallLocation } from 'tests/shared/utils';

import { TempDirectory } from './tempDirectory';
import { assertPlaywrightEnabled } from './testExtensions';

export class TestEnvironment {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly installLocation: TempDirectory = new TempDirectory();
  readonly defaultInstallLocation: string = getDefaultInstallLocation();

  readonly mainLogPath: string = path.join(this.appDataDir, 'logs', 'main.log');
  readonly comfyuiLogPath: string = path.join(this.appDataDir, 'logs', 'comfyui.log');

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
