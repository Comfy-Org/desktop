import { app } from 'electron';
import path from 'path';

export function getAppResourcesPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'assets');
  }

  return process.resourcesPath;
}
