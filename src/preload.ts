// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  onProgressUpdate: (callback: (update: { percentage: number; status: string }) => void) => {
    console.log("Setting up onProgressUpdate listener");
    ipcRenderer.on('loading-progress', (_event, value) => {
      console.log("Received loading-progress event", value);
      callback(value);
    });
  },
  requestProgress: () => {
    console.log("Requesting progress");
    ipcRenderer.send('request-progress');
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log("electronAPI exposed to renderer");
