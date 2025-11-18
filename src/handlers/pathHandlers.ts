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

type RestrictedPathType = 'appInstallDir' | 'updaterCache' | 'oneDrive';

interface RestrictedPathEntry {
  type: RestrictedPathType;
  path: string;
}

const normalizePathForComparison = (targetPath?: string): string | undefined => {
  if (!targetPath) return undefined;
  const trimmed = targetPath.trim();
  if (!trimmed) return undefined;
  const resolvedPath = path.resolve(trimmed);
  const caseInsensitivePlatform = process.platform === 'win32' || process.platform === 'darwin';
  return caseInsensitivePlatform ? resolvedPath.toLowerCase() : resolvedPath;
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
    // app.getPath('appData') returns Roaming. The updater/install roots sit beside it.
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

  const maybeAddBundleParents = (type: RestrictedPathType, candidate: string) => {
    // macOS bundles replace everything under .app on update. Climb from Resources → Contents → *.app.
    const basename = path.basename(candidate).toLowerCase();
    if (basename === 'resources') {
      const contentsPath = path.resolve(candidate, '..');
      addRestrictedPath(type, contentsPath);
      maybeAddBundleParents(type, contentsPath);
      return;
    }

    if (basename === 'contents') {
      const bundleRoot = path.resolve(candidate, '..');
      // Only consider typical macOS bundle directories.
      if (bundleRoot.toLowerCase().endsWith('.app')) {
        addRestrictedPath(type, bundleRoot);
      }
    }
  };

  const addInstallRootCandidates = (type: RestrictedPathType, rawPath?: string) => {
    if (!rawPath) return;
    const normalized = normalizePathForComparison(rawPath);
    if (!normalized) return;
    const immediateParent = path.resolve(rawPath, '..');
    addRestrictedPath(type, immediateParent);
    maybeAddBundleParents(type, immediateParent);
  };

  const appPath = app.getAppPath();
  addInstallRootCandidates('appInstallDir', appPath);

  const resourcesPath = process.resourcesPath;
  addInstallRootCandidates('appInstallDir', resourcesPath);

  if (process.platform === 'win32') {
    // Desktop installs and auto-updates live under LocalAppData. Treat every root we control
    // there as restricted so user data can't be dropped inside paths that get replaced/deleted.
    for (const localPath of getLocalAppDataCandidates()) {
      addRestrictedPath('appInstallDir', path.resolve(localPath, 'Programs', 'comfyui-electron'));
      for (const folder of ['@comfyorgcomfyui-electron-updater', 'comfyui-electron-updater']) {
        addRestrictedPath('updaterCache', path.resolve(localPath, folder));
      }
    }
    const { OneDrive } = process.env;
    if (OneDrive) {
      // OneDrive sync deletions will conflict with installs. Treat the root as restricted.
      addRestrictedPath('oneDrive', OneDrive);
    }
  }

  return entries;
};

interface PathRestrictionFlags {
  normalizedPath?: string;
  isInsideAppInstallDir: boolean;
  isInsideUpdaterCache: boolean;
  isOneDrive: boolean;
}

const evaluatePathRestrictions = (inputPath: string): PathRestrictionFlags => {
  const normalizedPath = normalizePathForComparison(inputPath);
  const flags: PathRestrictionFlags = {
    normalizedPath,
    isInsideAppInstallDir: false,
    isInsideUpdaterCache: false,
    isOneDrive: false,
  };

  if (!normalizedPath) return flags;

  for (const restricted of buildRestrictedPaths()) {
    if (!isPathInside(normalizedPath, restricted.path)) continue;
    if (restricted.type === 'updaterCache') {
      flags.isInsideUpdaterCache = true;
    } else if (restricted.type === 'oneDrive') {
      flags.isOneDrive = true;
    } else {
      flags.isInsideAppInstallDir = true;
    }

    if (flags.isInsideAppInstallDir && flags.isInsideUpdaterCache && flags.isOneDrive) break;
  }

  return flags;
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
        const restrictionFlags = evaluatePathRestrictions(inputPath);
        const normalizedPath = restrictionFlags.normalizedPath;
        result.isInsideAppInstallDir = restrictionFlags.isInsideAppInstallDir;
        result.isInsideUpdaterCache = restrictionFlags.isInsideUpdaterCache;
        result.isOneDrive ||= restrictionFlags.isOneDrive;

        if (result.isInsideAppInstallDir || result.isInsideUpdaterCache || result.isOneDrive) {
          log.warn(
            'VALIDATE_INSTALL_PATH [restricted]: inputPath: [',
            inputPath,
            '], insideAppInstallDir: ',
            result.isInsideAppInstallDir,
            ' insideUpdaterCache: ',
            result.isInsideUpdaterCache,
            ' insideOneDrive: ',
            restrictionFlags.isOneDrive
          );
        }

        if (process.platform === 'win32') {
          // Check if path is on non-default drive
          const systemDrive = process.env.SystemDrive || 'C:';
          log.verbose('systemDrive [', systemDrive, ']');
          // Compare using the normalized (lowercase) paths so user casing tricks cannot bypass the check.
          if (normalizedPath && !normalizedPath.startsWith(systemDrive.toLowerCase())) {
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
          const disk = disks.find((disk) => {
            const normalizedMount = normalizePathForComparison(disk.mount);
            return normalizedMount && normalizedPath && isPathInside(normalizedPath, normalizedMount);
          });
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
