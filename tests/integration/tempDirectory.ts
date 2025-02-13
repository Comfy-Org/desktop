import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addRandomSuffix, pathExists } from 'tests/shared/utils';

export class TempDirectory implements AsyncDisposable {
  readonly path: string = path.join(tmpdir(), addRandomSuffix('ComfyUI'));

  toString() {
    return this.path;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (await pathExists(this.path)) {
      await rm(this.path, { recursive: true, force: true });
    }
  }
}
