import { IpcMainInvokeEvent, app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useComfySettings } from '@/config/comfySettings';
import { ProgressStatus } from '@/constants';
import { IPC_CHANNELS } from '@/constants';
import { DesktopApp } from '@/desktopApp';
import { InstallationManager } from '@/install/installationManager';
import type { IAppState } from '@/main-process/appState';
import { ComfyDesktopApp } from '@/main-process/comfyDesktopApp';
import type { ComfyInstallation } from '@/main-process/comfyInstallation';
import { DevOverrides } from '@/main-process/devOverrides';
import SentryLogging from '@/services/sentry';
import type { ITelemetry } from '@/services/telemetry';
import { promptMetricsConsent } from '@/services/telemetry';
import type { DesktopConfig } from '@/store/desktopConfig';

// Mock dependencies
vi.mock('electron', () => ({
  app: {
    quit: vi.fn(() => {
      throw new Error('Test exited via app.quit()');
    }),
    exit: vi.fn(() => {
      throw new Error('Test exited via app.exit()');
    }),
    getPath: vi.fn().mockReturnValue('/mock/app/path'),
    getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    once: vi.fn(),
    handle: vi.fn(),
    handleOnce: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const mockAppWindow = {
  loadPage: vi.fn().mockResolvedValue(undefined),
  send: vi.fn(),
  sendServerStartProgress: vi.fn(),
  loadComfyUI: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/main-process/appWindow', () => ({
  AppWindow: vi.fn().mockImplementation(() => mockAppWindow),
}));

vi.mock('@/config/comfySettings', () => ({
  ComfySettings: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockReturnValue('true'),
      set: vi.fn(),
      saveSettings: vi.fn(),
    }),
  },
  useComfySettings: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue('true'),
    set: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue('/mock/path'),
    set: vi.fn(),
  }),
}));

const mockInstallation: Partial<ComfyInstallation> = {
  basePath: '/mock/path',
  virtualEnvironment: {} as any,
  validation: {} as any,
  hasIssues: false,
  isValid: true,
  state: 'installed',
  telemetry: {} as ITelemetry,
};

const mockInstallationManager = {
  ensureInstalled: vi.fn().mockResolvedValue(mockInstallation),
};
vi.mock('@/install/installationManager', () => ({
  InstallationManager: Object.assign(
    vi.fn(() => mockInstallationManager),
    { setReinstallHandler: vi.fn() }
  ),
}));

const mockComfyDesktopApp = {
  buildServerArgs: vi.fn().mockResolvedValue({ port: '8188' }),
  startComfyServer: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/main-process/comfyDesktopApp', () => ({
  ComfyDesktopApp: vi.fn().mockImplementation(() => mockComfyDesktopApp),
}));

vi.mock('@/services/sentry', () => ({
  default: {
    setSentryGpuContext: vi.fn().mockResolvedValue(undefined),
    getBasePath: vi.fn(),
  },
}));

vi.mock('@/services/telemetry', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    hasConsent: false,
    track: vi.fn(),
    flush: vi.fn(),
  }),
  promptMetricsConsent: vi.fn().mockResolvedValue(true),
}));

describe('DesktopApp', () => {
  let desktopApp: DesktopApp;
  let mockAppState: IAppState;
  let mockOverrides: Partial<DevOverrides>;
  let mockConfig: DesktopConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAppState = {
      isQuitting: false,
      ipcRegistered: false,
      loaded: false,
      currentPage: undefined,
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      emitIpcRegistered: vi.fn(),
      emitLoaded: vi.fn(),
    };
    mockOverrides = {
      useExternalServer: false,
      COMFY_HOST: undefined,
      COMFY_PORT: undefined,
    };
    mockConfig = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      getAsync: vi.fn(),
      setAsync: vi.fn(),
      permanentlyDeleteConfigFile: vi.fn(),
    } as unknown as DesktopConfig;

    desktopApp = new DesktopApp(mockAppState, mockOverrides as DevOverrides, mockConfig);
  });

  describe('showLoadingPage', () => {
    it('should load the desktop-start page successfully', async () => {
      await desktopApp.showLoadingPage();
      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('desktop-start');
    });

    it('should handle errors when loading the start page', async () => {
      const error = new Error('Failed to load');
      mockAppWindow.loadPage.mockRejectedValueOnce(error);

      await expect(desktopApp.showLoadingPage).rejects.toThrow('Test exited via app.quit()');

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Startup failed',
        expect.stringContaining('Unknown error whilst loading start screen')
      );
      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should initialize and start the app successfully', async () => {
      await desktopApp.start();

      expect(InstallationManager).toHaveBeenCalled();
      expect(ComfyDesktopApp).toHaveBeenCalled();
      expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.READY);
    });

    it('should handle installation failure', async () => {
      vi.mocked(mockInstallationManager.ensureInstalled).mockRejectedValueOnce(new Error('Installation failed'));

      await desktopApp.start();

      expect(ComfyDesktopApp).not.toHaveBeenCalled();
      expect(mockAppWindow.sendServerStartProgress).not.toHaveBeenCalledWith(ProgressStatus.READY);
    });

    it('should handle server start failure', async () => {
      const error = new Error('Server start failed');
      vi.mocked(mockComfyDesktopApp.startComfyServer).mockRejectedValueOnce(error);

      await desktopApp.start();

      expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.ERROR);
      expect(mockAppWindow.send).toHaveBeenCalledWith(
        IPC_CHANNELS.LOG_MESSAGE,
        expect.stringContaining(error.toString())
      );
    });

    it('should skip server start when using external server', async () => {
      mockOverrides = { ...mockOverrides, useExternalServer: true };
      desktopApp = new DesktopApp(mockAppState, mockOverrides as DevOverrides, mockConfig);

      await desktopApp.start();

      expect(mockComfyDesktopApp.startComfyServer).not.toHaveBeenCalled();
      expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.READY);
    });

    it('should handle unhandled exceptions during startup', async () => {
      const error = new Error('Unexpected error');
      vi.mocked(mockComfyDesktopApp.buildServerArgs).mockImplementationOnce(() => {
        throw error;
      });

      await expect(() => desktopApp.start()).rejects.toThrow('Test exited via app.quit()');

      expect(log.error).toHaveBeenCalledWith('Unhandled exception during app startup', error);
      expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.ERROR);
      expect(dialog.showErrorBox).toHaveBeenCalled();
      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('initializeTelemetry', () => {
    let testInstallation: ComfyInstallation;

    beforeEach(() => {
      testInstallation = mockInstallation as ComfyInstallation;
      vi.mocked(promptMetricsConsent).mockClear();
    });

    it('should initialize telemetry with user consent', async () => {
      vi.mocked(promptMetricsConsent).mockResolvedValueOnce(true);
      vi.mocked(mockConfig.get).mockReturnValue('true');
      vi.mocked(useComfySettings().get).mockReturnValue('true');

      await desktopApp['initializeTelemetry'](testInstallation);

      expect(promptMetricsConsent).toHaveBeenCalledWith(mockConfig, mockAppWindow);
      expect(SentryLogging.setSentryGpuContext).toHaveBeenCalled();
      expect(desktopApp.telemetry.hasConsent).toBe(true);
      expect(desktopApp.telemetry.flush).toHaveBeenCalled();
    });

    it('should respect user rejection of telemetry', async () => {
      vi.mocked(promptMetricsConsent).mockResolvedValueOnce(false);
      vi.mocked(mockConfig.get).mockReturnValue('false');
      vi.mocked(useComfySettings().get).mockReturnValue('false');

      await desktopApp['initializeTelemetry'](testInstallation);

      expect(promptMetricsConsent).toHaveBeenCalledWith(mockConfig, mockAppWindow);
      expect(SentryLogging.setSentryGpuContext).toHaveBeenCalled();
      expect(desktopApp.telemetry.hasConsent).toBe(false);
      expect(desktopApp.telemetry.flush).not.toHaveBeenCalled();
    });
  });

  describe('fatalError', () => {
    it('should show error dialog and quit with message', () => {
      const message = 'Fatal error occurred';
      const title = 'Error Title';

      expect(() => DesktopApp.fatalError({ message, title })).toThrow('Test exited via app.quit()');

      expect(dialog.showErrorBox).toHaveBeenCalledWith(title, message);
      expect(app.quit).toHaveBeenCalled();
    });

    it('should exit with code when provided', () => {
      const exitCode = 1;

      expect(() => DesktopApp.fatalError({ message: 'Error', exitCode })).toThrow('Test exited via app.exit()');

      expect(app.exit).toHaveBeenCalledWith(exitCode);
      expect(app.quit).not.toHaveBeenCalled();
    });

    it('should log error when provided', () => {
      const error = new Error('Test error');
      const message = 'Fatal error occurred';

      expect(() => DesktopApp.fatalError({ message, error })).toThrow('Test exited via app.quit()');

      expect(log.error).toHaveBeenCalledWith(message, error);
    });
  });

  describe('registerIpcHandlers', () => {
    it('should register all handlers and emit ipcRegistered', () => {
      desktopApp['registerIpcHandlers']();

      expect(mockAppState.emitIpcRegistered).toHaveBeenCalled();
      expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.START_TROUBLESHOOTING, expect.any(Function));
    });

    it('should handle errors during registration', () => {
      vi.mocked(ipcMain.handle).mockImplementationOnce(() => {
        throw new Error('Registration failed');
      });

      expect(() => desktopApp['registerIpcHandlers']()).toThrow('Test exited via app.exit()');
      expect(app.exit).toHaveBeenCalledWith(2024);
    });
  });

  describe('showTroubleshootingPage', () => {
    it('should show troubleshooting page and restart app', async () => {
      desktopApp.installation = mockInstallation as ComfyInstallation;

      // Mock IPC handler registration for COMPLETE_VALIDATION
      vi.mocked(ipcMain.handleOnce).mockImplementationOnce(
        (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any) => {
          // Simulate completion by calling the handler
          setTimeout(() => handler({} as IpcMainInvokeEvent, {}), 0);
          return vi.fn();
        }
      );

      await desktopApp.showTroubleshootingPage();

      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('maintenance');
      expect(ipcMain.handleOnce).toHaveBeenCalledWith(IPC_CHANNELS.COMPLETE_VALIDATION, expect.any(Function));
    });

    it('should fail if installation is not complete', async () => {
      desktopApp.installation = undefined;

      await expect(() => desktopApp.showTroubleshootingPage()).rejects.toThrow('Test exited via app.exit()');

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Critical error',
        expect.stringContaining('An error was detected, but the troubleshooting page could not be loaded')
      );
      expect(app.exit).toHaveBeenCalledWith(2001);
    });

    it('should handle errors during troubleshooting page load', async () => {
      desktopApp.installation = mockInstallation as ComfyInstallation;
      mockAppWindow.loadPage.mockRejectedValueOnce(new Error('Failed to load maintenance page'));

      await expect(() => desktopApp.showTroubleshootingPage()).rejects.toThrow('Test exited via app.exit()');

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        'Critical error',
        expect.stringContaining('An error was detected, but the troubleshooting page could not be loaded')
      );
      expect(app.exit).toHaveBeenCalledWith(2001);
    });
  });
});
