import type { InstallStageInfo } from '../main-process/installStages';
import type { DownloadState } from '../models/DownloadManager';
import type { InstallValidation, PathValidationResult, SystemPaths, TorchDeviceType } from '../preload';
import type { DesktopWindowStyle } from '../store/desktopSettings';

/**
 * Central IPC contract defining all Electron IPC channels with their parameter and return types.
 *
 * Each channel maps to an object with:
 * - params: A tuple of parameter types for ipcRenderer.invoke/ipcMain.handle
 * - return: The return type of the handler
 */
export interface IpcChannels {
  'is-packaged': {
    params: [];
    return: boolean;
  };

  'get-electron-version': {
    params: [];
    return: string;
  };

  'get-base-path': {
    params: [];
    return: string | undefined;
  };

  'set-base-path': {
    params: [];
    return: boolean;
  };

  'get-model-config-path': {
    params: [];
    return: string;
  };

  'get-gpu': {
    params: [];
    return: TorchDeviceType | undefined;
  };

  'set-window-style': {
    params: [style: DesktopWindowStyle];
    return: void;
  };

  'get-window-style': {
    params: [];
    return: DesktopWindowStyle | undefined;
  };

  quit: {
    params: [];
    return: void;
  };

  'restart-app': {
    params: [options: { customMessage?: string; delay?: number }];
    return: void;
  };

  reinstall: {
    params: [];
    return: void;
  };

  'restart-core': {
    params: [];
    return: boolean;
  };

  'check-for-updates': {
    params: [options?: object];
    return: { isUpdateAvailable: boolean; version?: string };
  };

  'restart-and-install': {
    params: [options?: object];
    return: void;
  };

  'get-system-paths': {
    params: [];
    return: SystemPaths;
  };

  'validate-install-path': {
    params: [path: string, bypassSpaceCheck?: boolean];
    return: PathValidationResult;
  };

  'validate-comfyui-source': {
    params: [path: string];
    return: { isValid: boolean; error?: string };
  };

  'show-directory-picker': {
    params: [];
    return: string;
  };

  'check-blackwell': {
    params: [];
    return: boolean;
  };

  'can-access-url': {
    params: [url: string, options?: { timeout?: number }];
    return: boolean;
  };

  'get-install-stage': {
    params: [];
    return: InstallStageInfo;
  };

  'get-validation-state': {
    params: [];
    return: InstallValidation;
  };

  'start-validation': {
    params: [];
    return: void;
  };

  'complete-validation': {
    params: [];
    return: boolean;
  };

  'uv-install-requirements': {
    params: [];
    return: boolean;
  };

  'uv-clear-cache': {
    params: [];
    return: boolean;
  };

  'uv-delete-venv': {
    params: [];
    return: boolean;
  };

  'start-troubleshooting': {
    params: [];
    return: void;
  };

  'execute-terminal-command': {
    params: [command: string];
    return: string;
  };

  'resize-terminal': {
    params: [cols: number, rows: number];
    return: void;
  };

  'restore-terminal': {
    params: [];
    return: { buffer: string[]; size: { cols: number; rows: number } };
  };

  'start-download': {
    params: [details: { url: string; path: string; filename: string }];
    return: boolean;
  };

  'pause-download': {
    params: [url: string];
    return: boolean;
  };

  'resume-download': {
    params: [url: string];
    return: boolean;
  };

  'cancel-download': {
    params: [url: string];
    return: boolean;
  };

  'get-all-downloads': {
    params: [];
    return: DownloadState[];
  };

  'delete-model': {
    params: [details: { filename: string; path: string }];
    return: boolean;
  };

  'set-metrics-consent': {
    params: [consent: boolean];
    return: void;
  };

  'disable-custom-nodes': {
    params: [];
    return: void;
  };

  'dialog-click-button': {
    params: [returnValue: string];
    return: boolean;
  };
}

/**
 * Extract channel names as a union type
 */
export type IpcChannelName = keyof IpcChannels;

/**
 * Extract parameter types for a given channel
 */
export type IpcChannelParams<T extends IpcChannelName> = IpcChannels[T]['params'];

/**
 * Extract return type for a given channel
 */
export type IpcChannelReturn<T extends IpcChannelName> = IpcChannels[T]['return'];
