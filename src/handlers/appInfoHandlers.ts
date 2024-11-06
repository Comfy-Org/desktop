import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../constants';

export class AppInfoHandlers {
  constructor() {}

  registerHandlers() {
    ipcMain.handle(IPC_CHANNELS.IS_PACKAGED, () => {
      return app.isPackaged;
    });

    ipcMain.handle(IPC_CHANNELS.GET_ELECTRON_VERSION, () => {
      return app.getVersion();
    });
  }
}
