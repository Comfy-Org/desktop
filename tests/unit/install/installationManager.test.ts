import { app } from 'electron';
import fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyServerConfig } from '@/config/comfyServerConfig';
import { ComfySettings } from '@/config/comfySettings';
import { IPC_CHANNELS } from '@/constants';
import { InstallationManager } from '@/install/installationManager';
import type { AppWindow } from '@/main-process/appWindow';
import { ComfyInstallation } from '@/main-process/comfyInstallation';
import type { InstallValidation } from '@/preload';
import type { ITelemetry } from '@/services/telemetry';
import { useDesktopConfig } from '@/store/desktopConfig';
import * as utils from '@/utils';

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(() => Promise.resolve('{}')),
  },
  access: vi.fn(),
  readFile: vi.fn(() => Promise.resolve('{}')),
}));

const config = {
  get: vi.fn((key: string) => {
    if (key === 'installState') return 'installed';
    if (key === 'basePath') return 'valid/base';
  }),
  set: vi.fn((key: string, value: string) => {
    if (key !== 'basePath') throw new Error(`Unexpected key: ${key}`);
    if (!value) throw new Error(`Unexpected value: [${value}]`);
  }),
};
vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn(() => config),
}));

vi.mock('@/main-process/appState', () => ({
  useAppState: vi.fn(() => ({
    setInstallStage: vi.fn(),
    installStage: { stage: 'idle', timestamp: Date.now() },
  })),
}));

vi.mock('@/utils', async () => {
  const actual = await vi.importActual<typeof utils>('@/utils');
  return {
    ...actual,
    pathAccessible: vi.fn((path: string) => {
      const isValid = path.startsWith('valid/') || path.endsWith(`\\System32\\vcruntime140.dll`);
      return Promise.resolve(isValid);
    }),
    canExecute: vi.fn(() => Promise.resolve(true)),
    canExecuteShellCommand: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock('@/config/comfyServerConfig', () => {
  return {
    ComfyServerConfig: {
      configPath: 'valid/extra_models_config.yaml',
      exists: vi.fn(() => Promise.resolve(true)),
      readBasePathFromConfig: vi.fn(() =>
        Promise.resolve({
          status: 'success',
          path: 'valid/base',
        })
      ),
    },
  };
});

// Mock VirtualEnvironment with basic implementation
vi.mock('@/virtualEnvironment', () => {
  return {
    VirtualEnvironment: vi.fn(() => ({
      exists: vi.fn(() => Promise.resolve(true)),
      hasRequirements: vi.fn(() => Promise.resolve(true)),
      pythonInterpreterPath: 'valid/python',
      uvPath: 'valid/uv',
      venvPath: 'valid/venv',
      comfyUIRequirementsPath: 'valid/requirements.txt',
      comfyUIManagerRequirementsPath: 'valid/manager-requirements.txt',
      legacyComfyUIManagerRequirementsPath: 'valid/legacy-manager-requirements.txt',
    })),
  };
});

// Mock Telemetry
vi.mock('@/services/telemetry', () => ({
  getTelemetry: vi.fn(() => ({
    track: vi.fn(),
  })),
  trackEvent: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
}));

const createMockAppWindow = () => {
  const mock = {
    send: vi.fn(),
    loadPage: vi.fn(() => Promise.resolve(null)),
    showOpenDialog: vi.fn(),
    maximize: vi.fn(),
  };
  return mock as unknown as AppWindow;
};

const createMockTelemetry = (): ITelemetry => ({
  track: vi.fn(),
  hasConsent: true,
  flush: vi.fn(),
  registerHandlers: vi.fn(),
  loadGenerationCount: vi.fn(),
});

describe('InstallationManager', () => {
  let manager: InstallationManager;
  let mockAppWindow: ReturnType<typeof createMockAppWindow>;
  let validationUpdates: InstallValidation[];

  beforeEach(async () => {
    validationUpdates = [];

    // Reset fs mocks with default behaviors - only the ones we need
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);

    mockAppWindow = createMockAppWindow();
    manager = new InstallationManager(mockAppWindow, createMockTelemetry());

    vi.mocked(ComfyServerConfig.readBasePathFromConfig).mockResolvedValue({
      status: 'success',
      path: 'valid/base',
    });

    // Initialize ComfySettings before creating ComfyInstallation
    await ComfySettings.load('valid/base');

    // Capture validation updates
    vi.spyOn(mockAppWindow, 'send').mockImplementation((channel: string, data: unknown) => {
      if (channel === IPC_CHANNELS.VALIDATION_UPDATE) {
        validationUpdates.push({ ...(data as InstallValidation) });
      }
    });

    // Wait for any pending promises
    await Promise.resolve();
  });

  describe('ensureInstalled', () => {
    beforeEach(() => {
      vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(() =>
        Promise.resolve(new ComfyInstallation('installed', 'valid/base', createMockTelemetry()))
      );
    });

    it('returns existing valid installation', async () => {
      const result = await manager.ensureInstalled();

      expect(result).toBeDefined();
      expect(result.hasIssues).toBe(false);
      expect(result.isValid).toBe(true);
      expect(mockAppWindow.loadPage).not.toHaveBeenCalledWith('maintenance');
    });

    it.each([
      {
        scenario: 'detects invalid base path',
        mockSetup: () => {
          vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(() =>
            Promise.resolve(new ComfyInstallation('installed', 'invalid/base', createMockTelemetry()))
          );
          vi.mocked(useDesktopConfig().get).mockImplementation((key: string) => {
            if (key === 'installState') return 'installed';
            if (key === 'basePath') return 'invalid/base';
          });
        },
        expectedErrors: ['basePath'],
      },
      {
        scenario: 'detects unsafe base path inside app install root',
        mockSetup: () => {
          vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(() =>
            Promise.resolve(new ComfyInstallation('installed', 'valid/app/config', createMockTelemetry()))
          );
          vi.mocked(useDesktopConfig().get).mockImplementation((key: string) => {
            if (key === 'installState') return 'installed';
            if (key === 'basePath') return 'valid/app/config';
          });
          const originalGetPath = vi.mocked(app.getPath).getMockImplementation();
          vi.mocked(app.getPath).mockImplementation((name) => {
            if (name === 'exe') return 'valid/app/ComfyUI.exe';
            return originalGetPath ? originalGetPath(name) : '/mock/app/path';
          });
          return () => {
            if (originalGetPath) {
              vi.mocked(app.getPath).mockImplementation(originalGetPath);
            }
          };
        },
        expectedErrors: ['basePath'],
      },
      {
        scenario: 'detects missing git',
        mockSetup: () => {
          vi.mocked(utils.canExecuteShellCommand).mockResolvedValue(false);
        },
        expectedErrors: ['git'],
      },
      {
        scenario: 'detects missing VC Redist on Windows',
        mockSetup: () => {
          const originalPlatform = process.platform;
          vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
          vi.mocked(utils.pathAccessible).mockImplementation((path: string) =>
            Promise.resolve(path !== `${process.env.SYSTEMROOT}\\System32\\vcruntime140.dll`)
          );
          return () => {
            vi.spyOn(process, 'platform', 'get').mockReturnValue(originalPlatform);
          };
        },
        expectedErrors: ['vcRedist'],
      },
    ])('$scenario', async ({ mockSetup, expectedErrors }) => {
      const cleanup = mockSetup?.() as (() => void) | undefined;

      vi.spyOn(
        manager as unknown as { resolveIssues: (installation: ComfyInstallation) => Promise<boolean> },
        'resolveIssues'
      ).mockResolvedValueOnce(true);

      await manager.ensureInstalled();

      const finalValidation = validationUpdates.at(-1);
      expect(finalValidation).toBeDefined();
      for (const error of expectedErrors) {
        expect(finalValidation?.[error as keyof InstallValidation]).toBe('error');
      }

      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('maintenance');

      cleanup?.();
    });
  });
});
