import { app } from 'electron';
import path from 'path';

export function getAppResourcesPath(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'assets');
}
