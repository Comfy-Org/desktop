import { contextBridge, ipcRenderer } from 'electron';
import path from 'node:path';

import { DownloadStatus, ELECTRON_BRIDGE_API, IPC_CHANNELS, ProgressStatus } from './constants';
import type { DownloadState } from './models/DownloadManager';
import type { DesktopInstallState, DesktopWindowStyle } from './store/desktopSettings';

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
  /** UV python mirror */
  pythonMirror?: string; // UV_PYTHON_INSTALL_MIRROR
  /** pip mirrors */
  pypiMirror?: string; // Common pip install mirror
  torchMirror?: string; // Torch install mirror
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

export type ValidationIssueState = 'OK' | 'warning' | 'error' | 'skipped';

export interface InstallValidation {
  inProgress: boolean;
  /** Whether the app just been installed, upgraded, or install is complete and the server has been started at least once. */
  installState: DesktopInstallState;

  basePath?: ValidationIssueState;
  venvDirectory?: ValidationIssueState;
  pythonInterpreter?: ValidationIssueState;
  pythonPackages?: ValidationIssueState;
  uv?: ValidationIssueState;
  git?: ValidationIssueState;
  vcRedist?: ValidationIssueState;
  managerPythonPackages?: ValidationIssueState;
}

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
  restartApp: async (customMessage?: string, delay?: number): Promise<void> => {
    console.log('Sending restarting app message to main process with custom message:', customMessage);
    await ipcRenderer.invoke(IPC_CHANNELS.RESTART_APP, { customMessage, delay });
  },
  /** Exits the application gracefully. */
  quit: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.QUIT),
  /** @todo Move to {@link electronAPI.Validation} */
  reinstall: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REINSTALL);
  },
  /**
   * Various paths that are useful to the renderer.
   * - Base path: The base path of the application.
   * - Model config path: The path to the model config yaml file.
   */
  getBasePath: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_BASE_PATH);
  },
  /**
   * Opens a directory picker, saves the result as the base path if not cancelled.
   * @returns `true` if a new base path was selected and set successfully, otherwise `false`
   */
  setBasePath: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.SET_BASE_PATH),

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

      // Ensure discard of return value (Electron.IpcRenderer)
      return () => {
        ipcRenderer.off(IPC_CHANNELS.TERMINAL_ON_OUTPUT, handler);
      };
    },
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
   * @todo Move to {@link electronAPI.Validation}
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
    setWindowStyle: (style: DesktopWindowStyle): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SET_WINDOW_STYLE, style);
    },
    getWindowStyle: (): Promise<DesktopWindowStyle | undefined> => {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_STYLE);
    },
  },
  Events: {
    trackEvent: (eventName: string, properties?: Record<string, unknown>): void => {
      ipcRenderer.send(IPC_CHANNELS.TRACK_EVENT, eventName, properties);
    },

    incrementUserProperty: (propertyName: string, number: number): void => {
      ipcRenderer.send(IPC_CHANNELS.INCREMENT_USER_PROPERTY, propertyName, number);
    },
  },
  NetWork: {
    canAccessUrl: (url: string, options?: { timeout?: number }): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CAN_ACCESS_URL, url, options);
    },
  },
  /** Restart the python server without restarting desktop. */
  restartCore: async (): Promise<void> => {
    console.log('Restarting core process');
    await ipcRenderer.invoke(IPC_CHANNELS.RESTART_CORE);
  },
  /** Gets the platform reported by node.js */
  getPlatform: () => process.platform,
  setMetricsConsent: async (consent: boolean) => {
    await ipcRenderer.invoke(IPC_CHANNELS.SET_METRICS_CONSENT, consent);
  },

  /**
   *  Interfaces related to installation / install validation
   *
   * Example usage:
   * ```typescript
   * // Set up validation listener
   * electronAPI.Validation.onUpdate((update) => {
   *   const validationInProgress.value = update.inProgress;
   *
   *   for (const [task, state] of Object.entries(update)) {
   *     if (task === 'installState' && !state) installApp();
   *     if (task === 'git' && state === 'error') downloadGit();
   *   }
   * });
   *
   * // Start installation validation
   * await electronAPI.Validation.validateInstallation((update) => {
   *   if (update.pythonInterpreter === 'error') {
   *     console.error('Python interpreter validation failed');
   *   }
   * });
   *
   * // Get current validation state
   * const status = await electronAPI.Validation.getStatus();
   *
   * // Clean up when done
   * electronAPI.Validation.dispose();
   * ```
   */
  Validation: {
    /**
     * Sets a callback to receive updates during validation.
     * If an existing callback is set, it will be replaced.
     * @param callback Called with every update during validation
     */
    onUpdate(callback: (update: InstallValidation) => void) {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.VALIDATION_UPDATE);
      ipcRenderer.on(IPC_CHANNELS.VALIDATION_UPDATE, (_event, value: InstallValidation) => {
        console.debug(`Received ${IPC_CHANNELS.VALIDATION_UPDATE} event`, value);
        callback(value);
      });
    },

    /** Requests the current state of validation, for use by UI when initialising a component.  */
    getStatus: (): Promise<InstallValidation> => ipcRenderer.invoke(IPC_CHANNELS.GET_VALIDATION_STATE),

    /**
     * Attempts to complete validation, returning `true` if successful.
     * @returns A promise that resolves when validation is complete, `true` if validation was successful, otherwise `false`
     */
    complete: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.COMPLETE_VALIDATION),

    /**
     * Initiates validation.  Notifies updates via callback.
     * If an existing callback is set, it will be replaced.
     * @param callback Called with every update during validation
     * @returns A promise that resolves when validation is complete. The final {@link onUpdate} callback will have run in the main process, but the IPC event may not yet have hit the renderer when this promise resolves.
     */
    validateInstallation: async (callback: (update: InstallValidation) => void) => {
      electronAPI.Validation.onUpdate(callback);
      await ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_INSTALLATION);
    },

    // TODO: Add cancel validation IPC method to offer a way out of slow validation (e.g. filesystem unresponsive)

    /** Removes the validation update listener. Simpler than verifying determinism of UPDATE and COMPLETE. */
    dispose: () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.VALIDATION_UPDATE);
    },
  },

  troubleshoot: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.TROUBLESHOOT);
  },

  uv: {
    /**
     * Install the requirements for the ComfyUI server.
     * @returns A promise that resolves when the uv command is complete.
     */
    installRequirements: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.UV_INSTALL_REQUIREMENTS),

    /**
     * Clears the uv cache of all downloaded packages.
     * @returns `true` if the cache was cleared successfully, otherwise `false`
     */
    clearCache: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.UV_CLEAR_CACHE),

    /**
     * Resets the virtual environment by deleting the venv directory.
     * @returns `true` if the virtual environment was reset successfully, otherwise `false`
     */
    resetVenv: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.UV_RESET_VENV),
  },
} as const;

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld(ELECTRON_BRIDGE_API, electronAPI);
