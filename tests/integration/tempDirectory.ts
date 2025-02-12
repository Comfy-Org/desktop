import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addRandomSuffix, pathExists } from 'tests/shared/utils';

export class TempDirectory implements AsyncDisposable {
  readonly installLocation: string = path.join(tmpdir(), addRandomSuffix('ComfyUI'));

  async [Symbol.asyncDispose](): Promise<void> {
    if (await pathExists(this.installLocation)) {
      await rm(this.installLocation, { recursive: true, force: true });
    }
  }
}
