import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../constants';
import { useDesktopConfig } from '../store/desktopConfig';
import type { TorchDeviceType } from '../preload';

/**
 * Handles information about the app and current state in IPC channels.
 */
export class AppInfoHandlers {
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
