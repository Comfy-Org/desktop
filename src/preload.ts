// preload.ts

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API } from './constants';
import log from 'electron-log/main';

export interface ElectronAPI {
  onProgressUpdate: (callback: (update: { percentage: number; status: string }) => void) => void;
  onLogMessage: (callback: (message: string) => void) => void;
  sendReady: () => void;
  restartApp: () => void;
  isPackaged: boolean;
}

const electronAPI: ElectronAPI = {
  onProgressUpdate: (callback: (update: { percentage: number; status: string }) => void) => {
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
};

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
