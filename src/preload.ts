import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, ELECTRON_BRIDGE_API, ProgressStatus, DownloadStatus } from './constants';
import type { DownloadState } from './models/DownloadManager';
import path from 'node:path';
import type { DesktopSettings } from './store/desktopSettings';
import { PropertyDict } from 'mixpanel';

/**
 * Open a folder in the system's default file explorer.
 * @param folderPath The path to the folder to open.
 */
const openFolder = async (folderPath: string) => {
  const basePath = await electronAPI.getBasePath();
  ipcRenderer.send(IPC_CHANNELS.OPEN_PATH, path.join(basePath, folderPath));
};

export type GpuType = 'nvidia' | 'mps' | 'unsupported';
export type TorchDeviceType = GpuType | 'cpu';

export interface InstallOptions {
  /** Base installation path */
  installPath: string;
  autoUpdate: boolean;
  allowMetrics: boolean;
  migrationSourcePath?: string;
  migrationItemIds?: string[];
  /** Torch compute device */
  device: TorchDeviceType;
}

export interface SystemPaths {
  appData: string;
  appPath: string;
  defaultInstallPath: string;
}

export interface DownloadProgressUpdate {
  url: string;
  filename: string;
  savePath: string;
  progress: number;
  status: DownloadStatus;
  message?: string;
}

/** @todo Type inference chain broken by comfyui-electron-types. This is duplication. */
export interface ElectronOverlayOptions {
  /**
   * The CSS color of the Window Controls Overlay when enabled.
   */
  color?: string;
  /**
   * The CSS color of the symbols on the Window Controls Overlay when enabled.
   */
  symbolColor?: string;
  /**
   * The height of the title bar and Window Controls Overlay in pixels.
   */
  height?: number;
}

export interface ElectronContextMenuOptions {
  type: 'system' | 'text' | 'image';
  pos?: Electron.Point;
}

/** The result of validating a path (originally for ComfyUI installation). */
export type PathValidationResult = {
  isValid: boolean;
  /** `true` if the parent of the selected path (via `dirname()`) is not present (it must be present). */
  parentMissing?: boolean;
  /** `true` if the selected path already exists. */
  exists?: boolean;
  /** `true` if the selected path is not writable. */
  cannotWrite?: boolean;
  /** The amount of free space in the path. `-1` if this could not be determined. */
  freeSpace: number;
  /** The amount of space in bytes required to install ComfyUI. */
  requiredSpace: number;
  /** If any unhandled exceptions occured, this is the result of casting the error to string. */
  error?: string;
};

const electronAPI = {
  /**
   * Callback for progress updates from the main process for starting ComfyUI.
   * @param callback
   */
  onProgressUpdate: (callback: (update: { status: ProgressStatus }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOADING_PROGRESS, (_event, value) => {
      console.debug(`Received ${IPC_CHANNELS.LOADING_PROGRESS} event`, value);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      callback(value);
    });
  },
  onLogMessage: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LOG_MESSAGE, (_event, value) => {
      console.debug(`Received ${IPC_CHANNELS.LOG_MESSAGE} event`, value);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      callback(value);
    });
  },
  sendReady: () => {
    console.log('Sending ready event to main process');
    ipcRenderer.send(IPC_CHANNELS.RENDERER_READY);
  },
  /** Emulates app.ispackaged in renderer */
  isPackaged: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.IS_PACKAGED);
  },
  restartApp: (customMessage?: string, delay?: number): void => {
    console.log('Sending restarting app message to main process with custom message:', customMessage);
    ipcRenderer.send(IPC_CHANNELS.RESTART_APP, { customMessage, delay });
  },
  reinstall: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REINSTALL);
  },
  openDialog: (options: Electron.OpenDialogOptions) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_DIALOG, options);
  },
  /**
   * Various paths that are useful to the renderer.
   * - Base path: The base path of the application.
   * - Model config path: The path to the model config yaml file.
   */
  getBasePath: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_BASE_PATH);
  },
  getModelConfigPath: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MODEL_CONFIG_PATH);
  },
  /**
   * Open various folders in the system's default file explorer.
   */
  openLogsFolder: () => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_LOGS_PATH);
  },
  openModelsFolder: () => openFolder('models'),
  openOutputsFolder: () => openFolder('output'),
  openInputsFolder: () => openFolder('input'),
  openCustomNodesFolder: () => openFolder('custom_nodes'),
  openModelConfig: async () => {
    const modelConfigPath = await electronAPI.getModelConfigPath();
    ipcRenderer.send(IPC_CHANNELS.OPEN_PATH, modelConfigPath);
  },
  /**
   * Open the developer tools window.
   */
  openDevTools: () => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_DEV_TOOLS);
  },
  DownloadManager: {
    onDownloadProgress: (callback: (progress: DownloadProgressUpdate) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
    getAllDownloads: (): Promise<DownloadState[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ALL_DOWNLOADS);
    },
  },
  /**
   * Get the current Electron version
   */
  getElectronVersion: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ELECTRON_VERSION);
  },
  /** The ComfyUI core version (as defined in package.json) */
  getComfyUIVersion: () => __COMFYUI_VERSION__,
  Terminal: {
    /**
     * Writes the data to the terminal
     * @param data The command to execute
     */
    write: (data: string): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, data);
    },
    /**
     * Resizes the terminal
     * @param data The command to execute
     */
    resize: (cols: number, rows: number): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, cols, rows);
    },
    /**
     * Gets the data required to restore the terminal
     * @param data The command to execute
     */
    restore: (): Promise<{ buffer: string[]; size: { cols: number; rows: number } }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESTORE);
    },
    /**
     * Callback for terminal output messages
     * @param callback The output handler
     */
    onOutput: (callback: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: string) => {
        callback(value);
      };
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_ON_OUTPUT, handler);
      return () => ipcRenderer.off(IPC_CHANNELS.TERMINAL_ON_OUTPUT, handler);
    },
  },
  /**
   * Check if the user has completed the first time setup wizard.
   */
  isFirstTimeSetup: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.IS_FIRST_TIME_SETUP);
  },
  /**
   * Get the system paths for the application.
   */
  getSystemPaths: (): Promise<SystemPaths> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_SYSTEM_PATHS);
  },
  /**
   * Validate the install path for the application. Check whether the path is valid
   * and writable. The disk should have enough free space to install the application.
   */
  validateInstallPath: (path: string): Promise<PathValidationResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_INSTALL_PATH, path);
  },
  /**
   * Validate whether the given path is a valid ComfyUI source path.
   */
  validateComfyUISource: (path: string): Promise<{ isValid: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_COMFYUI_SOURCE, path);
  },
  /**
   * Show a directory picker dialog and return the selected path.
   */
  showDirectoryPicker: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_DIRECTORY_PICKER);
  },
  /**
   * Install ComfyUI with given options.
   */
  installComfyUI: (installOptions: InstallOptions) => {
    ipcRenderer.send(IPC_CHANNELS.INSTALL_COMFYUI, installOptions);
  },
  /**
   * Update the Window Controls Overlay theme overrides
   * @param theme The theme settings to apply
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API}
   */
  changeTheme: (theme: ElectronOverlayOptions): void => ipcRenderer.send(IPC_CHANNELS.CHANGE_THEME, theme),
  /**
   * Opens native context menus.
   *
   * {@link ElectronContextMenuOptions} contains the various options to control the menu type.
   * @param options Define which type of menu to use, position, etc.
   */
  showContextMenu: (options?: ElectronContextMenuOptions): void => {
    return ipcRenderer.send(IPC_CHANNELS.SHOW_CONTEXT_MENU, options);
  },
  Config: {
    /**
     * Finds the name of the last detected GPU type.  Detection only runs during installation.
     * @returns The last GPU detected by `validateHardware` - runs during installation
     */
    getDetectedGpu: async (): Promise<GpuType | undefined> => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return await ipcRenderer.invoke(IPC_CHANNELS.GET_GPU);
    },
    /** Sets the window style */
    setWindowStyle: (style: DesktopSettings['windowStyle']): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SET_WINDOW_STYLE, style);
    },
    getWindowStyle: (): Promise<DesktopSettings['windowStyle']> => {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_STYLE);
    },
    trackEvent: (eventName: string, properties?: PropertyDict): void => {
      ipcRenderer.send(IPC_CHANNELS.TRACK_EVENT, eventName, properties);
    },
  },
  /** Restart the python server without restarting desktop. */
  restartCore: async (): Promise<void> => {
    console.log('Restarting core process');
    await ipcRenderer.invoke(IPC_CHANNELS.RESTART_APP);
  },
  /** Gets the platform reported by node.js */
  getPlatform: () => process.platform,
} as const;

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
