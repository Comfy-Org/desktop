export * from './constants';
export * from './models/DownloadManager';
export type { ElectronAPI } from './preload';

import { ElectronAPI } from './preload';
declare global {
  const electronAPI: ElectronAPI;
}
