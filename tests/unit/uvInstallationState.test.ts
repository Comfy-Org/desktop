import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { UvInstallationState } from '@/uvInstallationState';
import type { UvLogParser } from '@/uvLogParser';

describe('UvInstallationState', () => {
  let state: UvInstallationState;
  let mockParser: Partial<UvLogParser>;
  let statusChangeHandler: Mock;

  beforeEach(() => {
    // Create mock parser
    mockParser = {
      getDownloadProgress: vi.fn().mockReturnValue({
        totalBytes: 1_000_000,
        percentComplete: 0,
        bytesReceived: 0,
        estimatedBytesReceived: 0,
      }),
    };

    // Create state with test-friendly thresholds
    state = new UvInstallationState({
      downloadProgressThreshold: 10, // 10% minimum change
      bytesThreshold: 50_000, // 50KB minimum change
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
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
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
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
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
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
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
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
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
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
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
      await new Promise((resolve) => setTimeout(resolve, 60));

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
            totalBytes: 1_000_000, // 1MB
            percentComplete: 25, // 25% complete
            bytesReceived: 250_000,
            estimatedBytesReceived: 250_000,
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
          totalBytes: 1_000_000,
          downloadedBytes: 250_000,
        })
      );
    });

    it('should use byte values directly from status when available', () => {
      // Test the fix for commit 8185b56ec regression
      // Status now provides totalBytes and downloadedBytes directly
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading numpy',
        currentPackage: 'numpy',
        totalBytes: 16_277_507,
        downloadedBytes: 8_138_753,
      });

      expect(statusChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'downloading',
          currentPackage: 'numpy',
          totalBytes: 16_277_507,
          downloadedBytes: 8_138_753,
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
        totalBytes: 1_000_000,
        percentComplete: 75,
        bytesReceived: 750_000,
        estimatedBytesReceived: 750_000,
      });

      // Same status but with updated progress
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          downloadedBytes: 750_000,
        })
      );
    });

    it('should emit all progress updates for progress-only changes after rate limiting', () => {
      vi.useFakeTimers();

      // Initial download with direct byte values
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
        totalBytes: 1_000_000,
        downloadedBytes: 250_000,
      });

      statusChangeHandler.mockClear();

      // Small progress-only change (no rate limit applied yet)
      vi.advanceTimersByTime(30); // Ensure enough time has passed
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package', // Same message
        currentPackage: 'test-package',
        totalBytes: 1_000_000,
        downloadedBytes: 251_000, // Only 1KB more - but should emit for progress-only
      });

      // Should emit because it's progress-only and rate limit passed
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Too soon for another update
      vi.advanceTimersByTime(10); // Only 10ms later
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading test-package',
        currentPackage: 'test-package',
        totalBytes: 1_000_000,
        downloadedBytes: 252_000,
      });

      // Should still be 1 due to rate limiting
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should emit progress updates when using direct byte values', () => {
      // Test for regression fix - ensure progress updates work with direct byte values
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading torch',
        currentPackage: 'torch',
        totalBytes: 100_000_000,
        downloadedBytes: 10_000_000,
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Significant progress update (more than bytesThreshold of 50KB)
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading torch',
        currentPackage: 'torch',
        totalBytes: 100_000_000,
        downloadedBytes: 20_000_000, // 10MB more
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          downloadedBytes: 20_000_000,
        })
      );
    });

    it('should rate limit download-progress-only updates to 40 per second', () => {
      vi.useFakeTimers();

      // Initial download state
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading torch',
        currentPackage: 'torch',
        totalBytes: 100_000_000,
        downloadedBytes: 0,
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
      statusChangeHandler.mockClear();

      // Rapid progress updates (simulating thousands of IPC events)
      for (let i = 1; i <= 100; i++) {
        state.updateFromUvStatus({
          phase: 'downloading',
          message: 'Downloading torch',
          currentPackage: 'torch',
          totalBytes: 100_000_000,
          downloadedBytes: i * 1_000_000, // 1MB increments
        });

        // Advance time by 10ms (100 updates/sec without rate limiting)
        vi.advanceTimersByTime(10);
      }

      // With rate limiting at 40/sec (25ms minimum), over 1 second we should get ~40 updates
      // Since we advance 10ms per iteration for 100 iterations = 1000ms total
      // Every 25ms we can emit, so we should get approximately 1000/25 = 40 updates
      // But the first update is immediate, then we need to wait 25ms for the next
      const callCount = statusChangeHandler.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(30); // Allow variance for timing logic
      expect(callCount).toBeLessThanOrEqual(45); // But should be around 40

      vi.useRealTimers();
    });

    it('should not rate limit when non-progress fields change', () => {
      vi.useFakeTimers();

      // Initial download state
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading torch',
        currentPackage: 'torch',
        totalBytes: 100_000_000,
        downloadedBytes: 10_000_000,
      });

      statusChangeHandler.mockClear();

      // Quick succession of updates with different packages (not progress-only)
      vi.advanceTimersByTime(5); // Only 5ms later
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading numpy',
        currentPackage: 'numpy', // Different package
        totalBytes: 50_000_000,
        downloadedBytes: 5_000_000,
      });

      vi.advanceTimersByTime(5); // Another 5ms
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading pandas',
        currentPackage: 'pandas', // Different package again
        totalBytes: 30_000_000,
        downloadedBytes: 3_000_000,
      });

      // Should emit both updates despite being within 25ms window
      // because package changes are not rate limited
      expect(statusChangeHandler).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('Transfer Rate and ETA Changes', () => {
    it('should emit on significant transfer rate changes', () => {
      // Initial status with transfer rate
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        transferRate: 1_000_000, // 1MB/s
      });

      // Significant rate change (> 10%)
      state.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
        transferRate: 500_000, // 0.5MB/s (50% decrease)
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

  describe('Resolution Phase Spam Prevention', () => {
    it('should prevent spam during resolution phase with package changes', () => {
      // Initial resolution phase
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies',
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Rapid package changes during resolution (simulating the spam issue)
      const packages = ['numpy', 'pandas', 'scipy', 'matplotlib', 'scikit-learn'];
      for (const pkg of packages) {
        state.updateFromUvStatus({
          phase: 'resolving',
          message: `Resolving dependency: ${pkg}`,
          currentPackage: pkg,
        });
      }

      // Should NOT emit for package changes during resolution
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });

    it('should allow total package count updates during resolution', () => {
      // Initial resolution
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies',
        totalPackages: 0,
      });

      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Total package count discovered (resolution complete)
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolution complete',
        totalPackages: 50,
      });

      // Should emit for total package count change
      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
      expect(statusChangeHandler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          totalPackages: 50,
        })
      );
    });

    it('should apply aggressive cooldown for resolution phase', async () => {
      // Initial resolution
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Starting resolution',
      });

      // Rapid updates within 1 second cooldown
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state.updateFromUvStatus({
          phase: 'resolving',
          message: `Resolving package ${i}`,
        });
      }

      // Should only have initial emit due to cooldown
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update after cooldown with meaningful change
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Found incompatibility',
      });

      // Should emit after cooldown
      expect(statusChangeHandler).toHaveBeenCalledTimes(2);
    });

    it('should ignore repetitive resolving messages', () => {
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Starting resolution',
      });

      // Repetitive resolving messages
      const repetitiveMessages = [
        'Resolving dependency: torch',
        'Resolving dependency: torchvision',
        'Resolving dependency: torchaudio',
        'Resolving',
        'Resolving dependencies',
      ];

      for (const msg of repetitiveMessages) {
        state.updateFromUvStatus({
          phase: 'resolving',
          message: msg,
        });
      }

      // Should only have initial emit
      expect(statusChangeHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world Scenario', () => {
    it('should handle complete installation flow with minimal IPC', () => {
      const emittedStatuses: any[] = [];
      statusChangeHandler.mockImplementation((status) => {
        emittedStatuses.push(status);
      });

      // 1. Start resolution
      state.updateFromUvStatus({
        phase: 'resolving',
        message: 'Resolving dependencies',
      });

      // 2. Many resolution updates (should be filtered)
      for (let i = 0; i < 50; i++) {
        state.updateFromUvStatus({
          phase: 'resolving',
          message: `Resolving dependency: package-${i}`,
          currentPackage: `package-${i}`,
        });
      }

      // 3. Resolution complete with total packages
      state.updateFromUvStatus({
        phase: 'resolved',
        message: 'Resolution complete',
        totalPackages: 50,
        installedPackages: 0,
      });

      // 4. Download packages (meaningful updates)
      for (let i = 0; i < 5; i++) {
        // Mock significant progress for each package
        mockParser.getDownloadProgress = vi.fn().mockReturnValue({
          totalBytes: 1_000_000,
          percentComplete: (i + 1) * 20, // 20%, 40%, 60%, 80%, 100%
          bytesReceived: (i + 1) * 200_000,
          estimatedBytesReceived: (i + 1) * 200_000,
        });

        state.updateFromUvStatus({
          phase: 'downloading',
          message: `Downloading package-${i}`,
          currentPackage: `package-${i}`,
          totalPackages: 50,
          installedPackages: i,
          transferRate: 1_000_000,
          etaSeconds: 120 - i * 20,
        });
      }

      // 5. Installation complete
      state.updateFromUvStatus({
        phase: 'installed',
        message: 'All packages installed successfully',
        totalPackages: 50,
        installedPackages: 50,
        isComplete: true,
      });

      // Verify minimal IPC messages were sent
      // Should have: 1 resolving + 1 resolved + 5 downloads + 1 installed = 8 total
      expect(emittedStatuses).toHaveLength(8);

      // Verify the flow
      expect(emittedStatuses[0].phase).toBe('resolving');
      expect(emittedStatuses[1].phase).toBe('resolved');
      expect(emittedStatuses[2].phase).toBe('downloading');
      expect(emittedStatuses.at(-1).phase).toBe('installed');
      expect(emittedStatuses.at(-1).isComplete).toBe(true);
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
