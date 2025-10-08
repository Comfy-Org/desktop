import { ipcMain, ipcRenderer } from 'electron';

import type { IpcChannelParams, IpcChannelReturn, IpcChannels } from '@/infrastructure/ipcChannels';

// Strict alternatives to Electron's IPC objects that only expose
// the typed IPC contract. Using these avoids the permissive
// Electron overloads that accept string/any and defeat type safety.

export type StrictIpcMain = Omit<Electron.IpcMain, 'handle' | 'handleOnce' | 'removeHandler'> & {
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

  removeHandler<T extends keyof IpcChannels>(channel: T): void;
};

export type StrictIpcRenderer = Omit<Electron.IpcRenderer, 'invoke'> & {
  invoke<T extends keyof IpcChannels>(channel: T, ...args: IpcChannelParams<T>): Promise<IpcChannelReturn<T>>;
};

export const strictIpcMain: StrictIpcMain = ipcMain as unknown as StrictIpcMain;
export const strictIpcRenderer: StrictIpcRenderer = ipcRenderer as unknown as StrictIpcRenderer;

// Optional helpers for convenience (opt-in usage):
export const handle = strictIpcMain.handle.bind(strictIpcMain) as StrictIpcMain['handle'];
export const handleOnce = strictIpcMain.handleOnce.bind(strictIpcMain) as StrictIpcMain['handleOnce'];
export const removeHandler = strictIpcMain.removeHandler.bind(strictIpcMain) as StrictIpcMain['removeHandler'];
export const invoke = strictIpcRenderer.invoke.bind(strictIpcRenderer) as StrictIpcRenderer['invoke'];
