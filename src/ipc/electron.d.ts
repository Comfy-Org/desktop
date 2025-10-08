/**
 * Module augmentation for Electron IPC to provide compile-time type safety.
 *
 * This augmentation enhances ipcMain.handle and ipcRenderer.invoke with generic types
 * based on the IPC channel contract defined in ./contract.ts.
 *
 * Zero runtime overhead - this is purely a compile-time enhancement.
 *
 * Note: This file uses inline type imports to maintain its status as an ambient
 * declaration file, which is required for proper module augmentation.
 */
declare namespace Electron {
  interface IpcMain {
    /**
     * Type-safe version of ipcMain.handle
     *
     * @param channel - The IPC channel name (must match a key in IpcChannels)
     * @param listener - Handler function with typed parameters and return value
     */
    handle<T extends import('./contract').IpcChannelName>(
      channel: T,
      listener: (
        event: IpcMainInvokeEvent,
        ...args: import('./contract').IpcChannelParams<T>
      ) => Promise<import('./contract').IpcChannelReturn<T>> | import('./contract').IpcChannelReturn<T>
    ): void;

    /**
     * Type-safe version of ipcMain.handleOnce
     *
     * @param channel - The IPC channel name (must match a key in IpcChannels)
     * @param listener - Handler function with typed parameters and return value
     */
    handleOnce<T extends import('./contract').IpcChannelName>(
      channel: T,
      listener: (
        event: IpcMainInvokeEvent,
        ...args: import('./contract').IpcChannelParams<T>
      ) => Promise<import('./contract').IpcChannelReturn<T>> | import('./contract').IpcChannelReturn<T>
    ): void;

    /**
     * Type-safe version of ipcMain.removeHandler
     *
     * @param channel - The IPC channel name (must match a key in IpcChannels)
     */
    removeHandler<T extends import('./contract').IpcChannelName>(channel: T): void;
  }

  interface IpcRenderer {
    /**
     * Type-safe version of ipcRenderer.invoke
     *
     * @param channel - The IPC channel name (must match a key in IpcChannels)
     * @param args - Parameters for the channel (must match the contract)
     * @returns Promise resolving to the channel's return type
     */
    invoke<T extends import('./contract').IpcChannelName>(
      channel: T,
      ...args: import('./contract').IpcChannelParams<T>
    ): Promise<import('./contract').IpcChannelReturn<T>>;
  }
}

export {};
