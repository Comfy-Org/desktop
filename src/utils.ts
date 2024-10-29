import * as fsPromises from 'node:fs/promises';
import path from 'node:path';

export async function pathAccessible(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

export function getModelsDirectory(comfyUIBasePath: string): string {
  return path.join(comfyUIBasePath, 'models');
}
