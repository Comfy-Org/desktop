import { rm } from 'node:fs/promises';
import { getComfyUIAppDataPath } from 'tests/shared/utils';

import { TempDirectory } from './tempDirectory';

export class TestEnvironment implements AsyncDisposable {
  readonly appDataDir: string = getComfyUIAppDataPath();
  readonly installLocation: TempDirectory = new TempDirectory();

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
