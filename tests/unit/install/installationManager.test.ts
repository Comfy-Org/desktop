import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../src/constants';
import { InstallationManager } from '../../../src/install/installationManager';
import { AppWindow } from '../../../src/main-process/appWindow';
import { ComfyInstallation } from '../../../src/main-process/comfyInstallation';
import type { InstallValidation } from '../../../src/preload';
import { ITelemetry } from '../../../src/services/telemetry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    handleOnce: vi.fn(),
  },
  app: {
    getPath: vi.fn(),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

vi.mock('../../../src/main-process/comfyInstallation');
vi.mock('../../../src/store/desktopConfig');
vi.mock('electron-log/main');

describe('InstallationManager', () => {
  let manager: InstallationManager;
  let mockAppWindow: AppWindow;
  let mockTelemetry: ITelemetry;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAppWindow = {
      send: vi.fn(),
      loadRenderer: vi.fn().mockResolvedValue(null),
      showOpenDialog: vi.fn(),
      maximize: vi.fn(),
    } as unknown as AppWindow;

    mockTelemetry = {
      track: vi.fn(),
    } as unknown as ITelemetry;

    manager = new InstallationManager(mockAppWindow, mockTelemetry);
  });

  describe('ensureInstalled', () => {
    it('should return existing valid installation if one exists', async () => {
      const mockInstallation = {
        state: 'installed',
        validate: vi.fn().mockResolvedValue('installed'),
        hasIssues: false,
      };

      vi.spyOn(ComfyInstallation, 'fromConfig').mockReturnValue(mockInstallation as unknown as ComfyInstallation);

      const result = await manager.ensureInstalled();

      expect(ComfyInstallation.fromConfig).toHaveBeenCalled();
      expect(mockInstallation.validate).toHaveBeenCalled();
      expect(result).toBe(mockInstallation);
    });

    it('should properly handle validation steps and send updates to renderer', async () => {
      const validationUpdates: InstallValidation[] = [];
      const mockInstallation = {
        state: 'installed',
        validation: {} as InstallValidation,
        hasIssues: true,
        isValid: false,
        validate: vi.fn().mockImplementation(() => {
          // Simulate validation steps
          if (mockInstallation.onUpdate) {
            mockInstallation.onUpdate({
              inProgress: true,
              installState: 'installed',
              basePath: 'error',
            });

            mockInstallation.onUpdate({
              inProgress: true,
              installState: 'installed',
              basePath: 'OK',
              venvDirectory: 'error',
            });

            mockInstallation.onUpdate({
              inProgress: true,
              installState: 'installed',
              basePath: 'OK',
              venvDirectory: 'OK',
              pythonInterpreter: 'error',
            });
          }
          return 'installed';
        }),
        onUpdate: undefined as ((data: InstallValidation) => void) | undefined,
      };

      vi.spyOn(ComfyInstallation, 'fromConfig').mockReturnValue(mockInstallation as unknown as ComfyInstallation);

      // Mock resolveIssues to succeed after first attempt
      vi.spyOn(manager as unknown as { resolveIssues: () => Promise<boolean> }, 'resolveIssues').mockResolvedValueOnce(
        true
      );

      // Spy on send to capture validation updates
      vi.spyOn(mockAppWindow, 'send').mockImplementation((channel: string, data: unknown) => {
        if (channel === IPC_CHANNELS.VALIDATION_UPDATE) {
          validationUpdates.push({ ...(data as InstallValidation) });
        }
      });

      await manager.ensureInstalled();

      // Verify validation steps were performed in sequence
      expect(validationUpdates).toHaveLength(3);
      expect(validationUpdates[0].basePath).toBe('error');
      expect(validationUpdates[1].venvDirectory).toBe('error');
      expect(validationUpdates[2].pythonInterpreter).toBe('error');

      // Verify each update built upon the previous one
      expect(validationUpdates[1].basePath).toBe('OK');
      expect(validationUpdates[2].venvDirectory).toBe('OK');

      // Verify resolveIssues was called since there were issues
      expect(manager['resolveIssues']).toHaveBeenCalledWith(mockInstallation);

      // Verify maintenance page was loaded due to errors
      expect(mockAppWindow.loadRenderer).toHaveBeenCalledWith('maintenance');
    });
  });
});
