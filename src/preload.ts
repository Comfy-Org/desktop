// preload.ts

import { contextBridge, DownloadItem, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API } from './constants';
import { DownloadStatus } from './models/DownloadManager';

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
  onDefaultInstallLocation: (callback: (location: string) => void) => void;
  sendReady: () => void;
  restartApp: (customMessage?: string, delay?: number) => void;
  onOpenDevTools: (callback: () => void) => void;
  isPackaged: () => Promise<boolean>;
  openDialog: (options: Electron.OpenDialogOptions) => Promise<string[] | undefined>;
  /**
   * Open the logs folder in the system's default file explorer.
   */
  openLogsFolder: () => void;
  DownloadManager: {
    onDownloadProgress: (
      callback: (progress: {
        url: string;
        progress_percentage: number;
        status: DownloadStatus;
        message?: string;
      }) => void
    ) => void;
    startDownload: (url: string, path: string, filename: string) => Promise<boolean>;
    cancelDownload: (url: string) => Promise<boolean>;
    pauseDownload: (url: string) => Promise<boolean>;
    resumeDownload: (url: string) => Promise<boolean>;
    deleteModel: (filename: string, path: string) => Promise<boolean>;
    getAllDownloads: () => Promise<DownloadItem[]>;
  };
}

const electronAPI: ElectronAPI = {
  onProgressUpdate: (callback: (update: { status: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOADING_PROGRESS, (_event, value) => {
      console.info(`Received ${IPC_CHANNELS.LOADING_PROGRESS} event`, value);
      callback(value);
    });
  },
  onLogMessage: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOG_MESSAGE, (_event, value) => {
      console.info(`Received ${IPC_CHANNELS.LOG_MESSAGE} event`, value);
      callback(value);
    });
  },
  sendReady: () => {
    console.log('Sending ready event to main process');
    ipcRenderer.send(IPC_CHANNELS.RENDERER_READY);
  },
  isPackaged: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.IS_PACKAGED);
  }, //Emulates app.ispackaged in renderer
  restartApp: (customMessage?: string, delay?: number): void => {
    console.log('Sending restarting app message to main process with custom message: ', customMessage);
    ipcRenderer.send(IPC_CHANNELS.RESTART_APP, { customMessage, delay });
  },
  onOpenDevTools: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.OPEN_DEVTOOLS, () => callback());
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
  onDefaultInstallLocation: (callback: (location: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DEFAULT_INSTALL_LOCATION, (_event, value) => {
      console.log(`Received ${IPC_CHANNELS.DEFAULT_INSTALL_LOCATION} event`, value);
      callback(value);
    });
  },
  openLogsFolder: () => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_LOGS_FOLDER);
  },
  DownloadManager: {
    onDownloadProgress: (
      callback: (progress: {
        url: string;
        progress_percentage: number;
        status: DownloadStatus;
        message?: string;
      }) => void
    ) => {
      ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, (_event, progress) => callback(progress));
    },
    startDownload: (url: string, path: string, filename: string): Promise<boolean> => {
      console.log(`Sending start download message to main process`, { url, path, filename });
      return ipcRenderer.invoke(IPC_CHANNELS.START_DOWNLOAD, { url, path, filename });
    },
    cancelDownload: (url: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_DOWNLOAD, url);
    },
    pauseDownload: (url: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PAUSE_DOWNLOAD, url);
    },
    resumeDownload: (url: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.RESUME_DOWNLOAD, url);
    },
    deleteModel: (filename: string, path: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DELETE_MODEL, { filename, path });
    },
    getAllDownloads: (): Promise<DownloadItem[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ALL_DOWNLOADS);
    },
  },
};

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
