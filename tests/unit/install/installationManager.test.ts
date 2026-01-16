import { app } from 'electron';
import fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyServerConfig } from '@/config/comfyServerConfig';
import { ComfySettings } from '@/config/comfySettings';
import { IPC_CHANNELS } from '@/constants';
import {
  InstallationManager,
  isNvidiaDriverBelowMinimum,
  parseNvidiaDriverVersionFromSmiOutput,
} from '@/install/installationManager';
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

describe('parseNvidiaDriverVersionFromSmiOutput', () => {
  it('parses driver version from nvidia-smi output', () => {
    const output = String.raw`
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 591.59                 Driver Version: 591.59         CUDA Version: 13.1     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                  Driver-Model | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|                                         |                        |               MIG M. |
|=========================================+========================+======================|
|   0  NVIDIA GeForce RTX 5090      WDDM  |   00000000:01:00.0  On |                  N/A |
| 30%   31C    P3             49W /  575W |    3248MiB /  32607MiB |      1%      Default |
|                                         |                        |                  N/A |
+-----------------------------------------+------------------------+----------------------+

+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |
|        ID   ID                                                               Usage      |
|=========================================================================================|
|    0   N/A  N/A            3528    C+G   ...5n1h2txyewy\TextInputHost.exe      N/A      |
|    0   N/A  N/A            3964    C+G   ...indows\System32\ShellHost.exe      N/A      |
|    0   N/A  N/A            5044    C+G   ...al\Programs\Notion\Notion.exe      N/A      |
|    0   N/A  N/A            6924    C+G   ...ntrolPanel\SystemSettings.exe      N/A      |
|    0   N/A  N/A            7552    C+G   ...l\slack\app-4.47.69\slack.exe      N/A      |
|    0   N/A  N/A            9464    C+G   C:\Windows\explorer.exe               N/A      |
|    0   N/A  N/A            9900    C+G   ...\Figma\app-125.11.6\Figma.exe      N/A      |
|    0   N/A  N/A           10536    C+G   ...2txyewy\CrossDeviceResume.exe      N/A      |
|    0   N/A  N/A           12164    C+G   ...y\StartMenuExperienceHost.exe      N/A      |
|    0   N/A  N/A           12172    C+G   ..._cw5n1h2txyewy\SearchHost.exe      N/A      |
|    0   N/A  N/A           14404    C+G   ...xyewy\ShellExperienceHost.exe      N/A      |
|    0   N/A  N/A           14880    C+G   ...em32\ApplicationFrameHost.exe      N/A      |
|    0   N/A  N/A           15872    C+G   ....0.3650.96\msedgewebview2.exe      N/A      |
|    0   N/A  N/A           17980    C+G   ...Chrome\Application\chrome.exe      N/A      |
|    0   N/A  N/A           20912    C+G   ...8bbwe\PhoneExperienceHost.exe      N/A      |
|    0   N/A  N/A           21392      C   ...indows-x86_64-none\python.exe      N/A      |
|    0   N/A  N/A           21876    C+G   ...x40ttqa\iCloud\iCloudHome.exe      N/A      |
|    0   N/A  N/A           23364    C+G   ... Insiders\Code - Insiders.exe      N/A      |
|    0   N/A  N/A           23384    C+G   ...Chrome\Application\chrome.exe      N/A      |
|    0   N/A  N/A           24092    C+G   ...0ttqa\iCloud\iCloudPhotos.exe      N/A      |
|    0   N/A  N/A           26908    C+G   ...l\slack\app-4.47.69\slack.exe      N/A      |
|    0   N/A  N/A           32944    C+G   ....0.3650.96\msedgewebview2.exe      N/A      |
|    0   N/A  N/A           35384    C+G   ...kyb3d8bbwe\EdgeGameAssist.exe      N/A      |
|    0   N/A  N/A           38088    C+G   ...\Programs\ComfyUI\ComfyUI.exe      N/A      |
|    0   N/A  N/A           38248    C+G   ...cord\app-1.0.9219\Discord.exe      N/A      |
|    0   N/A  N/A           42816    C+G   ...a\Roaming\Spotify\Spotify.exe      N/A      |
|    0   N/A  N/A           45164    C+G   ...t\Edge\Application\msedge.exe      N/A      |
|    0   N/A  N/A           45312    C+G   ...yb3d8bbwe\WindowsTerminal.exe      N/A      |
+-----------------------------------------------------------------------------------------+
`;

    expect(parseNvidiaDriverVersionFromSmiOutput(output)).toBe('591.59');
  });
});

describe('isNvidiaDriverBelowMinimum', () => {
  it.each([
    { version: '579.0.0', expected: true, label: 'below 580' },
    { version: '580.0.0', expected: false, label: 'at 580' },
    { version: '580.0.1', expected: false, label: 'at a version of 580' },
    { version: '581.0', expected: false, label: 'above 580' },
  ])('returns $expected when $label', ({ version, expected }) => {
    expect(isNvidiaDriverBelowMinimum(version, '580')).toBe(expected);
  });
});
