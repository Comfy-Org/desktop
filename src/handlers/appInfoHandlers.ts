import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../constants';
/**
 * Handles static information about the app in IPC channels.
 */
export class AppInfoHandlers {
  constructor() {}

  registerHandlers() {
    ipcMain.handle(IPC_CHANNELS.IS_PACKAGED, () => {
      return app.isPackaged;
    });

    ipcMain.handle(IPC_CHANNELS.GET_ELECTRON_VERSION, () => {
      return app.getVersion();
    });

    ipcMain.handle(IPC_CHANNELS.OPEN_FORUM, () => {
      shell.openExternal('https://forum.comfy.org');
    });
    ipcMain.handle(IPC_CHANNELS.DEFAULT_INSTALL_LOCATION, () => app.getPath('documents'));
  }
}
