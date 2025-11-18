import { type IpcMainEvent, ipcMain } from 'electron';
import { app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import si from 'systeminformation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyConfigManager } from '@/config/comfyConfigManager';
import { ComfyServerConfig } from '@/config/comfyServerConfig';
import { IPC_CHANNELS } from '@/constants';
import { MAC_REQUIRED_SPACE, WIN_REQUIRED_SPACE, registerPathHandlers } from '@/handlers/pathHandlers';
import type { SystemPaths } from '@/preload';

import { electronMock } from '../setup';

const DEFAULT_FREE_SPACE = 20 * 1024 * 1024 * 1024; // 20GB
const LOW_FREE_SPACE = 5 * 1024 * 1024 * 1024; // 5GB
const LOW_FREE_SPACE_MAC = 1 * 1024 * 1024 * 1024; // 1GB
const MOCK_PATHS = {
  userData: '/mock/user/data',
  logs: '/mock/logs/path',
  documents: '/mock/documents',
  appData: '/mock/appData',
  appPath: path.join('/mock', 'ComfyUI Desktop.app', 'Contents', 'Resources', 'app.asar'),
  exe: path.join('/mock', 'ComfyUI Desktop.app', 'Contents', 'MacOS', 'ComfyUI Desktop'),
} as const;
const MOCK_RESOURCES_PATH = path.dirname(MOCK_PATHS.appPath);

// Add this mock for OneDrive environment variable
const MOCK_ONEDRIVE = String.raw`C:\Users\Test\OneDrive`;
const MOCK_SYSTEM_DRIVE = String.raw`C:`;
const MOCK_LOCAL_APP_DATA = path.win32.join('C:', 'Users', 'Test', 'AppData', 'Local');
const originalEnv = process.env;
const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
const originalResourcesPath = electronProcess.resourcesPath;

afterEach(() => {
  process.env = originalEnv;
  electronProcess.resourcesPath = originalResourcesPath;
});

electronMock.app.getPath = vi.fn((name: string) => {
  switch (name) {
    case 'userData':
      return '/mock/user/data';
    case 'logs':
      return '/mock/logs/path';
    case 'documents':
      return '/mock/documents';
    case 'appData':
      return '/mock/appData';
    case 'exe':
      return MOCK_PATHS.exe;
    default:
      return `/mock/${name}`;
  }
});

electronMock.shell = { openPath: vi.fn() };

vi.mock('systeminformation');
vi.mock('node:fs');
vi.mock('@/config/comfyServerConfig', () => ({
  ComfyServerConfig: {
    EXTRA_MODEL_CONFIG_PATH: 'extra_models_config.yaml',
    configPath: '/mock/user/data/extra_models_config.yaml',
  },
}));

vi.mock('@/config/comfyConfigManager', () => ({
  ComfyConfigManager: {
    isComfyUIDirectory: vi.fn(),
  },
}));

const mockDiskSpace = (available: number, mount = '/') => {
  vi.mocked(si.fsSize).mockResolvedValue([
    {
      fs: 'test',
      type: 'test',
      size: 100,
      used: 0,
      available,
      mount,
      use: 0,
      rw: true,
    },
  ]);
};

const mockFileSystem = ({ exists = true, writable = true, isDirectory = false, contentLength = 0 } = {}) => {
  vi.mocked(fs.existsSync).mockReturnValue(exists);
  vi.mocked(fs.statSync).mockReturnValue({
    isDirectory: () => isDirectory,
  } as unknown as fs.Stats);
  vi.mocked(fs.readdirSync).mockImplementation(() => {
    const entries = Array.from({ length: contentLength }, () => 'mock-file');
    return entries as unknown as ReturnType<typeof fs.readdirSync>;
  });
  if (writable) {
    vi.mocked(fs.accessSync).mockReturnValue();
  } else {
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });
  }
};

type HandlerType<T extends (...args: never[]) => unknown> = T;
type IpcHandler = (event: IpcMainEvent, ...args: unknown[]) => unknown;

const getRegisteredHandler = <T extends (...args: never[]) => unknown>(
  channel: string,
  isEventHandler = false
): HandlerType<T> => {
  const mockFn = isEventHandler ? vi.mocked(ipcMain.on) : vi.mocked(ipcMain.handle);
  const handler = mockFn.mock.calls.find((call) => call[0] === channel)?.[1] as IpcHandler;
  return handler as unknown as HandlerType<T>;
};

type ElectronPathName =
  | 'home'
  | 'appData'
  | 'userData'
  | 'sessionData'
  | 'temp'
  | 'exe'
  | 'module'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | 'recent'
  | 'logs'
  | 'crashDumps';

const mockPaths = (overrides: Partial<Record<ElectronPathName, string>> = {}) => {
  vi.mocked(app.getPath).mockImplementation((name: ElectronPathName): string => {
    if (name in overrides) return overrides[name]!;
    if (name in MOCK_PATHS) return MOCK_PATHS[name as keyof typeof MOCK_PATHS];
    return path.normalize(`/mock/${name}`);
  });
};

describe('PathHandlers', () => {
  beforeEach(() => {
    vi.mocked(app.getPath).mockImplementation(
      (name: string) => (MOCK_PATHS as Record<string, string>)[name] ?? `/mock/${name}`
    );
    vi.mocked(app.getAppPath).mockReturnValue(MOCK_PATHS.appPath);
    vi.mocked(shell.openPath).mockResolvedValue('');
    electronProcess.resourcesPath = MOCK_RESOURCES_PATH;

    process.env = {
      ...originalEnv,
      OneDrive: MOCK_ONEDRIVE,
      SystemDrive: MOCK_SYSTEM_DRIVE,
      LOCALAPPDATA: MOCK_LOCAL_APP_DATA,
    };

    registerPathHandlers();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validate-install-path', () => {
    let validateHandler: HandlerType<(event: unknown, path: string, bypassSpaceCheck?: boolean) => Promise<unknown>>;

    beforeEach(() => {
      validateHandler = getRegisteredHandler(IPC_CHANNELS.VALIDATE_INSTALL_PATH);
      mockDiskSpace(DEFAULT_FREE_SPACE);
      process.env = {
        ...originalEnv,
        OneDrive: MOCK_ONEDRIVE,
        SystemDrive: MOCK_SYSTEM_DRIVE,
        LOCALAPPDATA: MOCK_LOCAL_APP_DATA,
      };
    });

    it('Windows: accepts valid install path with sufficient space', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(DEFAULT_FREE_SPACE, 'C:');
      const result = await validateHandler({}, String.raw`C:\valid\path`);
      expect(result).toMatchObject({
        isValid: true,
        exists: true,
        freeSpace: DEFAULT_FREE_SPACE,
        requiredSpace: WIN_REQUIRED_SPACE,
        isOneDrive: false,
        isNonDefaultDrive: false,
        parentMissing: false,
        cannotWrite: false,
      });
    });

    it('does not exist if directory is empty', async () => {
      mockFileSystem({ exists: true, writable: true, contentLength: 0, isDirectory: true });

      const result = await validateHandler({}, '/valid/path');
      expect(result).toMatchObject({
        exists: false,
        freeSpace: DEFAULT_FREE_SPACE,
        cannotWrite: false,
      });
    });

    it('rejects paths inside the desktop install root directory', async () => {
      mockFileSystem({ exists: true, writable: true });
      const installRootChild = path.resolve(MOCK_PATHS.appPath, '..', 'config');

      const result = await validateHandler({}, installRootChild);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
        isInsideUpdaterCache: false,
      });
    });

    it('Windows: rejects path with insufficient disk space', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(LOW_FREE_SPACE);

      const result = await validateHandler({}, '/low/space/path');
      expect(result).toMatchObject({
        isValid: false,
        exists: true,
        freeSpace: LOW_FREE_SPACE,
        requiredSpace: WIN_REQUIRED_SPACE,
      });
    });

    it('Mac: accepts valid install path with sufficient space', async () => {
      if (process.platform !== 'darwin') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });

      const result = await validateHandler({}, '/valid/path');
      expect(result).toMatchObject({
        isValid: true,
        exists: true,
        freeSpace: DEFAULT_FREE_SPACE,
        requiredSpace: MAC_REQUIRED_SPACE,
      });
    });

    it('Mac: rejects path with insufficient disk space', async () => {
      if (process.platform !== 'darwin') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(LOW_FREE_SPACE_MAC);

      const result = await validateHandler({}, '/low/space/path');
      expect(result).toMatchObject({
        isValid: false,
        exists: true,
        freeSpace: LOW_FREE_SPACE_MAC,
        requiredSpace: MAC_REQUIRED_SPACE,
      });
    });

    it('rejects path with missing parent directory', async () => {
      mockFileSystem({ exists: false });

      const result = await validateHandler({}, '/missing/parent/path');
      expect(result).toMatchObject({
        isValid: false,
        parentMissing: true,
        freeSpace: DEFAULT_FREE_SPACE,
      });
    });

    it('rejects non-writable path', async () => {
      mockFileSystem({ exists: true, writable: false, isDirectory: true, contentLength: 1 });

      const result = await validateHandler({}, '/non/writable/path');
      expect(result).toMatchObject({
        isValid: false,
        cannotWrite: true,
        exists: true,
        freeSpace: DEFAULT_FREE_SPACE,
      });
    });

    it('rejects paths inside the app bundle directory', async () => {
      mockFileSystem({ exists: true, writable: true });
      const nestedAppPath = path.join(MOCK_PATHS.appPath, 'user-data');

      const result = await validateHandler({}, nestedAppPath);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
        isInsideUpdaterCache: false,
      });
    });

    it('Mac: rejects paths inside the app bundle root directory', async () => {
      if (process.platform !== 'darwin') {
        return;
      }
      mockFileSystem({ exists: true, writable: true, isDirectory: true });
      const bundleRoot = path.resolve(MOCK_PATHS.appPath, '..', '..', '..');
      const bundleChild = path.join(bundleRoot, 'user-data');

      const result = await validateHandler({}, bundleChild);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
      });
    });

    it('Mac: rejects bundle paths regardless of case', async () => {
      if (process.platform !== 'darwin') {
        return;
      }
      mockFileSystem({ exists: true, writable: true, isDirectory: true });
      const bundleRoot = path.resolve(MOCK_PATHS.appPath, '..', '..', '..');
      const weirdCasingPath = path.join(bundleRoot.toUpperCase(), 'user-data');

      const result = await validateHandler({}, weirdCasingPath);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
      });
    });

    it('Windows: should handle and log errors during validation', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      const mockError = new Error('Test error');
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw mockError;
      });
      vi.spyOn(log, 'error').mockImplementation(() => {});

      const result = await validateHandler({}, '/error/path');

      expect(result).toMatchObject({
        isValid: false,
        error: 'Error: Test error',
        freeSpace: -1,
        requiredSpace: WIN_REQUIRED_SPACE,
      });
      expect(log.error).toHaveBeenCalledWith('Error validating install path:', mockError);
    });

    it('Windows: OneDrive paths not allowed', async () => {
      mockFileSystem({ exists: true, writable: true });
      if (process.platform !== 'win32') {
        return;
      }

      const result = await validateHandler({}, String.raw`C:\Users\Test\OneDrive\ComfyUI`);

      expect(result).toMatchObject({
        isValid: false,
        isOneDrive: true,
        requiredSpace: WIN_REQUIRED_SPACE,
      });
    });

    it('Windows: non-system drive paths not allowed', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      const result = await validateHandler({}, String.raw`D:\ComfyUI`);

      expect(result).toMatchObject({
        isValid: false,
        exists: true,
        isOneDrive: false,
        isNonDefaultDrive: true,
        requiredSpace: WIN_REQUIRED_SPACE,
      });
    });

    it('Windows: accepts path with insufficient space when bypass is enabled', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(LOW_FREE_SPACE);

      const result = await validateHandler({}, '/low/space/path', true);
      expect(result).toMatchObject({
        isValid: true,
        exists: true,
        freeSpace: LOW_FREE_SPACE,
        requiredSpace: WIN_REQUIRED_SPACE,
      });
    });

    it('Windows: rejects paths inside the LocalAppData install directory', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      const installDir = path.win32.join(MOCK_LOCAL_APP_DATA, 'Programs', 'comfyui-electron', 'data');

      const result = await validateHandler({}, installDir);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
        isInsideUpdaterCache: false,
      });
    });

    it('Windows: rejects LocalAppData install directory paths regardless of case', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      const installDir = path.win32.join(MOCK_LOCAL_APP_DATA, 'Programs', 'comfyui-electron', 'data').toUpperCase();

      const result = await validateHandler({}, installDir);
      expect(result).toMatchObject({
        isValid: false,
        isInsideAppInstallDir: true,
        isInsideUpdaterCache: false,
      });
    });

    it('Windows: rejects paths inside the updater cache (new namespace)', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      const updaterPath = path.win32.join(MOCK_LOCAL_APP_DATA, '@comfyorgcomfyui-electron-updater', 'payload');

      const result = await validateHandler({}, updaterPath);
      expect(result).toMatchObject({
        isValid: false,
        isInsideUpdaterCache: true,
      });
    });

    it('Windows: rejects paths inside the updater cache (legacy namespace)', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      const updaterPath = path.win32.join(MOCK_LOCAL_APP_DATA, 'comfyui-electron-updater', 'payload');

      const result = await validateHandler({}, updaterPath);
      expect(result).toMatchObject({
        isValid: false,
        isInsideUpdaterCache: true,
      });
    });

    it('Mac: accepts path with insufficient space when bypass is enabled', async () => {
      if (process.platform !== 'darwin') {
        return;
      }
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(LOW_FREE_SPACE_MAC);

      const result = await validateHandler({}, '/low/space/path', true);
      expect(result).toMatchObject({
        isValid: true,
        exists: true,
        freeSpace: LOW_FREE_SPACE_MAC,
        requiredSpace: MAC_REQUIRED_SPACE,
      });
    });

    it('bypass does not override other validation failures', async () => {
      mockFileSystem({ exists: true, writable: false });
      mockDiskSpace(LOW_FREE_SPACE);

      const result = await validateHandler({}, '/non/writable/path', true);
      expect(result).toMatchObject({
        isValid: false,
        cannotWrite: true,
        exists: true,
        freeSpace: LOW_FREE_SPACE,
      });
    });
  });

  describe('open-logs-path', () => {
    let openLogsHandler: HandlerType<(event: unknown) => void>;

    beforeEach(() => {
      openLogsHandler = getRegisteredHandler(IPC_CHANNELS.OPEN_LOGS_PATH, true);
    });

    it('should open logs path', () => {
      openLogsHandler({});
      expect(shell.openPath).toHaveBeenCalledWith('/mock/logs/path');
    });
  });

  describe('get-model-config-path', () => {
    let getModelConfigHandler: HandlerType<(event: unknown) => string>;

    beforeEach(() => {
      getModelConfigHandler = getRegisteredHandler(IPC_CHANNELS.GET_MODEL_CONFIG_PATH);
    });

    it('should return config path', () => {
      const result = getModelConfigHandler({});
      expect(result).toBe(ComfyServerConfig.configPath);
    });
  });

  describe('open-path', () => {
    let openPathHandler: HandlerType<(event: unknown, folderPath: string) => void>;

    beforeEach(() => {
      vi.spyOn(log, 'info').mockImplementation(() => {});
      openPathHandler = getRegisteredHandler(IPC_CHANNELS.OPEN_PATH, true);
    });

    it('should log and open the specified path', () => {
      const testPath = '/test/path';
      openPathHandler({}, testPath);
      expect(log.info).toHaveBeenCalledWith(`Opening path: ${testPath}`);
      expect(shell.openPath).toHaveBeenCalledWith(testPath);
    });
  });

  describe('get-system-paths', () => {
    let getSystemPathsHandler: HandlerType<(event: unknown) => Promise<SystemPaths>>;

    beforeEach(() => {
      getSystemPathsHandler = getRegisteredHandler(IPC_CHANNELS.GET_SYSTEM_PATHS);
    });

    it('should return system paths', async () => {
      const result = await getSystemPathsHandler({});
      expect(result).toEqual({
        appData: '/mock/appData',
        appPath: MOCK_PATHS.appPath,
        defaultInstallPath: path.join('/mock/documents', 'ComfyUI'),
      });
    });

    it('Windows: should remove OneDrive from documents path', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      mockPaths({ documents: String.raw`C:\Users\Test\OneDrive\Documents` });

      const result = await getSystemPathsHandler({});
      const expected = String.raw`C:\Users\Test\Documents\ComfyUI`;
      expect(result.defaultInstallPath).toBe(expected);
    });
  });

  describe('validate-comfyui-source', () => {
    let validateComfyUIHandler: HandlerType<(event: unknown, path: string) => { isValid: boolean; error?: string }>;

    beforeEach(() => {
      validateComfyUIHandler = getRegisteredHandler(IPC_CHANNELS.VALIDATE_COMFYUI_SOURCE);
    });

    it('should return valid result for valid ComfyUI path', () => {
      vi.mocked(ComfyConfigManager.isComfyUIDirectory).mockReturnValue(true);
      const result = validateComfyUIHandler({}, '/valid/comfy/path');
      expect(result).toEqual({ isValid: true });
    });

    it('should return invalid result with error for invalid ComfyUI path', () => {
      vi.mocked(ComfyConfigManager.isComfyUIDirectory).mockReturnValue(false);
      const result = validateComfyUIHandler({}, '/invalid/comfy/path');
      expect(result).toEqual({ isValid: false, error: 'Invalid ComfyUI source path' });
    });
  });

  describe('show-directory-picker', () => {
    let showDirectoryPickerHandler: HandlerType<(event: unknown) => Promise<string>>;

    beforeEach(() => {
      showDirectoryPickerHandler = getRegisteredHandler(IPC_CHANNELS.SHOW_DIRECTORY_PICKER);
    });

    it('should return selected directory path', async () => {
      const mockPath = '/selected/directory';
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ filePaths: [mockPath], canceled: false });

      const result = await showDirectoryPickerHandler({});
      expect(result).toBe(mockPath);
      expect(dialog.showOpenDialog).toHaveBeenCalledWith({
        properties: ['openDirectory'],
      });
    });
  });
});
