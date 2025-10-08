import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { IPC_CHANNELS } from '../constants';

const execAsync = promisify(exec);

/**
 * Handles GPU-related IPC channels.
 */
// Note: GET_GPU is handled in appInfoHandlers.ts
export function registerGpuHandlers() {
  ipcMain.handle(IPC_CHANNELS.CHECK_BLACKWELL, async () => {
    try {
      const { stdout } = await execAsync('nvidia-smi -q');
      return /Product Architecture\s*:\s*Blackwell/.test(stdout);
    } catch {
      return false;
    }
  });
}
