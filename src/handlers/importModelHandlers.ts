import { ipcMain } from 'electron';
import log from 'electron-log/main';
import mv from 'mv';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { useDesktopConfig } from '@/store/desktopConfig';

import { IPC_CHANNELS } from '../constants';

export function registerImportModelHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_MODEL,
    async (_, filePath: string, type: string, mode: 'move' | 'copy'): Promise<void> => {
      try {
        const basePath = useDesktopConfig().get('basePath');

        if (!basePath) {
          throw new Error('Base path is not set');
        }

        const destinationDir = path.join(basePath, 'models', type);
        const destinationPath = path.join(destinationDir, path.basename(filePath));

        if (!existsSync(destinationDir)) {
          await mkdir(destinationDir, { recursive: true });
        }

        log.info(mode, filePath, '->', destinationPath);

        await (mode == 'move'
          ? new Promise((resolve, reject) => {
              mv(filePath, destinationPath, (err) => {
                if (err) reject(err instanceof Error ? err : new Error(String(err)));
                else resolve(true);
              });
            })
          : copyFile(filePath, destinationPath));
      } catch (error) {
        console.error(error);
        throw error;
      }
    }
  );
}
