import { app, ipcMain } from 'electron';
import log from 'electron-log/main';

import { IPC_CHANNELS } from '../constants';

export class AppHandlers {
  registerHandlers() {
    ipcMain.handle(IPC_CHANNELS.QUIT, () => {
      log.info('Received quit IPC request. Quitting app...');
      app.quit();
    });
  }
}
