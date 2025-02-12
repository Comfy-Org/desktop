import { rm } from 'node:fs/promises';
import path from 'node:path';
import { getComfyUIAppDataPath } from 'tests/shared/utils';

import { TempDirectory } from './tempDirectory';

export class TestEnvironment implements AsyncDisposable {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly installLocation: TempDirectory = new TempDirectory();

  readonly mainLogPath: string;
  readonly comfyuiLogPath: string;

  constructor() {
    this.mainLogPath = path.join(this.appDataDir, 'logs', 'main.log');
    this.comfyuiLogPath = path.join(this.appDataDir, 'logs', 'comfyui.log');
  }

  async deleteEverything() {
    await this.deleteAppData();
    await this.deleteInstallLocation();
  }

  async deleteAppData() {
    await rm(this.appDataDir, { recursive: true, force: true });
  }

  async deleteInstallLocation() {
    await this.installLocation[Symbol.asyncDispose]();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.deleteEverything();
  }
}
