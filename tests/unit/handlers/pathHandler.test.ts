import { type IpcMainEvent, ipcMain } from 'electron';
import { app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import si from 'systeminformation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyConfigManager } from '../../../src/config/comfyConfigManager';
import { ComfyServerConfig } from '../../../src/config/comfyServerConfig';
import { IPC_CHANNELS } from '../../../src/constants';
import { PathHandlers } from '../../../src/handlers/pathHandlers';
import type { SystemPaths } from '../../../src/preload';

const REQUIRED_SPACE = 10 * 1024 * 1024 * 1024; // 10GB
const DEFAULT_FREE_SPACE = 20 * 1024 * 1024 * 1024; // 20GB
const LOW_FREE_SPACE = 5 * 1024 * 1024 * 1024; // 5GB

const MOCK_PATHS = {
  userData: '/mock/user/data',
  logs: '/mock/logs/path',
  documents: '/mock/documents',
  appData: '/mock/appData',
  appPath: '/mock/app/path',
} as const;

vi.mock('electron', () => {
  return {
    ipcMain: {
      on: vi.fn(),
      handle: vi.fn(),
    },
    app: {
      getPath: vi.fn((name: string): string => {
        switch (name) {
          case 'userData':
            return '/mock/user/data';
          case 'logs':
            return '/mock/logs/path';
          case 'documents':
            return '/mock/documents';
          case 'appData':
            return '/mock/appData';
          default:
            return `/mock/${name}`;
        }
      }),
      getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
    },
    shell: {
      openPath: vi.fn(),
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
  };
});

vi.mock('systeminformation');
vi.mock('node:fs');
vi.mock('../../../src/config/comfyServerConfig', () => ({
  ComfyServerConfig: {
    EXTRA_MODEL_CONFIG_PATH: 'extra_models_config.yaml',
    configPath: '/mock/user/data/extra_models_config.yaml',
  },
}));

vi.mock('../../../src/config/comfyConfigManager', () => ({
  ComfyConfigManager: {
    isComfyUIDirectory: vi.fn(),
  },
}));

const mockDiskSpace = (available: number) => {
  vi.mocked(si.fsSize).mockResolvedValue([
    {
      fs: 'test',
      type: 'test',
      size: 100,
      used: 0,
      available,
      mount: '/',
      use: 0,
      rw: true,
    },
  ]);
};

const mockFileSystem = ({ exists = true, writable = true } = {}) => {
  vi.mocked(fs.existsSync).mockReturnValue(exists);
  if (writable) {
    vi.mocked(fs.accessSync).mockReturnValue();
  } else {
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });
  }
};

interface ValidationResult {
  isValid: boolean;
  error?: string;
  freeSpace: number;
  requiredSpace: number;
}

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

describe('PathHandlers', () => {
  let pathHandlers: PathHandlers;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(app.getPath).mockImplementation(
      (name: string) => (MOCK_PATHS as Record<string, string>)[name] ?? `/mock/${name}`
    );
    vi.mocked(app.getAppPath).mockReturnValue(MOCK_PATHS.appPath);
    vi.mocked(shell.openPath).mockResolvedValue('');

    pathHandlers = new PathHandlers();
    pathHandlers.registerHandlers();
  });

  describe('validate-install-path', () => {
    let validateHandler: HandlerType<(event: unknown, path: string) => Promise<unknown>>;

    beforeEach(() => {
      validateHandler = getRegisteredHandler(IPC_CHANNELS.VALIDATE_INSTALL_PATH);
      mockDiskSpace(DEFAULT_FREE_SPACE);
    });

    it('accepts valid install path with sufficient space', async () => {
      mockFileSystem({ exists: true, writable: true });

      const result = await validateHandler({}, '/valid/path');
      expect(result).toEqual({
        isValid: true,
        exists: true,
        freeSpace: DEFAULT_FREE_SPACE,
        requiredSpace: REQUIRED_SPACE,
      });
    });

    it('rejects path with insufficient disk space', async () => {
      mockFileSystem({ exists: true, writable: true });
      mockDiskSpace(LOW_FREE_SPACE);

      const result = await validateHandler({}, '/low/space/path');
      expect(result).toEqual({
        isValid: false,
        exists: true,
        freeSpace: LOW_FREE_SPACE,
        requiredSpace: REQUIRED_SPACE,
      });
    });

    it('rejects path with missing parent directory', async () => {
      mockFileSystem({ exists: false });

      const result = await validateHandler({}, '/missing/parent/path');
      expect(result).toEqual({
        isValid: false,
        parentMissing: true,
        freeSpace: DEFAULT_FREE_SPACE,
        requiredSpace: REQUIRED_SPACE,
      });
    });

    it('rejects non-writable path', async () => {
      mockFileSystem({ exists: true, writable: false });

      const result = await validateHandler({}, '/non/writable/path');
      expect(result).toEqual({
        isValid: false,
        cannotWrite: true,
        exists: true,
        freeSpace: DEFAULT_FREE_SPACE,
        requiredSpace: REQUIRED_SPACE,
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
        appPath: '/mock/app/path',
        defaultInstallPath: path.join('/mock/documents', 'ComfyUI'),
      });
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

  describe('validate-install-path error handling', () => {
    let validateHandler: HandlerType<(event: unknown, path: string) => Promise<ValidationResult>>;

    beforeEach(() => {
      validateHandler = getRegisteredHandler<(event: unknown, path: string) => Promise<ValidationResult>>(
        IPC_CHANNELS.VALIDATE_INSTALL_PATH
      );
      mockDiskSpace(DEFAULT_FREE_SPACE);
    });

    it('should handle and log errors during validation', async () => {
      const mockError = new Error('Test error');
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw mockError;
      });
      vi.spyOn(log, 'error').mockImplementation(() => {});

      const result = await validateHandler({}, '/error/path');
      expect(result).toEqual({
        isValid: false,
        error: 'Error: Test error',
        freeSpace: -1,
        requiredSpace: PathHandlers.REQUIRED_SPACE,
      });
      expect(log.error).toHaveBeenCalledWith('Error validating install path:', mockError);
    });
  });
});
