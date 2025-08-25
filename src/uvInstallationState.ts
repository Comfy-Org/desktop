import { EventEmitter } from 'node:events';

import type { UvInstallStatus } from './preload';
import type { UvLogParser, UvStatus } from './uvLogParser';

/**
 * Configuration options for UvInstallationState
 */
export interface UvInstallationStateOptions {
  /** Minimum download progress change (%) to trigger state update */
  downloadProgressThreshold?: number;
  /** Minimum download bytes change to trigger state update */
  bytesThreshold?: number;
  /** Minimum time between identical phase updates (ms) */
  phaseUpdateCooldown?: number;
}

/**
 * Intelligent state manager for UV installation progress.
 *
 * This class receives UV log parser updates and maintains internal state,
 * only emitting 'statusChange' events when meaningful changes occur.
 * This prevents IPC spam while ensuring all important updates reach the frontend.
 */
export class UvInstallationState extends EventEmitter {
  private currentState: UvInstallStatus | null = null;
  private uvLogParser: UvLogParser | null = null;
  private lastPhaseUpdateTime = 0;
  private lastDownloadProgressTime = 0;
  private readonly options: Required<UvInstallationStateOptions>;

  constructor(options: UvInstallationStateOptions = {}) {
    super();

    this.options = {
      downloadProgressThreshold: 5, // 5% minimum change
      bytesThreshold: 100 * 1024, // 100KB minimum change
      phaseUpdateCooldown: 100, // 100ms cooldown for identical phases
      ...options,
    };
  }

  /**
   * Associates a UV log parser with this state manager.
   * Used for accessing download progress information.
   */
  setParser(parser: UvLogParser): void {
    this.uvLogParser = parser;
  }

  /**
   * Updates state based on UV log parser output.
   * Only emits statusChange events when meaningful changes are detected.
   */
  updateFromUvStatus(status: UvStatus): void {
    // Skip unknown phases
    if (status.phase === 'unknown') {
      return;
    }

    const newState = this.convertUvStatusToInstallStatus(status);

    if (this.hasStateChanged(newState)) {
      this.currentState = { ...newState };
      this.emit('statusChange', this.currentState);
    }
  }

  /**
   * Gets the current installation state.
   */
  getCurrentState(): UvInstallStatus | null {
    return this.currentState ? { ...this.currentState } : null;
  }

  /**
   * Resets the state manager to initial state.
   */
  reset(): void {
    this.currentState = null;
    this.uvLogParser = null;
    this.lastPhaseUpdateTime = 0;
    this.lastDownloadProgressTime = 0;
  }

  /**
   * Converts UvStatus to UvInstallStatus with proper field mapping.
   */
  private convertUvStatusToInstallStatus(status: UvStatus): UvInstallStatus {
    const { totalBytes, downloadedBytes } = this.calculateDownloadBytes(status);

    return {
      phase: status.phase,
      message: status.message || '',
      totalPackages: status.totalPackages,
      installedPackages: status.installedPackages,
      completedDownloads: status.completedDownloads,
      currentPackage: status.currentPackage,
      totalBytes,
      downloadedBytes,
      transferRate: status.transferRate,
      etaSeconds: status.etaSeconds,
      error: status.error,
      isComplete: status.isComplete || status.phase === 'installed' || (status.phase === 'error' && !!status.error),
    };
  }

  /**
   * Calculates download bytes from UV status and parser state.
   * Tracks individual package progress, not aggregated totals.
   */
  private calculateDownloadBytes(status: UvStatus): { totalBytes: number; downloadedBytes: number } {
    // Track individual package progress, not aggregated totals
    // Aggregation causes progress corruption when packages have different sizes

    // If status has explicit byte values, prefer those (for testing and direct updates)
    if (status.totalBytes && status.downloadedBytes !== undefined) {
      return {
        totalBytes: status.totalBytes,
        downloadedBytes: status.downloadedBytes,
      };
    }

    // Otherwise try to get progress from the parser for the current package
    if (status.currentPackage && this.uvLogParser) {
      const progress = this.uvLogParser.getDownloadProgress(status.currentPackage);
      if (progress && progress.totalBytes > 0) {
        // Use actual bytes if available, otherwise use estimated bytes
        const downloadedBytes = progress.bytesReceived || progress.estimatedBytesReceived || 0;
        return {
          totalBytes: progress.totalBytes,
          downloadedBytes,
        };
      }
    }

    // Final fallback
    return {
      totalBytes: status.totalBytes || 0,
      downloadedBytes: status.downloadedBytes || 0,
    };
  }

  /**
   * Checks if this update is only a download progress change (bytes only).
   * Used to apply stricter rate limiting to prevent IPC spam.
   */
  private isDownloadProgressOnlyUpdate(prev: UvInstallStatus, newState: UvInstallStatus): boolean {
    // Must be in downloading phase
    if (newState.phase !== 'downloading' || prev.phase !== 'downloading') {
      return false;
    }

    // Check that only download-related fields changed
    return (
      prev.phase === newState.phase &&
      prev.message === newState.message &&
      prev.currentPackage === newState.currentPackage &&
      prev.totalPackages === newState.totalPackages &&
      prev.installedPackages === newState.installedPackages &&
      prev.totalBytes === newState.totalBytes &&
      prev.isComplete === newState.isComplete &&
      prev.error === newState.error &&
      // Allow downloadedBytes, transferRate, and etaSeconds to differ
      (prev.downloadedBytes !== newState.downloadedBytes ||
        prev.transferRate !== newState.transferRate ||
        prev.etaSeconds !== newState.etaSeconds)
    );
  }

  /**
   * Intelligently determines if the new state represents a meaningful change.
   */
  private hasStateChanged(newState: UvInstallStatus): boolean {
    if (!this.currentState) {
      return true; // First state is always significant
    }

    const prev = this.currentState;
    const now = Date.now();

    // Phase changes are always significant
    if (prev.phase !== newState.phase) {
      this.lastPhaseUpdateTime = now;
      return true;
    }

    // Special handling for resolving phase to reduce spam
    if (newState.phase === 'resolving') {
      // During resolution, only care about:
      // 1. First entry into resolving phase (handled above)
      // 2. Total package count changes (when resolution completes)
      if (prev.totalPackages !== newState.totalPackages && (newState.totalPackages ?? 0) > 0) {
        return true;
      }

      // 3. Apply aggressive cooldown for resolving phase updates
      if (now - this.lastPhaseUpdateTime < 1000) {
        // 1 second cooldown for resolving
        return false;
      }

      // 4. Don't treat package changes as significant during resolution
      // 5. Don't treat empty message changes as significant
      if (!newState.message || newState.message.startsWith('Resolving')) {
        return false;
      }

      // Allow update if cooldown has passed for general status
      this.lastPhaseUpdateTime = now;
      return true;
    }

    // Package changes are significant (except during resolving, handled above)
    if (prev.currentPackage !== newState.currentPackage) {
      return true;
    }

    // Counter changes (total/installed packages) are always significant
    if (prev.totalPackages !== newState.totalPackages || prev.installedPackages !== newState.installedPackages) {
      return true;
    }

    // Completion status changes are always significant
    if (prev.isComplete !== newState.isComplete) {
      return true;
    }

    // Error changes are always significant
    if (prev.error !== newState.error) {
      return true;
    }

    // Message changes are significant if non-empty and different
    if (newState.message && prev.message !== newState.message) {
      // Skip repetitive resolving messages
      if (newState.message.startsWith('Resolving dependency:')) {
        return false;
      }
      return true;
    }

    // Check if this is a download-progress-only update
    const isDownloadProgressOnly = this.isDownloadProgressOnlyUpdate(prev, newState);

    // Download progress changes (with rate limiting for progress-only updates)
    const prevBytes = prev.downloadedBytes || 0;
    const newBytes = newState.downloadedBytes || 0;
    const byteDifference = Math.abs(newBytes - prevBytes);

    if (byteDifference > 0) {
      // If this is a progress-only update, apply intelligent rate limiting
      if (isDownloadProgressOnly) {
        const timeSinceLastProgress = now - this.lastDownloadProgressTime;

        // For large downloads (>10MB), ensure regular updates to prevent UI stalling
        const totalBytes = newState.totalBytes || 0;
        const isLargeDownload = totalBytes > 10 * 1024 * 1024; // 10MB

        // Adaptive rate limiting based on download size
        // Large downloads need more frequent updates to show progress
        const minInterval = isLargeDownload
          ? 200 // Large downloads: allow updates every 200ms (5/sec)
          : 250; // Small downloads: max 4 updates per second

        // Force update if it's been too long (prevent silent periods)
        const forceUpdateInterval = isLargeDownload ? 1000 : 2000; // 1s for large, 2s for small

        // Send update if enough time has passed
        if (timeSinceLastProgress >= minInterval) {
          this.lastDownloadProgressTime = now;
          return true;
        }

        // Force update if it's been too long (prevent silent periods)
        if (timeSinceLastProgress >= forceUpdateInterval) {
          this.lastDownloadProgressTime = now;
          return true;
        }

        return false; // Still within rate limit
      }

      // For non-progress-only updates with byte changes, use normal threshold
      if (byteDifference >= this.options.bytesThreshold) {
        return true;
      }
    }

    // Transfer rate changes (significant if > 10% change or crosses zero threshold)
    const prevRate = prev.transferRate || 0;
    const newRate = newState.transferRate || 0;
    if (prevRate === 0 && newRate > 0) return true; // Started transferring
    if (prevRate > 0 && newRate === 0) return true; // Stopped transferring
    if (prevRate > 0 && Math.abs(newRate - prevRate) / prevRate > 0.1) return true; // 10% change

    // ETA changes (significant if > 5 second change)
    const prevEta = prev.etaSeconds || 0;
    const newEta = newState.etaSeconds || 0;
    if (Math.abs(newEta - prevEta) > 5) {
      return true;
    }

    // Prevent phase spam with cooldown for identical phases
    if (prev.phase === newState.phase && now - this.lastPhaseUpdateTime < this.options.phaseUpdateCooldown) {
      return false;
    }

    // No significant change detected
    return false;
  }

  /**
   * Type-safe event emission for statusChange events.
   */
  emit(event: 'statusChange', status: UvInstallStatus): boolean {
    return super.emit(event, status);
  }

  /**
   * Type-safe event listener for statusChange events.
   */
  on(event: 'statusChange', listener: (status: UvInstallStatus) => void): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe event listener removal for statusChange events.
   */
  off(event: 'statusChange', listener: (status: UvInstallStatus) => void): this {
    return super.off(event, listener);
  }
}
