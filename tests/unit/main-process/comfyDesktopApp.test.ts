import todesktop from '@todesktop/runtime';
import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SERVER_ARGS, IPC_CHANNELS, ProgressStatus } from '@/constants';
import type { ServerArgs } from '@/constants';
import { ComfyDesktopApp } from '@/main-process/comfyDesktopApp';
import type { ComfyInstallation } from '@/main-process/comfyInstallation';
import { ComfyServer } from '@/main-process/comfyServer';
import { DownloadManager } from '@/models/DownloadManager';
import { Terminal } from '@/shell/terminal';
import { findAvailablePort, getModelsDirectory } from '@/utils';

// Mock dependencies
vi.mock('@/config/comfySettings', () => {
  const mockSettings = {
    get: vi.fn(() => true),
    set: vi.fn(),
    saveSettings: vi.fn(),
  };
  return {
    ComfySettings: {
      load: vi.fn(() => Promise.resolve(mockSettings)),
    },
    useComfySettings: vi.fn(() => mockSettings),
  };
});

vi.mock('@todesktop/runtime', () => ({
  default: {
    init: vi.fn(),
    autoUpdater: {
      setFeedURL: vi.fn(),
    },
  },
}));

vi.mock('@/models/DownloadManager', () => ({
  DownloadManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('@/utils', () => ({
  findAvailablePort: vi.fn(),
  getModelsDirectory: vi.fn(),
}));

const mockTerminal = {
  write: vi.fn(),
  resize: vi.fn(),
  restore: vi.fn(),
};
vi.mock('@/shell/terminal', () => ({
  Terminal: vi.fn(() => mockTerminal),
}));

vi.mock('@/main-process/comfyServer', () => ({
  ComfyServer: vi.fn(),
}));

describe('ComfyDesktopApp', () => {
  let comfyDesktopApp: ComfyDesktopApp;
  let mockInstallation: ComfyInstallation;
  let mockAppWindow: any;
  let mockTelemetry: any;
  let mockComfySettings: any;
  let mockVirtualEnvironment: any;

  beforeEach(() => {
    mockComfySettings = {
      get: vi.fn(),
    };

    mockVirtualEnvironment = {
      uvPath: '/mock/uv/path',
      activateEnvironmentCommand: vi.fn().mockReturnValue('activate command'),
    };

    mockInstallation = {
      basePath: '/mock/base/path',
      comfySettings: mockComfySettings,
      virtualEnvironment: mockVirtualEnvironment,
    } as any;

    mockAppWindow = {
      isOnPage: vi.fn(),
      loadPage: vi.fn(),
      sendServerStartProgress: vi.fn(),
    };

    mockTelemetry = {};

    comfyDesktopApp = new ComfyDesktopApp(mockInstallation, mockAppWindow, mockTelemetry);
  });

  describe('constructor', () => {
    it('should register IPC handlers and initialize todesktop', () => {
      mockComfySettings.get.mockReturnValue(true);

      expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.RESTART_CORE, expect.any(Function));
      expect(todesktop.init).toHaveBeenCalledWith({
        autoCheckInterval: 60 * 60 * 1000,
        customLogger: log,
        updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
        autoUpdater: true,
      });
    });
  });

  describe('buildServerArgs', () => {
    beforeEach(() => {
      mockComfySettings.get.mockReturnValue({});
      vi.mocked(findAvailablePort).mockResolvedValue(8188);
    });

    it('should build server args with defaults', async () => {
      const result = await comfyDesktopApp.buildServerArgs({
        useExternalServer: false,
        COMFY_HOST: undefined,
        COMFY_PORT: undefined,
      });

      expect(result).toEqual({
        listen: DEFAULT_SERVER_ARGS.listen,
        port: '8188',
      });
    });

    it('should use provided host and port overrides', async () => {
      const result = await comfyDesktopApp.buildServerArgs({
        useExternalServer: false,
        COMFY_HOST: 'localhost',
        COMFY_PORT: '9000',
      });

      expect(result).toEqual({
        listen: 'localhost',
        port: '8188', // Still uses findAvailablePort result
      });
    });

    it('should not find available port when using external server', async () => {
      const result = await comfyDesktopApp.buildServerArgs({
        useExternalServer: true,
        COMFY_HOST: undefined,
        COMFY_PORT: undefined,
      });

      expect(findAvailablePort).not.toHaveBeenCalled();
      expect(result).toEqual({
        listen: DEFAULT_SERVER_ARGS.listen,
        port: DEFAULT_SERVER_ARGS.port,
      });
    });
  });

  describe('startComfyServer', () => {
    let mockServerArgs: ServerArgs;
    let mockComfyServer: any;

    beforeEach(() => {
      mockServerArgs = {
        listen: 'localhost',
        port: '8188',
      };

      mockComfyServer = {
        start: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(ComfyServer).mockImplementation(() => mockComfyServer);
      vi.mocked(getModelsDirectory).mockReturnValue('/mock/models/dir');
      mockAppWindow.isOnPage.mockReturnValue(false);
    });

    it('should start the server successfully', async () => {
      await comfyDesktopApp.startComfyServer(mockServerArgs);

      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function));
      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('server-start');
      expect(DownloadManager.getInstance).toHaveBeenCalledWith(mockAppWindow, '/mock/models/dir');
      expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.STARTING_SERVER);
      expect(ComfyServer).toHaveBeenCalledWith(
        '/mock/base/path',
        mockServerArgs,
        mockVirtualEnvironment,
        mockAppWindow,
        mockTelemetry
      );
      expect(mockComfyServer.start).toHaveBeenCalled();
    });

    it('should initialize terminal after server starts', async () => {
      await comfyDesktopApp.startComfyServer(mockServerArgs);

      expect(Terminal).toHaveBeenCalledWith(mockAppWindow, '/mock/base/path', '/mock/uv/path');
      expect(mockTerminal.write).toHaveBeenCalledWith('activate command');

      // Test terminal IPC handlers
      const writeHandler = vi
        .mocked(ipcMain.handle)
        .mock.calls.find((call) => call[0] === IPC_CHANNELS.TERMINAL_WRITE)?.[1];
      const resizeHandler = vi
        .mocked(ipcMain.handle)
        .mock.calls.find((call) => call[0] === IPC_CHANNELS.TERMINAL_RESIZE)?.[1];
      const restoreHandler = vi
        .mocked(ipcMain.handle)
        .mock.calls.find((call) => call[0] === IPC_CHANNELS.TERMINAL_RESTORE)?.[1];

      // Test write handler
      await writeHandler?.({} as any, 'test command');
      expect(mockTerminal.write).toHaveBeenCalledWith('test command');

      // Test resize handler
      await resizeHandler?.({} as any, 80, 24);
      expect(mockTerminal.resize).toHaveBeenCalledWith(80, 24);

      // Test restore handler
      await restoreHandler?.({} as any);
      expect(mockTerminal.restore).toHaveBeenCalled();
    });

    it('should handle server kill on app quit', async () => {
      await comfyDesktopApp.startComfyServer(mockServerArgs);

      // Get the quit handler
      const quitHandler = vi.mocked(app.on).mock.calls[0][1] as () => void;

      // Call the quit handler and wait for any promises
      quitHandler();

      expect(mockComfyServer.kill).toHaveBeenCalled();
    });

    it('should skip loading server-start page if already on it', async () => {
      mockAppWindow.isOnPage.mockReturnValue(true);

      await comfyDesktopApp.startComfyServer(mockServerArgs);

      expect(mockAppWindow.loadPage).not.toHaveBeenCalled();
    });
  });

  describe('IPC handlers', () => {
    describe('RESTART_CORE handler', () => {
      it('should return false if no server is running', async () => {
        const restartHandler = vi
          .mocked(ipcMain.handle)
          .mock.calls.find((call) => call[0] === IPC_CHANNELS.RESTART_CORE)?.[1];

        const result = await restartHandler?.({} as any);
        expect(result).toBe(false);
      });

      it('should restart server if one is running', async () => {
        const mockServer = {
          kill: vi.fn().mockResolvedValue(undefined),
          start: vi.fn().mockResolvedValue(undefined),
        };
        comfyDesktopApp.comfyServer = mockServer as any;

        const restartHandler = vi
          .mocked(ipcMain.handle)
          .mock.calls.find((call) => call[0] === IPC_CHANNELS.RESTART_CORE)?.[1];

        const result = await restartHandler?.({} as any);

        expect(mockServer.kill).toHaveBeenCalled();
        expect(mockServer.start).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });
  });
});
