import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../constants';
import { useDesktopConfig } from '../store/desktopConfig';
import type { TorchDeviceType } from '../preload';

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

    // Config
    ipcMain.handle(IPC_CHANNELS.GET_GPU, async (): Promise<TorchDeviceType | undefined> => {
      return await useDesktopConfig().getAsync('detectedGpu');
    });
  }
}
