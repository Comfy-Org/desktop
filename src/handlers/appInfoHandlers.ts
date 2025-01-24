import { app, ipcMain } from 'electron';

import { ComfyServerConfig } from '../config/comfyServerConfig';
import { IPC_CHANNELS } from '../constants';
import type { AppWindow } from '../main-process/appWindow';
import type { TorchDeviceType } from '../preload';
import { useDesktopConfig } from '../store/desktopConfig';
import type { DesktopSettings } from '../store/desktopSettings';

/**
 * Handles information about the app and current state in IPC channels.
 */
export function registerAppInfoHandlers(appWindow: AppWindow) {
  ipcMain.handle(IPC_CHANNELS.IS_PACKAGED, () => {
    return app.isPackaged;
  });

  ipcMain.handle(IPC_CHANNELS.GET_ELECTRON_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, (): string | undefined => {
    return useDesktopConfig().get('basePath');
  });

  ipcMain.handle(IPC_CHANNELS.SET_BASE_PATH, async (): Promise<boolean> => {
    const currentBasePath = useDesktopConfig().get('basePath');

    const result = await appWindow.showOpenDialog({ properties: ['openDirectory'], defaultPath: currentBasePath });
    if (result.canceled || !(result.filePaths.length > 0)) return false;

    const basePath = result.filePaths[0];
    useDesktopConfig().set('basePath', basePath);
    // TODO: Replace with new base path config
    return await ComfyServerConfig.setBasePathInDefaultConfig(basePath);
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
