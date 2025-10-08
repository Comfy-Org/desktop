import type { IpcChannelParams, IpcChannelReturn } from '@/infrastructure/ipcChannels';

import type { ElectronAPI } from './src/preload';

declare global {
  declare const __COMFYUI_VERSION__: string;
  declare const __COMFYUI_DESKTOP_VERSION__: string;

  interface Window {
    electronAPI?: ElectronAPI;
  }

  namespace Electron {
    interface IpcMain {
      /**
       * Type-safe version of ipcMain.handle
       *
       * @param channel - The IPC channel name (must match a key in IpcChannels)
       * @param listener - Handler function with typed parameters and return value
       */
      handle<T extends keyof IpcChannels>(
        channel: T,
        listener: (
          event: IpcMainInvokeEvent,
          ...args: IpcChannelParams<T>
        ) => Promise<IpcChannelReturn<T>> | IpcChannelReturn<T>
      ): void;

      /**
       * Type-safe version of ipcMain.handleOnce
       *
       * @param channel - The IPC channel name (must match a key in IpcChannels)
       * @param listener - Handler function with typed parameters and return value
       */
      handleOnce<T extends keyof IpcChannels>(
        channel: T,
        listener: (
          event: IpcMainInvokeEvent,
          ...args: IpcChannelParams<T>
        ) => Promise<IpcChannelReturn<T>> | IpcChannelReturn<T>
      ): void;

      /**
       * Type-safe version of ipcMain.removeHandler
       *
       * @param channel - The IPC channel name (must match a key in IpcChannels)
       */
      removeHandler<T extends keyof IpcChannels>(channel: T): void;
    }

    interface IpcRenderer {
      /**
       * Type-safe version of ipcRenderer.invoke
       *
       * @param channel - The IPC channel name (must match a key in IpcChannels)
       * @param args - Parameters for the channel (must match the contract)
       * @returns Promise resolving to the channel's return type
       */
      invoke<T extends keyof IpcChannels>(channel: T, ...args: IpcChannelParams<T>): Promise<IpcChannelReturn<T>>;
    }
  }
}
