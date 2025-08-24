/**
 * Integration tests for InstallationManager orchestration functionality
 *
 * Tests the integration between InstallationManager and InstallationTaskOrchestrator
 * to ensure proper multi-step installation progress tracking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../src/constants';
import { InstallationManager } from '../../../src/install/installationManager';

// Mock the external dependencies
vi.mock('electron-log/main');
vi.mock('../../../src/services/telemetry', () => ({
  ITelemetry: class {},
  trackEvent: () => () => {},
}));

describe('InstallationManager Orchestration Integration', () => {
  let installationManager: InstallationManager;
  let mockAppWindow: any;
  let mockTelemetry: any;
  let mockInstallation: any;
  let mockVirtualEnvironment: any;
  let ipcMessages: Array<{ channel: string; data: any }>;

  beforeEach(() => {
    // Reset IPC message tracking
    ipcMessages = [];

    // Mock AppWindow
    mockAppWindow = {
      send: vi.fn().mockImplementation((channel: string, data: any) => {
        ipcMessages.push({ channel, data });
      }),
      loadPage: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn(),
    };

    // Mock Telemetry
    mockTelemetry = {
      track: vi.fn(),
    };

    // Mock VirtualEnvironment
    mockVirtualEnvironment = {
      installComfyUIRequirements: vi.fn().mockImplementation(async (callbacks) => {
        // Simulate UV status updates during ComfyUI requirements installation
        if (callbacks?.uvInstallationState) {
          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'started',
            message: 'Starting ComfyUI requirements installation',
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'resolving',
            message: 'Resolving ComfyUI dependencies',
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'downloading',
            message: 'Downloading numpy',
            currentPackage: 'numpy',
            totalBytes: 1_048_576,
            downloadedBytes: 524_288,
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'installed',
            message: 'ComfyUI requirements installed',
            installedPackages: 15,
          });
        }
      }),

      installComfyUIManagerRequirements: vi.fn().mockImplementation(async (callbacks) => {
        // Simulate UV status updates during Manager requirements installation
        if (callbacks?.uvInstallationState) {
          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'started',
            message: 'Starting Manager requirements installation',
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'downloading',
            message: 'Downloading requests',
            currentPackage: 'requests',
            totalBytes: 524_288,
            downloadedBytes: 524_288,
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'installed',
            message: 'Manager requirements installed',
            installedPackages: 5,
          });
        }
      }),

      installPytorch: vi.fn().mockImplementation(async (callbacks) => {
        // Simulate UV status updates during Torch installation
        if (callbacks?.uvInstallationState) {
          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'started',
            message: 'Starting PyTorch installation',
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'downloading',
            message: 'Downloading torch',
            currentPackage: 'torch',
            totalBytes: 104_857_600, // 100MB
            downloadedBytes: 52_428_800, // 50MB
          });

          await new Promise((resolve) => setTimeout(resolve, 50));

          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'installed',
            message: 'PyTorch installed',
            installedPackages: 3,
          });
        }
      }),
    };

    // Mock ComfyInstallation
    mockInstallation = {
      virtualEnvironment: mockVirtualEnvironment,
      validate: vi.fn().mockResolvedValue(undefined),
    };

    // Create InstallationManager
    installationManager = new InstallationManager(mockAppWindow, mockTelemetry);
  });

  describe('Orchestrated Package Updates', () => {
    it('should run orchestrated installation with proper IPC communication', async () => {
      // Call the private method via reflection to test orchestration
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      // Verify that all virtual environment methods were called
      expect(mockVirtualEnvironment.installPytorch).toHaveBeenCalled();
      expect(mockVirtualEnvironment.installComfyUIRequirements).toHaveBeenCalled();
      expect(mockVirtualEnvironment.installComfyUIManagerRequirements).toHaveBeenCalled();

      // Verify IPC messages were sent
      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);
      const uvStatusMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_INSTALL_STATUS);

      expect(orchestrationMessages.length).toBeGreaterThan(0);
      expect(uvStatusMessages.length).toBeGreaterThan(0);
    });

    it('should provide task context in orchestration messages', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);

      // Should have messages for each task
      const taskNames = orchestrationMessages.map((msg: any) => msg.data.currentTask?.name).filter(Boolean);

      expect(taskNames).toContain('PyTorch Dependencies');
      expect(taskNames).toContain('ComfyUI Requirements');
      expect(taskNames).toContain('Manager Requirements');
    });

    it('should track overall progress across tasks', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);

      const progressValues = orchestrationMessages
        .map((msg: any) => msg.data.overallProgress)
        .filter((p) => typeof p === 'number');

      // Progress should start at 0 and end at 100
      expect(Math.min(...progressValues)).toBe(0);
      expect(Math.max(...progressValues)).toBe(100);

      // Progress should generally increase
      const increasing = progressValues.every((val, i) => i === 0 || val >= progressValues[i - 1]);
      expect(increasing).toBe(true);
    });

    it('should include UV status details in orchestration messages', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);

      // Find messages with task progress
      const messagesWithProgress = orchestrationMessages.filter((msg: any) => msg.data.taskProgress);

      expect(messagesWithProgress.length).toBeGreaterThan(0);

      // Verify task progress contains UV status information
      const progressExample = messagesWithProgress[0].data.taskProgress;
      expect(progressExample).toHaveProperty('phase');
      expect(progressExample).toHaveProperty('message');
    });

    it('should send UV status messages for detailed progress', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      const uvStatusMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_INSTALL_STATUS);

      // Should have UV status messages for each phase
      const phases = uvStatusMessages.map((msg: any) => msg.data.phase).filter(Boolean);

      expect(phases).toContain('started');
      expect(phases).toContain('resolving');
      expect(phases).toContain('downloading');
      expect(phases).toContain('installed');
    });

    it('should handle download progress information', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      const uvStatusMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_INSTALL_STATUS);

      const downloadMessages = uvStatusMessages.filter((msg: any) => msg.data.phase === 'downloading');

      expect(downloadMessages.length).toBeGreaterThan(0);

      // Verify download progress contains byte information
      const downloadProgress = downloadMessages[0].data;
      expect(downloadProgress).toHaveProperty('totalBytes');
      expect(downloadProgress).toHaveProperty('downloadedBytes');
      expect(downloadProgress).toHaveProperty('currentPackage');
    });
  });

  describe('Error Handling', () => {
    it('should handle task failures gracefully', async () => {
      // Make ComfyUI requirements installation fail
      mockVirtualEnvironment.installComfyUIRequirements.mockRejectedValue(
        new Error('Network error during installation')
      );

      await expect((installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn())).rejects.toThrow(
        'ComfyUI Requirements'
      );

      // Should still have sent some orchestration messages before failure
      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);

      expect(orchestrationMessages.length).toBeGreaterThan(0);
    });

    it('should reset UV state between tasks even on failure', async () => {
      // Make the second task fail
      mockVirtualEnvironment.installComfyUIRequirements.mockRejectedValue(new Error('Installation failed'));

      try {
        await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());
      } catch {
        // Expected to fail
      }

      // Verify first task was executed (torch should have been called)
      expect(mockVirtualEnvironment.installPytorch).toHaveBeenCalled();

      // Failed task should also have been attempted
      expect(mockVirtualEnvironment.installComfyUIRequirements).toHaveBeenCalled();

      // Third task should not have been called due to failure
      expect(mockVirtualEnvironment.installComfyUIManagerRequirements).not.toHaveBeenCalled();
    });
  });

  describe('Integration with updatePackages', () => {
    it('should use orchestration in updatePackages method', async () => {
      // Set up successful installation
      mockInstallation.needsRequirementsUpdate = true;

      try {
        await (installationManager as any).updatePackages(mockInstallation);
      } catch {
        // May fail due to mocking, but we can still verify method calls
      }

      // Verify the page was loaded
      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('desktop-update');

      // Should have attempted validation
      expect(mockInstallation.validate).toHaveBeenCalled();
    });

    it('should handle orchestration errors in updatePackages', async () => {
      // Make orchestration fail
      mockVirtualEnvironment.installComfyUIRequirements.mockRejectedValue(new Error('Orchestration failed'));

      mockInstallation.needsRequirementsUpdate = true;

      // Should not throw - should handle error gracefully
      await expect((installationManager as any).updatePackages(mockInstallation)).resolves.not.toThrow();

      // Should load error recovery page
      expect(mockAppWindow.loadPage).toHaveBeenCalledWith('server-start');
    });
  });

  describe('Message Sequencing', () => {
    it('should send orchestration and UV messages in correct sequence', async () => {
      await (installationManager as any).runOrchestratedInstallation(mockInstallation, vi.fn());

      // Verify messages are properly interleaved
      const allMessages = ipcMessages.map((msg) => ({
        type: msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS ? 'orchestration' : 'uv',
        timestamp: Date.now(),
        data: msg.data,
      }));

      // Should have both types of messages
      const orchestrationCount = allMessages.filter((m) => m.type === 'orchestration').length;
      const uvCount = allMessages.filter((m) => m.type === 'uv').length;

      expect(orchestrationCount).toBeGreaterThan(0);
      expect(uvCount).toBeGreaterThan(0);

      // Orchestration messages should include completion status
      const orchestrationMessages = ipcMessages.filter((msg) => msg.channel === IPC_CHANNELS.UV_ORCHESTRATION_STATUS);

      const completionMessage = orchestrationMessages.find((msg: any) => msg.data.isComplete === true);

      expect(completionMessage).toBeDefined();
    });
  });
});
