import type { ElectronAPI } from '../preload';

/**
 * Global type declarations for the renderer process.
 *
 * This file ensures TypeScript recognizes window.electronAPI with full type safety
 * based on the API exposed via contextBridge in the preload script.
 */
declare global {
  interface Window {
    /**
     * Electron API exposed via contextBridge in the preload script.
     * Provides type-safe access to all IPC methods and event listeners.
     */
    electronAPI: ElectronAPI;
  }
}
