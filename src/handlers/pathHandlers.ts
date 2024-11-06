import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../constants';
import { determineResourcesPaths } from '../main';

export class PathHandlers {
  constructor() {}

  registerHandlers() {
    // Path-related handlers
    ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, async () => {
      const { basePath } = await determineResourcesPaths();
      return basePath;
    });
  }
}
