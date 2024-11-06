import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../constants';
import { determineResourcesPaths } from '../main';
import log from 'electron-log/main';

export class PathHandlers {
  constructor() {}

  registerHandlers() {
    // Path-related handlers

    ipcMain.on(IPC_CHANNELS.OPEN_LOGS_PATH, () => {
      shell.openPath(app.getPath('logs'));
    });

    ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, async () => {
      const { basePath } = await determineResourcesPaths();
      return basePath;
    });

    ipcMain.on(IPC_CHANNELS.OPEN_PATH, (event, folderPath: string) => {
      log.info(`Opening path: ${folderPath}`);
      shell.openPath(folderPath);
    });
  }
}
