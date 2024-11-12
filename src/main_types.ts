export * from './constants';
export type { ElectronAPI } from './preload';

import { ElectronAPI } from './preload';
declare global {
  const electronAPI: ElectronAPI;
}
