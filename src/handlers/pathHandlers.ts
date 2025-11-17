import { app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import si from 'systeminformation';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { ComfyConfigManager } from '../config/comfyConfigManager';
import { ComfyServerConfig } from '../config/comfyServerConfig';
import { IPC_CHANNELS } from '../constants';
import type { PathValidationResult, SystemPaths } from '../preload';

export const WIN_REQUIRED_SPACE = 10 * 1024 * 1024 * 1024; // 10GB in bytes
export const MAC_REQUIRED_SPACE = 5 * 1024 * 1024 * 1024; // 5GB in bytes

type RestrictedPathType = 'appPath' | 'resourcesPath' | 'installDir' | 'updaterCache';

interface RestrictedPathEntry {
  type: RestrictedPathType;
  path: string;
}

const normalizePathForComparison = (targetPath?: string): string | undefined => {
  if (!targetPath) return undefined;
  const trimmed = targetPath.trim();
  if (!trimmed) return undefined;
  const resolvedPath = path.resolve(trimmed);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
};

const isPathInside = (candidate: string, parent: string): boolean => {
  if (candidate === parent) return true;
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const getLocalAppDataCandidates = (): string[] => {
  if (process.platform !== 'win32') {
    return [];
  }

  const candidates = new Set<string>();
  if (process.env.LOCALAPPDATA) {
    candidates.add(process.env.LOCALAPPDATA);
  }

  try {
    const appData = app.getPath('appData');
    if (appData) {
      candidates.add(path.resolve(appData, '..', 'Local'));
    }
  } catch {
    // Ignore failures; fall back to environment variables only.
  }

  return [...candidates];
};

const buildRestrictedPaths = (): RestrictedPathEntry[] => {
  const entries: RestrictedPathEntry[] = [];
  const seen = new Set<string>();

  const addRestrictedPath = (type: RestrictedPathType, rawPath?: string) => {
    const normalized = normalizePathForComparison(rawPath);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ type, path: normalized });
  };

  addRestrictedPath('appPath', app.getAppPath());
  addRestrictedPath('resourcesPath', process.resourcesPath);

  if (process.platform === 'win32') {
    for (const localPath of getLocalAppDataCandidates()) {
      addRestrictedPath('installDir', path.resolve(localPath, 'Programs', 'comfyui-electron'));
      for (const folder of ['@comfyorgcomfyui-electron-updater', 'comfyui-electron-updater']) {
        addRestrictedPath('updaterCache', path.resolve(localPath, folder));
      }
    }
  }

  return entries;
};

export function registerPathHandlers() {
  ipcMain.on(IPC_CHANNELS.OPEN_LOGS_PATH, (): void => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    shell.openPath(app.getPath('logs'));
  });

  ipcMain.handle(IPC_CHANNELS.GET_MODEL_CONFIG_PATH, (): string => {
    return ComfyServerConfig.configPath;
  });

  ipcMain.on(IPC_CHANNELS.OPEN_PATH, (event, folderPath: string): void => {
    log.info(`Opening path: ${folderPath}`);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    shell.openPath(folderPath).then((errorStr) => {
      if (errorStr !== '') {
        log.error(`Error opening path: ${errorStr}`);
        dialog
          .showMessageBox({
            title: 'Error Opening File',
            message: `Could not open file: ${folderPath}. Error: ${errorStr}`,
          })
          .then((response) => {
            log.info(`Open message box response: ${response.response}`);
          })
          .catch((error) => {
            log.error(`Error showing message box: ${error}`);
          });
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_PATHS, (): SystemPaths => {
    let documentsPath = app.getPath('documents');

    // Remove OneDrive from documents path if present
    if (process.platform === 'win32') {
      documentsPath = documentsPath.replace(/OneDrive\\/, '');
      // We should use path.win32.join for Windows paths
      return {
        appData: app.getPath('appData'),
        appPath: app.getAppPath(),
        defaultInstallPath: path.join(documentsPath, 'ComfyUI'),
      };
    }

    return {
      appData: app.getPath('appData'),
      appPath: app.getAppPath(),
      defaultInstallPath: path.join(documentsPath, 'ComfyUI'),
    };
  });

  /**
   * Validate the install path for the application. Check whether the path is valid
   * and writable. The disk should have enough free space to install the application.
   */
  ipcMain.handle(
    IPC_CHANNELS.VALIDATE_INSTALL_PATH,
    async (event, inputPath: string, bypassSpaceCheck = false): Promise<PathValidationResult> => {
      log.verbose('Handling VALIDATE_INSTALL_PATH: inputPath: [', inputPath, '] bypassSpaceCheck: ', bypassSpaceCheck);
      // Determine required space based on OS
      const requiredSpace = process.platform === 'darwin' ? MAC_REQUIRED_SPACE : WIN_REQUIRED_SPACE;

      const result: PathValidationResult = {
        isValid: true,
        freeSpace: -1,
        requiredSpace,
        isOneDrive: false,
        isNonDefaultDrive: false,
        parentMissing: false,
        exists: false,
        cannotWrite: false,
        isInsideAppInstallDir: false,
        isInsideUpdaterCache: false,
      };

      try {
        const normalizedInput = normalizePathForComparison(inputPath);
        if (normalizedInput) {
          for (const restricted of buildRestrictedPaths()) {
            if (!isPathInside(normalizedInput, restricted.path)) continue;
            if (restricted.type === 'updaterCache') {
              result.isInsideUpdaterCache = true;
            } else {
              result.isInsideAppInstallDir = true;
            }

            if (result.isInsideAppInstallDir && result.isInsideUpdaterCache) break;
          }

          if (result.isInsideAppInstallDir || result.isInsideUpdaterCache) {
            log.warn(
              'VALIDATE_INSTALL_PATH [restricted]: inputPath: [',
              inputPath,
              '], insideAppInstallDir: ',
              result.isInsideAppInstallDir,
              ' insideUpdaterCache: ',
              result.isInsideUpdaterCache
            );
          }
        }

        if (process.platform === 'win32') {
          // Check if path is in OneDrive
          const { OneDrive } = process.env;
          if (OneDrive) {
            const normalizedInput = path.resolve(inputPath).toLowerCase();
            const normalizedOneDrive = path.resolve(OneDrive).toLowerCase();
            // Check if the normalized OneDrive path is a parent of the input path
            log.verbose('normalizedInput [', normalizedInput, ']', 'normalizedOneDrive [', normalizedOneDrive, ']');
            if (normalizedInput.startsWith(normalizedOneDrive)) {
              result.isOneDrive = true;
            }
          }

          // Check if path is on non-default drive
          const systemDrive = process.env.SystemDrive || 'C:';
          log.verbose('systemDrive [', systemDrive, ']');
          if (!inputPath.toUpperCase().startsWith(systemDrive)) {
            result.isNonDefaultDrive = true;
          }
        }

        // Check if root path exists
        const parent = path.dirname(inputPath);
        if (!fs.existsSync(parent)) {
          result.parentMissing = true;
        }

        // Check if path exists and is not an empty directory
        if (fs.existsSync(inputPath)) {
          if (fs.statSync(inputPath).isDirectory()) {
            const contents = fs.readdirSync(inputPath);
            result.exists = contents.length > 0;
          } else {
            result.exists = true;
          }
        }

        // Check if path is writable
        try {
          fs.accessSync(parent, fs.constants.W_OK);
        } catch {
          result.cannotWrite = true;
        }

        // Check available disk space
        const disks = await si.fsSize();
        if (disks.length) {
          log.verbose('SystemInformation [fsSize]:', disks);
          const disk = disks.find((disk) => inputPath.startsWith(disk.mount));
          log.verbose('SystemInformation [disk]:', disk);
          if (disk) result.freeSpace = disk.available;
        } else {
          log.warn('SystemInformation [fsSize] is undefined. Skipping disk space check.');
          result.freeSpace = result.requiredSpace;
        }
      } catch (error) {
        log.error('Error validating install path:', error);
        result.error = `${error}`;
      }

      const hasBlockingIssues =
        result.cannotWrite ||
        result.parentMissing ||
        (!bypassSpaceCheck && result.freeSpace < requiredSpace) ||
        Boolean(result.error) ||
        result.isOneDrive ||
        result.isInsideAppInstallDir ||
        result.isInsideUpdaterCache;

      result.isValid = !hasBlockingIssues;

      log.verbose('VALIDATE_INSTALL_PATH [result]: ', result);
      return result;
    }
  );
  /**
   * Validate whether the given path is a valid ComfyUI source path.
   */
  ipcMain.handle(IPC_CHANNELS.VALIDATE_COMFYUI_SOURCE, (event, path: string): { isValid: boolean; error?: string } => {
    const isValid = ComfyConfigManager.isComfyUIDirectory(path);
    return {
      isValid,
      error: isValid ? undefined : 'Invalid ComfyUI source path',
    };
  });

  ipcMain.handle(IPC_CHANNELS.SHOW_DIRECTORY_PICKER, async (): Promise<string> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.filePaths[0];
  });
}
