import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../constants';
import { useAppState } from '../main-process/appState';
import type { InstallStageInfo } from '../main-process/installStages';

/**
 * Register IPC handlers for install state management
 */
export function registerInstallStateHandlers() {
  const appState = useAppState();

  // Handler to get current install stage
  ipcMain.handle(IPC_CHANNELS.GET_INSTALL_STAGE, (): InstallStageInfo => {
    return appState.installStage;
  });

  // Listen for install stage changes and broadcast to renderer
  appState.on('installStageChanged', (stageInfo: InstallStageInfo) => {
    // Find all windows and send update
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send(IPC_CHANNELS.INSTALL_STAGE_UPDATE, stageInfo);
    }
  });
}
