import { BrowserWindow } from 'electron';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { IPC_CHANNELS } from '../constants';
import { useAppState } from '../main-process/appState';

/**
 * Register IPC handlers for install state management
 */
export function registerInstallStateHandlers() {
  const appState = useAppState();

  // Handler to get current install stage
  ipcMain.handle(IPC_CHANNELS.GET_INSTALL_STAGE, () => appState.installStage);

  // Listen for install stage changes and broadcast to all windows
  appState.on('installStageChanged', (stageInfo) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.INSTALL_STAGE_UPDATE, stageInfo);
    }
  });
}
