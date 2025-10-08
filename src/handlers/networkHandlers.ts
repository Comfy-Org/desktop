import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { IPC_CHANNELS } from '../constants';
import { canAccessUrl } from '../utils';

export function registerNetworkHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.CAN_ACCESS_URL,
    (event, url: string, options?: { timeout?: number }): Promise<boolean> => {
      return canAccessUrl(url, options);
    }
  );
}
