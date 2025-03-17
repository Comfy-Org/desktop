import { ipcMain } from 'electron';
import log from 'electron-log/main';
import mv from 'mv';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { ComfyServerConfig } from '@/config/comfyServerConfig';

import { IPC_CHANNELS } from '../constants';

export function registerImportModelHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_MODEL,
    async (_, filePath: string, type: string, mode: 'move' | 'copy'): Promise<void> => {
      try {
        const configPath = ComfyServerConfig.configPath;
        const config = await ComfyServerConfig.readConfigFile(configPath);
        if (!config) {
          throw new Error('Unable to read extra_model_paths.yaml');
        }

        // Find all config sections that have the type defined.
        let sections = Object.entries(config)
          .filter((c) => c[1][type])
          .sort((a, b) => +a[1].is_default - +b[1].is_default)
          .map((c) => c[0]);

        // If no config sections with the type defined, use either the default or the first config section.
        if (!sections.length) {
          const defaultSection = Object.entries(config).find((c) => c[1].is_default)?.[0] ?? Object.keys(config)[0];
          sections = [defaultSection];
        }

        const targetConfig = config[sections[0]];
        let basePath = targetConfig.base_path;
        if (targetConfig.download_model_base) {
          basePath = path.join(basePath, targetConfig.download_model_base);
        }

        const folderName = targetConfig[type] ?? type;
        const destinationDir = path.join(basePath, folderName);
        const destinationPath = path.join(destinationDir, path.basename(filePath));

        if (!existsSync(destinationDir)) {
          await mkdir(destinationDir, { recursive: true });
        }

        log.info(mode, filePath, '->', destinationPath);

        await (mode === 'move'
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
