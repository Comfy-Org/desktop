import { ipcMain, ipcRenderer } from 'electron';

import type { IpcChannelParams, IpcChannelReturn, IpcChannels } from '@/infrastructure/ipcChannels';

/**
 * Strict alternatives to Electron's IPC objects that only expose
 * the typed IPC contract. Using these avoids the permissive
 * Electron overloads that accept string/any and defeat type safety.
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

export const strictIpcMain: StrictIpcMain = ipcMain;
export const strictIpcRenderer: StrictIpcRenderer = ipcRenderer;
