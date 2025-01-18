import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../constants';

export class AppHandlers {
  registerHandlers() {
    ipcMain.handle(IPC_CHANNELS.QUIT, () => app.quit());
  }
}
