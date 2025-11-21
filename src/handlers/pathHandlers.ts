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

export type RestrictedPathType = 'appInstallDir' | 'updaterCache' | 'oneDrive';

interface RestrictedPathEntry {
  type: RestrictedPathType;
  path: string;
}

const getWindowsSystemDrivePrefix = (): string => {
  const envValue = process.env.SystemDrive?.trim();
  if (envValue && /^[a-z]:/i.test(envValue)) {
    return envValue.slice(0, 2);
  }
  return 'C:';
};

const getWindowsSystemDriveRoot = (): string => `${getWindowsSystemDrivePrefix()}\\`;

const normalizePathForComparison = (targetPath?: string): string | undefined => {
  if (!targetPath) return undefined;
  let trimmed = targetPath.trim();
  if (!trimmed) return undefined;
  if (process.platform === 'win32' && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    trimmed = `${getWindowsSystemDrivePrefix()}${trimmed}`;
  }
  const resolvedPath = path.resolve(trimmed);
  const caseInsensitivePlatform = process.platform === 'win32' || process.platform === 'darwin';
  return caseInsensitivePlatform ? resolvedPath.toLowerCase() : resolvedPath;
};

const isPathInside = (candidate: string, parent: string): boolean => {
  if (candidate === parent) return true;
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeMountPoint = (mount?: string): string | undefined => {
  if (!mount) return undefined;
  const trimmed = mount.trim();
  if (!trimmed) return undefined;

  // Windows' systeminformation mounts sometimes come through as "C:". Append a
  // trailing separator so path.resolve() treats the value as the drive root.
  if (/^[a-z]:$/i.test(trimmed)) {
    return normalizePathForComparison(`${trimmed}\\`);
  }

  if (process.platform === 'win32') {
    const normalized = trimmed.replaceAll('/', '\\');
    if (normalized === '\\') {
      return normalizePathForComparison(getWindowsSystemDriveRoot());
    }
  }

  return normalizePathForComparison(trimmed);
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

  // 1. The actual application install directory (dynamic)
  // On Windows/Linux, this is the folder containing the executable.
  // On macOS, this is the .app bundle.
  const exePath = app.getPath('exe');
  const resolvedExePath = path.resolve(exePath);
  if (process.platform === 'darwin') {
    // Walk up until we find the .app bundle
    let current = resolvedExePath;
    while (current && current !== '/' && !current.endsWith('.app')) {
      const next = path.dirname(current);
      if (next === current) break; // Guard against dirname('.') or other non-progress cases
      current = next;
    }
    if (current.endsWith('.app')) {
      addRestrictedPath('appInstallDir', current);
    } else {
      // Fallback if not in a bundle: just protect the exe's folder
      addRestrictedPath('appInstallDir', path.dirname(resolvedExePath));
    }
  } else {
    addRestrictedPath('appInstallDir', path.dirname(exePath));
  }

  // 2. The "resources" directory (often contains app.asar)
  // This is usually inside the install dir, but good to be explicit.
  addRestrictedPath('appInstallDir', process.resourcesPath);

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      // 3. Legacy/default install location for user-scope installs.
      // Even if current builds install elsewhere (e.g., ToDesktop-created folders),
      // we keep this older comfyui-electron path blacklisted so anyone still on that
      // target won't accidentally store data where the app lives.
      addRestrictedPath('appInstallDir', path.join(localAppData, 'Programs', 'comfyui-electron'));

      // 4. Updater cache directories
      // These are hardcoded by electron-updater to be in LocalAppData
      addRestrictedPath('updaterCache', path.join(localAppData, 'comfyui-electron-updater'));
      addRestrictedPath('updaterCache', path.join(localAppData, '@comfyorgcomfyui-electron-updater'));
    }

    // 5. OneDrive
    if (process.env.OneDrive) {
      addRestrictedPath('oneDrive', process.env.OneDrive);
    }
  }

  return entries;
};

export interface PathRestrictionFlags {
  normalizedPath?: string;
  isInsideAppInstallDir: boolean;
  isInsideUpdaterCache: boolean;
  isOneDrive: boolean;
}

export const evaluatePathRestrictions = (inputPath: string): PathRestrictionFlags => {
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
            const normalizedMount = normalizeMountPoint(disk.mount);
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
        (!bypassSpaceCheck && result.freeSpace >= 0 && result.freeSpace < requiredSpace) ||
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
