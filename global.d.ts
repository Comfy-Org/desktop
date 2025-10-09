import type { ElectronAPI } from './src/preload';

declare global {
  declare const __COMFYUI_VERSION__: string;
  declare const __COMFYUI_DESKTOP_VERSION__: string;

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
