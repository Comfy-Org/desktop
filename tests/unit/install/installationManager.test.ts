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

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('valid/path'),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn().mockResolvedValue('{}'),
  },
  access: vi.fn(),
  readFile: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'installState') return 'installed';
      if (key === 'basePath') return 'valid/base';
    }),
    set: vi.fn().mockImplementation((key: string, value: string) => {
      if (key !== 'basePath') throw new Error(`Unexpected key: ${key}`);
      if (!value) throw new Error(`Unexpected value: [${value}]`);
    }),
  }),
}));

vi.mock('@/utils', async () => {
  const actual = await vi.importActual<typeof utils>('@/utils');
  return {
    ...actual,
    pathAccessible: vi.fn().mockImplementation((path: string) => {
      const isValid = path.startsWith('valid/') || path.endsWith(`\\System32\\vcruntime140.dll`);
      return Promise.resolve(isValid);
    }),
    canExecute: vi.fn().mockResolvedValue(true),
    canExecuteShellCommand: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('@/config/comfyServerConfig', () => {
  return {
    ComfyServerConfig: {
      configPath: 'valid/extra_models_config.yaml',
      exists: vi.fn().mockReturnValue(true),
      readBasePathFromConfig: vi.fn().mockResolvedValue({
        status: 'success',
        path: 'valid/base',
      }),
    },
  };
});

// Mock VirtualEnvironment with basic implementation
vi.mock('@/virtualEnvironment', () => {
  return {
    VirtualEnvironment: vi.fn().mockImplementation(() => ({
      exists: vi.fn().mockResolvedValue(true),
      hasRequirements: vi.fn().mockResolvedValue(true),
      pythonInterpreterPath: 'valid/python',
      uvPath: 'valid/uv',
      venvPath: 'valid/venv',
      comfyUIRequirementsPath: 'valid/requirements.txt',
      comfyUIManagerRequirementsPath: 'valid/manager-requirements.txt',
    })),
  };
});

// Mock Telemetry
vi.mock('@/services/telemetry', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    track: vi.fn(),
  }),
  trackEvent: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
}));

const createMockAppWindow = () => {
  const mock = {
    send: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(null),
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
});

describe('InstallationManager', () => {
  let manager: InstallationManager;
  let mockAppWindow: ReturnType<typeof createMockAppWindow>;
  let validationUpdates: InstallValidation[];

  beforeEach(async () => {
    vi.clearAllMocks();
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
      // eslint-disable-next-line @typescript-eslint/require-await
      vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(async () => {
        return new ComfyInstallation('installed', 'valid/base', createMockTelemetry());
      });
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
          vi.mocked(useDesktopConfig().get).mockImplementation((key: string) => {
            if (key === 'installState') return 'installed';
            if (key === 'basePath') return 'invalid/base';
          });
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
