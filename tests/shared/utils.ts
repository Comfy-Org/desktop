import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Dumping ground for basic utilities that can be shared by e2e and unit tests

export enum FilePermission {
  Exists = constants.F_OK,
  Readable = constants.R_OK,
  Writable = constants.W_OK,
  Executable = constants.X_OK,
}

export async function pathExists(path: string, permission: FilePermission = FilePermission.Exists) {
  try {
    await access(path, permission);
    return true;
  } catch {
    return false;
  }
}

export function getComfyUIAppDataPath() {
  switch (process.platform) {
    case 'win32':
      if (!process.env.APPDATA) throw new Error('APPDATA environment variable is not set.');
      return path.join(process.env.APPDATA, 'ComfyUI');
    case 'darwin':
      return path.join(homedir(), 'Library', 'Application Support', 'ComfyUI');
    default:
      return path.join(homedir(), '.config', 'ComfyUI');
  }
}

export function addRandomSuffix(str: string) {
  return `${str}-${randomUUID().substring(0, 8)}`;
}
