// preload.ts

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API } from './constants';
import log from 'electron-log/main';

export interface ElectronAPI {
  /**
   * Callback for progress updates from the main process for starting ComfyUI.
   * @param callback
   * @returns
   */
  onProgressUpdate: (callback: (update: { status: string }) => void) => void;
  /**
   * Callback for when the user clicks the "Select Directory" button in the setup wizard.
   * @param callback
   */
  selectSetupDirectory: (directory: string) => void;
  onShowSelectDirectory: (callback: () => void) => void;
  onLogMessage: (callback: (message: string) => void) => void;
  onFirstTimeSetupComplete: (callback: () => void) => void;
  sendReady: () => void;
  restartApp: () => void;
  isPackaged: boolean;
  openDialog: (options: Electron.OpenDialogOptions) => Promise<string[] | undefined>;
}

const electronAPI: ElectronAPI = {
  onProgressUpdate: (callback: (update: { status: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOADING_PROGRESS, (_event, value) => {
      log.info(`Received ${IPC_CHANNELS.LOADING_PROGRESS} event`, value);
      callback(value);
    });
  },
  onLogMessage: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOG_MESSAGE, (_event, value) => {
      log.info(`Received ${IPC_CHANNELS.LOG_MESSAGE} event`, value);
      callback(value);
    });
  },
  sendReady: () => {
    log.info('Sending ready event to main process');
    ipcRenderer.send(IPC_CHANNELS.RENDERER_READY);
  },
  isPackaged: !process.argv0.endsWith('electron.exe'), //Emulates app.ispackaged in renderer
  restartApp: (): void => {
    log.info('Sending restarting app message to main process');
    ipcRenderer.send(IPC_CHANNELS.RESTART_APP);
  },
  onShowSelectDirectory: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.SHOW_SELECT_DIRECTORY, () => callback());
  },
  selectSetupDirectory: (directory: string) => {
    ipcRenderer.send(IPC_CHANNELS.SELECTED_DIRECTORY, directory);
  },
  openDialog: (options: Electron.OpenDialogOptions) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_DIALOG, options);
  },
  onFirstTimeSetupComplete: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.FIRST_TIME_SETUP_COMPLETE, () => callback());
  },
};

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
