// preload.ts

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API } from './constants';

const electronAPI = {
  onProgressUpdate: (callback: (update: { percentage: number; status: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOADING_PROGRESS, (_event, value) => {
      console.log(`Received ${IPC_CHANNELS.LOADING_PROGRESS} event`, value);
      callback(value);
    });
  },
};

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
