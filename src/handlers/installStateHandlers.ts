import { ipcMain } from 'electron';

import { IPC_CHANNELS, InstallStage } from '../constants';
import { useAppState } from '../main-process/appState';
import { type InstallStageInfo, createInstallStageInfo } from '../main-process/installStages';

/**
 * Registers IPC handlers for installation state management
 */
export function registerInstallStateHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_INSTALL_STAGE, (): InstallStageInfo => {
    const appState = useAppState();
    // Return the current install stage from app state, or default to IDLE
    return appState.installStage || createInstallStageInfo(InstallStage.IDLE);
  });

  // Listen for install stage changes and broadcast to renderer
  const appState = useAppState();
  appState.on('installStageChanged', (stage: InstallStageInfo) => {
    const windows = require('electron').BrowserWindow.getAllWindows();
    windows.forEach((window) => {
      window.webContents.send(IPC_CHANNELS.INSTALL_STAGE_UPDATE, stage);
    });
  });
}
