import { IpcMainInvokeEvent, app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import { test as baseTest, describe, expect, vi } from 'vitest';

import { useComfySettings } from '@/config/comfySettings';
import { ProgressStatus } from '@/constants';
import { IPC_CHANNELS } from '@/constants';
import { DesktopApp } from '@/desktopApp';
import { InstallationManager } from '@/install/installationManager';
import { useAppState } from '@/main-process/appState';
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
    getPath: vi.fn(() => '/mock/app/path'),
    getAppPath: vi.fn(() => '/mock/app/path'),
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
  loadPage: vi.fn(),
  send: vi.fn(),
  sendServerStartProgress: vi.fn(),
  loadComfyUI: vi.fn(),
};

vi.mock('@/main-process/appWindow', () => ({
  AppWindow: vi.fn(() => mockAppWindow),
}));

vi.mock('@/config/comfySettings', () => ({
  ComfySettings: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockReturnValue('true'),
      set: vi.fn(),
      saveSettings: vi.fn(),
    }),
  },
  useComfySettings: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    saveSettings: vi.fn(),
  })),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn(() => ({
    get: vi.fn(() => '/mock/path'),
    set: vi.fn(),
  })),
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
  ensureInstalled: vi.fn(() => Promise.resolve(mockInstallation)),
};
vi.mock('@/install/installationManager', () => ({
  InstallationManager: Object.assign(
    vi.fn(() => mockInstallationManager),
    { setReinstallHandler: vi.fn() }
  ),
}));

const mockComfyDesktopApp = {
  buildServerArgs: vi.fn(),
  startComfyServer: vi.fn(),
};
vi.mock('@/main-process/comfyDesktopApp', () => ({
  ComfyDesktopApp: vi.fn(() => mockComfyDesktopApp),
}));

vi.mock('@/services/sentry', () => ({
  default: {
    setSentryGpuContext: vi.fn(),
    getBasePath: vi.fn(),
  },
}));

interface TestFixtures {
  desktopApp: DesktopApp;
  mockConfig: DesktopConfig;
}

const test = baseTest.extend<TestFixtures>({
  desktopApp: async ({ mockConfig }, use) => {
    const mockOverrides: Partial<DevOverrides> = {
      useExternalServer: false,
      COMFY_HOST: undefined,
      COMFY_PORT: undefined,
    };

    const desktopApp = new DesktopApp(mockOverrides as DevOverrides, mockConfig);

    // Clear mocks before each test
    vi.clearAllMocks();

    await use(desktopApp);
  },
  mockConfig: async ({}, use) => {
    const mockConfig = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      getAsync: vi.fn(),
      setAsync: vi.fn(),
      permanentlyDeleteConfigFile: vi.fn(),
    } as unknown as DesktopConfig;

    await use(mockConfig);
  },
});

describe('DesktopApp', () => {
  test('showLoadingPage - loads desktop-start page successfully', async ({ desktopApp }) => {
    await desktopApp.showLoadingPage();
    expect(mockAppWindow.loadPage).toHaveBeenCalledWith('desktop-start');
  });

  test('showLoadingPage - handles errors when loading start page', async ({ desktopApp }) => {
    const error = new Error('Failed to load');
    mockAppWindow.loadPage.mockRejectedValueOnce(error);

    await expect(async () => await desktopApp.showLoadingPage()).rejects.toThrow('Test exited via app.quit()');

    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      'Startup failed',
      expect.stringContaining('Unknown error whilst loading start screen')
    );
    expect(app.quit).toHaveBeenCalled();
  });

  test('start - initializes and starts app successfully', async ({ desktopApp }) => {
    await desktopApp.start();

    expect(InstallationManager).toHaveBeenCalled();
    expect(ComfyDesktopApp).toHaveBeenCalled();
    expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.READY);
  });

  test('start - handles installation failure', async ({ desktopApp }) => {
    vi.mocked(mockInstallationManager.ensureInstalled).mockRejectedValueOnce(new Error('Installation failed'));

    await desktopApp.start();

    expect(ComfyDesktopApp).not.toHaveBeenCalled();
    expect(mockAppWindow.sendServerStartProgress).not.toHaveBeenCalledWith(ProgressStatus.READY);
  });

  test('start - handles server start failure', async ({ desktopApp }) => {
    const error = new Error('Server start failed');
    vi.mocked(mockComfyDesktopApp.startComfyServer).mockRejectedValueOnce(error);

    await desktopApp.start();

    expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.ERROR);
    expect(mockAppWindow.send).toHaveBeenCalledWith(
      IPC_CHANNELS.LOG_MESSAGE,
      expect.stringContaining(error.toString())
    );
  });

  test('start - skips server start when using external server', async () => {
    const mockOverrides: Partial<DevOverrides> = {
      useExternalServer: true,
      COMFY_HOST: undefined,
      COMFY_PORT: undefined,
    };
    const mockConfig = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      getAsync: vi.fn(),
      setAsync: vi.fn(),
      permanentlyDeleteConfigFile: vi.fn(),
    } as unknown as DesktopConfig;

    const desktopApp = new DesktopApp(mockOverrides as DevOverrides, mockConfig);

    await desktopApp.start();

    expect(mockComfyDesktopApp.startComfyServer).not.toHaveBeenCalled();
    expect(mockAppWindow.sendServerStartProgress).toHaveBeenCalledWith(ProgressStatus.READY);
  });

  test('start - handles unhandled exceptions during startup', async ({ desktopApp }) => {
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

  test('initializeTelemetry - initializes with user consent', async ({ desktopApp, mockConfig }) => {
    const testInstallation = mockInstallation as ComfyInstallation;
    vi.mocked(promptMetricsConsent).mockResolvedValueOnce(true);
    vi.mocked(mockConfig.get).mockReturnValue('true');
    vi.mocked(useComfySettings().get).mockReturnValue('true');

    await desktopApp['initializeTelemetry'](testInstallation);

    expect(promptMetricsConsent).toHaveBeenCalledWith(mockConfig, mockAppWindow);
    expect(SentryLogging.setSentryGpuContext).toHaveBeenCalled();
    expect(desktopApp.telemetry.hasConsent).toBe(true);
    expect(desktopApp.telemetry.flush).toHaveBeenCalled();
  });

  test('initializeTelemetry - respects user rejection', async ({ desktopApp, mockConfig }) => {
    const testInstallation = mockInstallation as ComfyInstallation;
    vi.mocked(promptMetricsConsent).mockResolvedValueOnce(false);
    vi.mocked(mockConfig.get).mockReturnValue('false');
    vi.mocked(useComfySettings().get).mockReturnValue('false');

    await desktopApp['initializeTelemetry'](testInstallation);

    expect(promptMetricsConsent).toHaveBeenCalledWith(mockConfig, mockAppWindow);
    expect(SentryLogging.setSentryGpuContext).toHaveBeenCalled();
    expect(desktopApp.telemetry.hasConsent).toBe(false);
    expect(desktopApp.telemetry.flush).not.toHaveBeenCalled();
  });

  test('fatalError - shows error dialog and quits with message', () => {
    const message = 'Fatal error occurred';
    const title = 'Error Title';

    expect(() => DesktopApp.fatalError({ message, title })).toThrow('Test exited via app.quit()');

    expect(dialog.showErrorBox).toHaveBeenCalledWith(title, message);
    expect(app.quit).toHaveBeenCalled();
  });

  test('fatalError - exits with code when provided', () => {
    const exitCode = 1;

    expect(() => DesktopApp.fatalError({ message: 'Error', exitCode })).toThrow('Test exited via app.exit()');

    expect(app.exit).toHaveBeenCalledWith(exitCode);
    expect(app.quit).not.toHaveBeenCalled();
  });

  test('fatalError - logs error when provided', () => {
    const error = new Error('Test error');
    const message = 'Fatal error occurred';

    expect(() => DesktopApp.fatalError({ message, error })).toThrow('Test exited via app.quit()');

    expect(log.error).toHaveBeenCalledWith(message, error);
  });

  test('registerIpcHandlers - registers all handlers and emits ipcRegistered', ({ desktopApp }) => {
    desktopApp['registerIpcHandlers']();

    expect(useAppState().emitIpcRegistered).toHaveBeenCalled();
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.START_TROUBLESHOOTING, expect.any(Function));
  });

  test('registerIpcHandlers - handles errors during registration', ({ desktopApp }) => {
    vi.mocked(ipcMain.handle).mockImplementationOnce(() => {
      throw new Error('Registration failed');
    });

    expect(() => desktopApp['registerIpcHandlers']()).toThrow('Test exited via app.exit()');
    expect(app.exit).toHaveBeenCalledWith(2024);
  });

  test('showTroubleshootingPage - shows page and restarts app', async ({ desktopApp }) => {
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

  test('showTroubleshootingPage - fails if installation is not complete', async ({ desktopApp }) => {
    desktopApp.installation = undefined;

    await expect(() => desktopApp.showTroubleshootingPage()).rejects.toThrow('Test exited via app.exit()');

    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      'Critical error',
      expect.stringContaining('An error was detected, but the troubleshooting page could not be loaded')
    );
    expect(app.exit).toHaveBeenCalledWith(2001);
  });

  test('showTroubleshootingPage - handles errors during page load', async ({ desktopApp }) => {
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
