import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../constants';
import { canAccessUrl } from '../utils';

export class NetworkHandlers {
  registerHandlers() {
    ipcMain.handle(
      IPC_CHANNELS.CAN_ACCESS_URL,
      (event, url: string, options?: { timeout?: number }): Promise<boolean> => {
        return canAccessUrl(url, options);
      }
    );
  }
}
