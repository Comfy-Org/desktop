import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../constants';
import type { TorchDeviceType } from '../preload';
import { useDesktopConfig } from '../store/desktopConfig';
import type { DesktopSettings } from '../store/desktopSettings';

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
    ipcMain.handle(
      IPC_CHANNELS.SET_WINDOW_STYLE,
      async (_event: Electron.IpcMainInvokeEvent, style: DesktopSettings['windowStyle']): Promise<void> => {
        await useDesktopConfig().setAsync('windowStyle', style);
      }
    );
    ipcMain.handle(IPC_CHANNELS.GET_WINDOW_STYLE, async (): Promise<DesktopSettings['windowStyle']> => {
      return await useDesktopConfig().getAsync('windowStyle');
    });
  }
}
