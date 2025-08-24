import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UvLogParser } from '@/uvLogParser';
import { UvInstallationState } from '@/uvInstallationState';

describe('UvInstallationState', () => {
  let state: UvInstallationState;
  let mockParser: Partial<UvLogParser>;
  let statusChangeHandler: vi.Mock;

  beforeEach(() => {
    // Create mock parser
    mockParser = {
      getDownloadProgress: vi.fn().mockReturnValue({
        totalBytes: 1000000,
        percentComplete: 0,
        bytesReceived: 0,
        estimatedBytesReceived: 0,
      }),
    };

    // Create state with test-friendly thresholds
    state = new UvInstallationState({
      downloadProgressThreshold: 10, // 10% minimum change
      bytesThreshold: 50000, // 50KB minimum change
      phaseUpdateCooldown: 50, // 50ms cooldown
    });

    state.setParser(mockParser as UvLogParser);

    // Set up status change handler
    statusChangeHandler = vi.fn();
    state.on('statusChange', statusChangeHandler);
  });

  describe('State Change Detection', () => {
    it('should emit event for first status update', () => {
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies',
        timestamp: Date.now(),
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
      expect(statusChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'resolving',
          message: 'Resolving dependencies',
        })
      );
    });

    it('should filter out unknown phases', () => {
      state.updateFromUvStatus({
        phase: 'unknown',
        message: 'Some debug output',
        timestamp: Date.now(),
      });

      expect(statusChangeHandler).not.toHaveBeenCalled();
    });

    it('should emit event for phase changes', () => {
      // First update
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies',
      });

      // Phase change
      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Dependencies resolved',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          phase: 'resolved',
          message: 'Dependencies resolved',
        })
      );
    });

    it('should emit event for package changes', () => {
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package1',
        currentPackage: 'package1',
      });

      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package2',
        currentPackage: 'package2',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          currentPackage: 'package2',
        })
      );
    });

    it('should emit event for counter changes', () => {
      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Resolved packages',
        totalPackages: 5,
        installedPackages: 0,
      });

      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Resolved packages',
        totalPackages: 5,
        installedPackages: 2,
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          installedPackages: 2,
        })
      );
    });

    it('should emit event for completion status changes', () => {
      state.updateFromUvStatus({
        phase: 'installing',
        message: 'Installing packages',
        isComplete: false,
      });

      state.updateFromUvStatus({
        phase: 'installed',
        message: 'Installation complete',
        isComplete: true,
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          phase: 'installed',
          isComplete: true,
        })
      );
    });

    it('should emit event for error changes', () => {
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
      });

      state.updateFromUvStatus({
        phase: 'error',
        message: 'Download failed',
        error: 'Network timeout',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          phase: 'error',
          error: 'Network timeout',
        })
      );
    });
  });

  describe('Deduplication Logic', () => {
    it('should not emit duplicate identical status updates', () => {
      const status = {
        phase: 'resolving',
        message: 'Resolving dependencies',
        totalPackages: 0,
        installedPackages: 0,
      } as const;

      // Send same status multiple times
      state.updateFromUvStatus(status);
      state.updateFromUvStatus(status);
      state.updateFromUvStatus(status);

      // Should only emit once
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });

    it('should respect phase update cooldown', async () => {
      const status = {
        phase: 'resolving',
        message: '',
        totalPackages: 0,
        installedPackages: 0,
      } as const;

      // First update
      state.updateFromUvStatus(status);

      // Second update immediately (within cooldown)
      state.updateFromUvStatus(status);

      // Should only emit once due to cooldown
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      // Third update (after cooldown)
      state.updateFromUvStatus(status);

      // Should still only be 1 because content is identical
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit when meaningful message changes', () => {
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies...',
      });

      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Found 50 packages',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
    });

    it('should not emit for empty message changes', () => {
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Initial message',
      });

      // Empty message should not trigger change
      state.updateFromUvStatus({
        phase: 'resolving',
        message: '',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Download Progress Handling', () => {
    beforeEach(() => {
      // Mock parser to return progressive download progress
      mockParser.getDownloadProgress = vi.fn().mockImplementation((packageName: string) => {
        if (packageName === 'test-package') {
          return {
            totalBytes: 1000000, // 1MB
            percentComplete: 25, // 25% complete
            bytesReceived: 250000,
            estimatedBytesReceived: 250000,
          };
        }
        return undefined;
      });
    });

    it('should calculate download bytes from progress', () => {
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      expect(statusChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalBytes: 1000000,
          downloadedBytes: 250000,
        })
      );
    });

    it('should emit on significant download progress changes', () => {
      // Initial download
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      // Update mock to show more progress (75%)
      mockParser.getDownloadProgress = vi.fn().mockReturnValue({
        totalBytes: 1000000,
        percentComplete: 75,
        bytesReceived: 750000,
        estimatedBytesReceived: 750000,
      });

      // Same status but with updated progress
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          downloadedBytes: 750000,
        })
      );
    });

    it('should not emit for small download progress changes', () => {
      // Initial download
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      // Small progress change (within threshold)
      mockParser.getDownloadProgress = vi.fn().mockReturnValue({
        totalBytes: 1000000,
        percentComplete: 27, // Only 2% more
        bytesReceived: 270000, // Only 20KB more (below 50KB threshold)
        estimatedBytesReceived: 270000,
      });

      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      // Should not emit second event due to small change
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Transfer Rate and ETA Changes', () => {
    it('should emit on significant transfer rate changes', () => {
      // Initial status with transfer rate
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        transferRate: 1000000, // 1MB/s
      });

      // Significant rate change (> 10%)
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        transferRate: 500000, // 0.5MB/s (50% decrease)
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
    });

    it('should emit on ETA threshold changes', () => {
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        etaSeconds: 120, // 2 minutes
      });

      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        etaSeconds: 60, // 1 minute (60s change > 5s threshold)
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('State Management', () => {
    it('should return current state', () => {
      const status = {
        phase: 'resolved',
        message: 'Resolved 10 packages',
        totalPackages: 10,
      } as const;

      state.updateFromUvStatus(status);

      const currentState = state.getCurrentState();
      expect(currentState).toMatchObject({
        phase: 'resolved',
        message: 'Resolved 10 packages',
        totalPackages: 10,
      });
    });

    it('should return null for initial state', () => {
      const currentState = state.getCurrentState();
      expect(currentState).toBeNull();
    });

    it('should reset state properly', () => {
      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Resolved packages',
      });

      state.reset();

      expect(state.getCurrentState()).toBeNull();
    });

    it('should handle event listener cleanup', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      state.on('statusChange', handler1);
      state.on('statusChange', handler2);

      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Test',
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Remove one handler
      state.off('statusChange', handler1);

      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Test 2',
      });

      expect(handler1).toHaveBeenCalledTimes(1); // Still 1
      expect(handler2).toHaveBeenCalledTimes(2); // Incremented
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined/null values gracefully', () => {
      state.updateFromUvStatus({
        phase: 'downloading',
        message: '',
        currentPackage: undefined,
        totalPackages: undefined,
        installedPackages: undefined,
      });

      expect(statusChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'downloading',
          message: '',
          currentPackage: undefined,
        })
      );
    });

    it('should handle status without parser gracefully', () => {
      const stateWithoutParser = new UvInstallationState();
      const handler = vi.fn();
      stateWithoutParser.on('statusChange', handler);

      stateWithoutParser.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        currentPackage: 'test-package',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalBytes: 0,
          downloadedBytes: 0,
        })
      );
    });
  });
});