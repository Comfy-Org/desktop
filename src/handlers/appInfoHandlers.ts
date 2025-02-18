import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../constants';
import type { TorchDeviceType } from '../preload';
import { useDesktopConfig } from '../store/desktopConfig';
import type { DesktopWindowStyle } from '../store/desktopSettings';

/**
 * Handles information about the app and current state in IPC channels.
 */
export function registerAppInfoHandlers() {
  ipcMain.handle(IPC_CHANNELS.IS_PACKAGED, () => {
    return app.isPackaged;
  });

  ipcMain.handle(IPC_CHANNELS.GET_ELECTRON_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, (): string | undefined => {
    return useDesktopConfig().get('basePath');
  });

  // Config
  ipcMain.handle(IPC_CHANNELS.GET_GPU, async (): Promise<TorchDeviceType | undefined> => {
    return await useDesktopConfig().getAsync('detectedGpu');
  });
  ipcMain.handle(
    IPC_CHANNELS.SET_WINDOW_STYLE,
    async (_event: Electron.IpcMainInvokeEvent, style: DesktopWindowStyle): Promise<void> => {
      await useDesktopConfig().setAsync('windowStyle', style);
    }
  );
  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_STYLE, async (): Promise<DesktopWindowStyle | undefined> => {
    return await useDesktopConfig().getAsync('windowStyle');
  });
}
