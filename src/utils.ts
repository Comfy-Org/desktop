import * as fsPromises from 'node:fs/promises';

export async function pathAccessible(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}
