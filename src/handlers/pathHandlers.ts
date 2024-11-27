import { app, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../constants';
import log from 'electron-log/main';
import { ComfyServerConfig } from '../config/comfyServerConfig';
import type { SystemPaths } from '../preload';
import fs from 'fs';
import si from 'systeminformation';
import { ComfyConfigManager } from '../config/comfyConfigManager';
import path from 'path';

export class PathHandlers {
  static readonly REQUIRED_SPACE = 10 * 1024 * 1024 * 1024; // 10GB in bytes

  constructor() {}

  registerHandlers() {
    ipcMain.on(IPC_CHANNELS.OPEN_LOGS_PATH, (): void => {
      shell.openPath(app.getPath('logs'));
    });

    ipcMain.handle(IPC_CHANNELS.GET_MODEL_CONFIG_PATH, (): string => {
      return ComfyServerConfig.configPath;
    });

    ipcMain.on(IPC_CHANNELS.OPEN_PATH, (event, folderPath: string): void => {
      log.info(`Opening path: ${folderPath}`);
      shell.openPath(folderPath);
    });

    ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_PATHS, (): SystemPaths => {
      return {
        appData: app.getPath('appData'),
        appPath: app.getAppPath(),
        defaultInstallPath: app.getPath('documents'),
      };
    });

    /**
     * Validate the install path for the application. Check whether the path is valid
     * and writable. The disk should have enough free space to install the application.
     */
    ipcMain.handle(
      IPC_CHANNELS.VALIDATE_INSTALL_PATH,
      async (event, inputPath: string): Promise<{ isValid: boolean; error?: string }> => {
        try {
          // Check if path exists
          if (!fs.existsSync(inputPath)) {
            return { isValid: false, error: 'Path does not exist' };
          }

          // Check if `path/ComfyUI` exists
          // We are going to create a ComfyUI directory in the selected path
          if (fs.existsSync(path.join(inputPath, 'ComfyUI'))) {
            return { isValid: false, error: 'Path already contains ComfyUI/' };
          }

          // Check if path is writable
          try {
            fs.accessSync(inputPath, fs.constants.W_OK);
          } catch (err) {
            return { isValid: false, error: 'Path is not writable' };
          }

          // Check available disk space (require at least 10GB free)
          const disks = await si.fsSize();
          const disk = disks.find((disk) => inputPath.startsWith(disk.mount));
          if (disk && disk.available < PathHandlers.REQUIRED_SPACE) {
            return {
              isValid: false,
              error: 'Insufficient disk space. At least 10GB of free space is required.',
            };
          }

          return { isValid: true };
        } catch (error) {
          log.error('Error validating install path:', error);
          return {
            isValid: false,
            error: 'Failed to validate install path: ' + error,
          };
        }
      }
    );
    /**
     * Validate whether the given path is a valid ComfyUI source path.
     */
    ipcMain.handle(
      IPC_CHANNELS.VALIDATE_COMFYUI_SOURCE,
      async (event, path: string): Promise<{ isValid: boolean; error?: string }> => {
        const isValid = ComfyConfigManager.isComfyUIDirectory(path);
        return {
          isValid,
          error: isValid ? undefined : 'Invalid ComfyUI source path',
        };
      }
    );

    ipcMain.handle(IPC_CHANNELS.SHOW_DIRECTORY_PICKER, async (): Promise<string> => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      return result.filePaths[0];
    });
  }
}
