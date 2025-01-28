import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyServerConfig } from '@/config/comfyServerConfig';
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
  },
}));

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'installState') return 'installed';
      if (key === 'basePath') return 'valid/base';
    }),
  }),
}));
vi.mock('electron-log/main');

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

const createMockAppWindow = () => {
  const mock = {
    send: vi.fn(),
    loadPage: vi.fn().mockResolvedValue(null),
    showOpenDialog: vi.fn(),
    maximize: vi.fn(),
  };
  return mock as unknown as AppWindow;
};

const createMockTelemetry = () => {
  const mock = {
    track: vi.fn(),
  };
  return mock as unknown as ITelemetry;
};

describe('InstallationManager', () => {
  let manager: InstallationManager;
  let mockAppWindow: ReturnType<typeof createMockAppWindow>;
  let validationUpdates: InstallValidation[];

  beforeEach(() => {
    vi.clearAllMocks();
    validationUpdates = [];

    mockAppWindow = createMockAppWindow();
    manager = new InstallationManager(mockAppWindow, createMockTelemetry());

    vi.mocked(ComfyServerConfig.readBasePathFromConfig).mockResolvedValue({
      status: 'success',
      path: 'valid/base',
    });

    // Capture validation updates
    vi.spyOn(mockAppWindow, 'send').mockImplementation((channel: string, data: unknown) => {
      if (channel === IPC_CHANNELS.VALIDATION_UPDATE) {
        validationUpdates.push({ ...(data as InstallValidation) });
      }
    });
  });

  describe('ensureInstalled', () => {
    it('returns existing valid installation', async () => {
      const installation = new ComfyInstallation('installed', 'valid/base', createMockTelemetry());
      vi.spyOn(ComfyInstallation, 'fromConfig').mockReturnValue(installation);

      const result = await manager.ensureInstalled();

      expect(result).toBe(installation);
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

      const installation = new ComfyInstallation('installed', 'valid/base', createMockTelemetry());
      vi.spyOn(ComfyInstallation, 'fromConfig').mockReturnValue(installation);

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
