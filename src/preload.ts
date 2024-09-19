// preload.ts

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API } from './constants';
import log from 'electron-log/main';

const electronAPI = {
  onProgressUpdate: (callback: (update: { percentage: number; status: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOADING_PROGRESS, (_event, value) => {
      log.info(`Received ${IPC_CHANNELS.LOADING_PROGRESS} event`, value);
      callback(value);
    });
  },
};

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
