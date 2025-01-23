import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../src/constants';
import { InstallationManager } from '../../../src/install/installationManager';
import type { AppWindow } from '../../../src/main-process/appWindow';
import { ComfyInstallation } from '../../../src/main-process/comfyInstallation';
import type { InstallValidation } from '../../../src/preload';
import type { ITelemetry } from '../../../src/services/telemetry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    handleOnce: vi.fn(),
    removeHandler: vi.fn(),
    once: vi.fn(),
  },
  app: {
    getPath: vi.fn(),
    quit: vi.fn(),
    relaunch: vi.fn(),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));
vi.mock('../../../src/main-process/comfyInstallation');
vi.mock('../../../src/store/desktopConfig');
vi.mock('electron-log/main');

type ValidationStep = {
  inProgress: boolean;
  installState: string;
  basePath?: 'OK' | 'error';
  venvDirectory?: 'OK' | 'error';
  pythonInterpreter?: 'OK' | 'error';
};

const commonValidationSteps: ValidationStep[] = [
  {
    inProgress: true,
    installState: 'installed',
    basePath: 'error',
  },
  {
    inProgress: true,
    installState: 'installed',
    basePath: 'OK',
    venvDirectory: 'error',
  },
  {
    inProgress: true,
    installState: 'installed',
    basePath: 'OK',
    venvDirectory: 'OK',
    pythonInterpreter: 'error',
  },
];

const createMockAppWindow = () => {
  const mock = {
    send: vi.fn(),
    loadRenderer: vi.fn().mockResolvedValue(null),
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

const createMockInstallation = (params: {
  state?: string;
  hasIssues?: boolean;
  isValid?: boolean;
  validationSteps?: ValidationStep[];
}) => {
  const { state = 'installed', hasIssues = false, isValid = true, validationSteps = [] } = params;

  const mockInstallation = {
    state,
    validation: {} as InstallValidation,
    hasIssues,
    isValid,
    validate: vi.fn().mockImplementation(() => {
      // Simulate validation steps
      if (mockInstallation?.onUpdate) {
        for (const step of validationSteps) {
          mockInstallation.onUpdate(step as InstallValidation);
        }
      }
      return state;
    }),
    onUpdate: undefined as ((data: InstallValidation) => void) | undefined,
  };

  return mockInstallation as unknown as ComfyInstallation;
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

    // Capture validation updates
    vi.spyOn(mockAppWindow, 'send').mockImplementation((channel: string, data: unknown) => {
      if (channel === IPC_CHANNELS.VALIDATION_UPDATE) {
        validationUpdates.push({ ...(data as InstallValidation) });
      }
    });
  });

  describe('ensureInstalled', () => {
    const validInstallation = {
      state: 'installed',
      hasIssues: false,
      isValid: true,
    } as const;

    it('returns existing valid installation', () => {
      const mockInstallation = createMockInstallation(validInstallation);
      vi.spyOn(mockInstallation, 'validate').mockResolvedValue('installed');
      vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(() => mockInstallation);

      const result = manager.ensureInstalled();

      expect(result).toBe(mockInstallation);
    });

    it.each([
      {
        scenario: 'validation errors trigger maintenance page',
        installation: {
          ...validInstallation,
          hasIssues: true,
          isValid: false,
          validationSteps: commonValidationSteps,
        },
        expectMaintenancePage: true,
      },
      {
        scenario: 'no errors skip maintenance page',
        installation: {
          ...validInstallation,
          validationSteps: [
            {
              inProgress: true,
              installState: 'installed',
              basePath: 'OK',
              venvDirectory: 'OK',
              pythonInterpreter: 'OK',
            } satisfies ValidationStep,
          ],
        },
        expectMaintenancePage: false,
      },
    ])('$scenario', async ({ installation, expectMaintenancePage }) => {
      const mockInstallation = createMockInstallation(installation);
      vi.spyOn(ComfyInstallation, 'fromConfig').mockImplementation(() => mockInstallation);
      vi.spyOn(
        manager as unknown as { resolveIssues: (installation: ComfyInstallation) => Promise<boolean> },
        'resolveIssues'
      ).mockResolvedValueOnce(true);

      await manager.ensureInstalled();

      // Verify validation sequence
      expect(validationUpdates).toHaveLength(installation.validationSteps?.length ?? 0);
      if (installation.validationSteps) {
        for (const [index, expectedStep] of installation.validationSteps.entries()) {
          const actualStep = validationUpdates[index];
          for (const [key, value] of Object.entries(expectedStep)) {
            expect(actualStep[key as keyof InstallValidation]).toBe(value);
          }
        }
      }

      // Verify maintenance page behavior
      if (expectMaintenancePage) {
        expect(manager['resolveIssues']).toHaveBeenCalledWith(mockInstallation);
        expect(mockAppWindow.loadRenderer).toHaveBeenCalledWith('maintenance');
      } else {
        expect(manager['resolveIssues']).not.toHaveBeenCalled();
        expect(mockAppWindow.loadRenderer).not.toHaveBeenCalled();
      }
    });
  });
});
