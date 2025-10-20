import { ipcMain, ipcRenderer } from 'electron';

import type { IPC_CHANNELS, ProgressStatus } from '@/constants';
import type { InstallStageInfo } from '@/main-process/installStages';
import type { DownloadState } from '@/models/DownloadManager';
import type {
  DownloadProgressUpdate,
  ElectronContextMenuOptions,
  ElectronOverlayOptions,
  InstallOptions,
  InstallValidation,
  PathValidationResult,
  SystemPaths,
  TorchDeviceType,
} from '@/preload';
import type { ComfyProtocolAction } from '@/protocol/protocolParser';
import type { DesktopWindowStyle } from '@/store/desktopSettings';

/**
 * Type-safe version of Electron's {@link Electron.IpcMain}.
 */
export const strictIpcMain: StrictIpcMain = ipcMain;

/**
 * Type-safe version of Electron's {@link Electron.IpcRenderer}.
 */
export const strictIpcRenderer: StrictIpcRenderer = ipcRenderer;

/**
 * Type-safe version of Electron's {@link Electron.IpcMain}.
 * Uses explicitly-typed channels and params, catching type errors at compile time.
 */
interface StrictIpcMain extends Electron.IpcMain {
  handle<T extends keyof IpcChannels>(
    channel: T,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: IpcChannelParams<T>
    ) => IpcChannelReturn<T> | Promise<IpcChannelReturn<T>>
  ): void;

  handleOnce<T extends keyof IpcChannels>(
    channel: T,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: IpcChannelParams<T>
    ) => IpcChannelReturn<T> | Promise<IpcChannelReturn<T>>
  ): void;

  on<T extends keyof IpcChannels>(
    channel: T,
    listener: (event: Electron.IpcMainEvent, ...args: IpcChannelParams<T>) => unknown
  ): this;

  once<T extends keyof IpcChannels>(
    channel: T,
    listener: (event: Electron.IpcMainEvent, ...args: IpcChannelParams<T>) => unknown
  ): this;

  removeAllListeners<T extends keyof IpcChannels>(channel?: T): this;
  removeHandler<T extends keyof IpcChannels>(channel: T): void;
  removeListener<T extends keyof IpcChannels>(channel: T, listener: (...args: IpcChannelParams<T>) => unknown): this;
}

/**
 * Type-safe version of Electron's {@link Electron.IpcRenderer}.
 * Uses explicitly-typed channels and params, catching type errors at compile time.
 */
interface StrictIpcRenderer extends Electron.IpcRenderer {
  invoke<T extends keyof IpcChannels>(channel: T, ...args: IpcChannelParams<T>): Promise<IpcChannelReturn<T>>;

  on<T extends keyof IpcChannels>(
    channel: T,
    listener: (event: Electron.IpcRendererEvent, ...args: IpcChannelParams<T>) => void
  ): this;

  off<T extends keyof IpcChannels>(
    channel: T,
    listener: (event: Electron.IpcRendererEvent, ...args: IpcChannelParams<T>) => void
  ): this;

  once<T extends keyof IpcChannels>(
    channel: T,
    listener: (event: Electron.IpcRendererEvent, ...args: IpcChannelParams<T>) => void
  ): this;

  send<T extends keyof IpcChannels>(channel: T, ...args: IpcChannelParams<T>): void;
}

/**
 * Extract parameter types for a given channel
 */
type IpcChannelParams<T extends keyof IpcChannels> = IpcChannels[T]['params'];

/**
 * Extract return type for a given channel
 */
type IpcChannelReturn<T extends keyof IpcChannels> = IpcChannels[T]['return'];

/**
 * Central IPC contract defining all Electron IPC channels with their parameter and return types.
 *
 * This type extends {@link IPC_CHANNELS} from constants.ts by adding type information for
 * ALL IPC channels. Channel names are derived from IPC_CHANNELS to maintain a single source of truth.
 *
 * Each channel maps to an object with:
 * params: A tuple of parameter types for the channel
 * return: The return type (void for one-way send/on channels)
 */
export interface IpcChannels {
  [IPC_CHANNELS.IS_PACKAGED]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.GET_ELECTRON_VERSION]: {
    params: [];
    return: string;
  };

  [IPC_CHANNELS.GET_BASE_PATH]: {
    params: [];
    return: string | undefined;
  };

  [IPC_CHANNELS.SET_BASE_PATH]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.GET_MODEL_CONFIG_PATH]: {
    params: [];
    return: string;
  };

  [IPC_CHANNELS.GET_GPU]: {
    params: [];
    return: TorchDeviceType | undefined;
  };

  [IPC_CHANNELS.SET_WINDOW_STYLE]: {
    params: [style: DesktopWindowStyle];
    return: void;
  };

  [IPC_CHANNELS.GET_WINDOW_STYLE]: {
    params: [];
    return: DesktopWindowStyle | undefined;
  };

  [IPC_CHANNELS.QUIT]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.RESTART_APP]: {
    params: [options: { customMessage?: string; delay?: number }];
    return: void;
  };

  [IPC_CHANNELS.REINSTALL]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.RESTART_CORE]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.CHECK_FOR_UPDATES]: {
    params: [options?: object];
    return: { isUpdateAvailable: boolean; version?: string };
  };

  [IPC_CHANNELS.RESTART_AND_INSTALL]: {
    params: [options?: object];
    return: void;
  };

  [IPC_CHANNELS.GET_SYSTEM_PATHS]: {
    params: [];
    return: SystemPaths;
  };

  [IPC_CHANNELS.VALIDATE_INSTALL_PATH]: {
    params: [path: string, bypassSpaceCheck?: boolean];
    return: PathValidationResult;
  };

  [IPC_CHANNELS.VALIDATE_COMFYUI_SOURCE]: {
    params: [path: string];
    return: { isValid: boolean; error?: string };
  };

  [IPC_CHANNELS.SHOW_DIRECTORY_PICKER]: {
    params: [];
    return: string;
  };

  [IPC_CHANNELS.CHECK_BLACKWELL]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.CAN_ACCESS_URL]: {
    params: [url: string, options?: { timeout?: number }];
    return: boolean;
  };

  [IPC_CHANNELS.GET_INSTALL_STAGE]: {
    params: [];
    return: InstallStageInfo;
  };

  [IPC_CHANNELS.GET_VALIDATION_STATE]: {
    params: [];
    return: InstallValidation;
  };

  [IPC_CHANNELS.VALIDATE_INSTALLATION]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.COMPLETE_VALIDATION]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.UV_INSTALL_REQUIREMENTS]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.UV_CLEAR_CACHE]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.UV_RESET_VENV]: {
    params: [];
    return: boolean;
  };

  [IPC_CHANNELS.START_TROUBLESHOOTING]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.TERMINAL_WRITE]: {
    params: [command: string];
    return: void;
  };

  [IPC_CHANNELS.TERMINAL_RESIZE]: {
    params: [cols: number, rows: number];
    return: void;
  };

  [IPC_CHANNELS.TERMINAL_RESTORE]: {
    params: [];
    return: { buffer: string[]; size: { cols: number; rows: number } };
  };

  [IPC_CHANNELS.START_DOWNLOAD]: {
    params: [details: { url: string; path: string; filename: string }];
    return: boolean;
  };

  [IPC_CHANNELS.PAUSE_DOWNLOAD]: {
    params: [url: string];
    return: void;
  };

  [IPC_CHANNELS.RESUME_DOWNLOAD]: {
    params: [url: string];
    return: void;
  };

  [IPC_CHANNELS.CANCEL_DOWNLOAD]: {
    params: [url: string];
    return: void;
  };

  [IPC_CHANNELS.GET_ALL_DOWNLOADS]: {
    params: [];
    return: DownloadState[];
  };

  [IPC_CHANNELS.DELETE_MODEL]: {
    params: [details: { filename: string; path: string }];
    return: boolean;
  };

  [IPC_CHANNELS.SET_METRICS_CONSENT]: {
    params: [consent: boolean];
    return: void;
  };

  [IPC_CHANNELS.DISABLE_CUSTOM_NODES]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.DIALOG_CLICK_BUTTON]: {
    params: [returnValue: string];
    return: boolean;
  };

  [IPC_CHANNELS.LOADING_PROGRESS]: {
    params: [progress: { status: ProgressStatus; message?: string }];
    return: void;
  };

  [IPC_CHANNELS.RENDERER_READY]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.LOG_MESSAGE]: {
    params: [level: string, message: string, ...args: unknown[]];
    return: void;
  };

  [IPC_CHANNELS.DOWNLOAD_PROGRESS]: {
    params: [progress: DownloadProgressUpdate];
    return: void;
  };

  [IPC_CHANNELS.OPEN_PATH]: {
    params: [path: string];
    return: void;
  };

  [IPC_CHANNELS.OPEN_LOGS_PATH]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.OPEN_DEV_TOOLS]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.TERMINAL_ON_OUTPUT]: {
    params: [data: string];
    return: void;
  };

  [IPC_CHANNELS.INSTALL_COMFYUI]: {
    params: [options: InstallOptions];
    return: void;
  };

  [IPC_CHANNELS.CHANGE_THEME]: {
    params: [theme: ElectronOverlayOptions];
    return: void;
  };

  [IPC_CHANNELS.SHOW_CONTEXT_MENU]: {
    params: [menu?: ElectronContextMenuOptions];
    return: void;
  };

  [IPC_CHANNELS.VALIDATION_UPDATE]: {
    params: [update: InstallValidation];
    return: void;
  };

  [IPC_CHANNELS.CANCEL_VALIDATION]: {
    params: [];
    return: void;
  };

  [IPC_CHANNELS.TRACK_EVENT]: {
    params: [eventName: string, properties?: Record<string, unknown>];
    return: void;
  };

  [IPC_CHANNELS.INCREMENT_USER_PROPERTY]: {
    params: [property: string, value: number];
    return: void;
  };

  [IPC_CHANNELS.INSTALL_STAGE_UPDATE]: {
    params: [stage: InstallStageInfo];
    return: void;
  };

  [IPC_CHANNELS.PROTOCOL_ACTION]: {
    params: [action: ComfyProtocolAction];
    return: void;
  };
}
