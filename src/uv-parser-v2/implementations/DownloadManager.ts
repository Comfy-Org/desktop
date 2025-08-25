/**
 * Minimal concrete implementation of IDownloadManager for tracking package downloads.
 *
 * This implementation provides core download tracking functionality with:
 * - Download state management (pending -> downloading -> completed/failed)
 * - Progress tracking (both actual and estimated bytes)
 * - HTTP/2 stream association
 * - Memory-efficient cleanup of old downloads
 * - Persistent completed count tracking
 */

// ============================================================================
// Interfaces (as specified by user requirements)
// ============================================================================

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface IDownload {
  packageName: string;
  totalBytes: number;
  bytesReceived: number;
  estimatedBytes: number;
  startTime: number;
  lastUpdateTime: number;
  status: DownloadStatus;
  streamIds: Set<string>;
}

export interface IDownloadManager {
  startDownload(packageName: string, totalBytes: number, url: string): void;
  updateProgress(packageName: string, bytesReceived: number): void;
  updateEstimatedProgress(packageName: string, estimatedBytes: number): void;
  completeDownload(packageName: string): void;
  failDownload(packageName: string, error: string): void;
  getDownload(packageName: string): IDownload | undefined;
  getActiveDownloads(): IDownload[];
  getCompletedCount(): number;
  associateStream(packageName: string, streamId: string): void;
  cleanupOldDownloads(maxAge: number): void;
  reset(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Concrete implementation of IDownloadManager.
 *
 * Tracks package downloads in memory with efficient state management.
 * Supports both actual progress updates and estimated progress for
 * downloads where total size is unknown initially.
 */
export class DownloadManager implements IDownloadManager {
  private readonly downloads: Map<string, IDownload> = new Map();
  private completedCount: number = 0;

  /**
   * Begin tracking a new download operation.
   *
   * @param packageName - Package being downloaded
   * @param totalBytes - Total size in bytes (may be 0 if unknown)
   * @param url - Download URL (stored implicitly via package tracking)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  startDownload(packageName: string, totalBytes: number, url: string): void {
    const now = Date.now();
    const download: IDownload = {
      packageName,
      totalBytes,
      bytesReceived: 0,
      estimatedBytes: 0,
      startTime: now,
      lastUpdateTime: now,
      status: 'pending',
      streamIds: new Set<string>(),
    };
    this.downloads.set(packageName, download);
  }

  /**
   * Update actual bytes received for a download.
   * Transitions status from 'pending' to 'downloading' on first progress update.
   *
   * @param packageName - Package name
   * @param bytesReceived - New bytes received count
   */
  updateProgress(packageName: string, bytesReceived: number): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.bytesReceived = bytesReceived;
      download.lastUpdateTime = Date.now();

      // Transition to downloading state on first progress update
      if (download.status === 'pending') {
        download.status = 'downloading';
      }
    }
  }

  /**
   * Update estimated progress for downloads where total size is initially unknown.
   * Used when we can estimate progress based on HTTP/2 frame information.
   *
   * @param packageName - Package name
   * @param estimatedBytes - Estimated bytes received
   */
  updateEstimatedProgress(packageName: string, estimatedBytes: number): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.estimatedBytes = estimatedBytes;
      download.lastUpdateTime = Date.now();

      // Transition to downloading state on first progress update
      if (download.status === 'pending') {
        download.status = 'downloading';
      }
    }
  }

  /**
   * Mark a download as completed.
   * Increments the persistent completed count.
   *
   * @param packageName - Package name
   */
  completeDownload(packageName: string): void {
    const download = this.downloads.get(packageName);
    if (download && download.status !== 'completed') {
      download.status = 'completed';
      download.lastUpdateTime = Date.now();
      this.completedCount++;
    }
  }

  /**
   * Mark a download as failed.
   *
   * @param packageName - Package name
   * @param error - Error message (logged but not stored in current interface)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  failDownload(packageName: string, error: string): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.status = 'failed';
      download.lastUpdateTime = Date.now();
    }
  }

  /**
   * Get download information for a specific package.
   *
   * @param packageName - Package name
   * @returns Download info or undefined if not found
   */
  getDownload(packageName: string): IDownload | undefined {
    return this.downloads.get(packageName);
  }

  /**
   * Get all active downloads (pending or downloading).
   * Excludes completed and failed downloads.
   *
   * @returns Array of active downloads
   */
  getActiveDownloads(): IDownload[] {
    return [...this.downloads.values()].filter(
      (download) => download.status === 'pending' || download.status === 'downloading'
    );
  }

  /**
   * Get the total count of completed downloads.
   * This count persists even after old downloads are cleaned up.
   *
   * @returns Number of completed downloads
   */
  getCompletedCount(): number {
    return this.completedCount;
  }

  /**
   * Associate an HTTP/2 stream with a package download.
   * Used for tracking multiple concurrent streams per package.
   *
   * @param packageName - Package name
   * @param streamId - HTTP/2 stream ID
   */
  associateStream(packageName: string, streamId: string): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.streamIds.add(streamId);
    }
  }

  /**
   * Remove old completed/failed downloads to prevent memory accumulation.
   * Only cleans up downloads that are completed or failed and older than maxAge.
   * Preserves the completedCount for progress reporting.
   *
   * @param maxAge - Maximum age in milliseconds
   */
  cleanupOldDownloads(maxAge: number): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [packageName, download] of this.downloads) {
      const isFinished = download.status === 'completed' || download.status === 'failed';
      const isOld = now - download.lastUpdateTime > maxAge;

      if (isFinished && isOld) {
        toDelete.push(packageName);
      }
    }

    for (const packageName of toDelete) {
      this.downloads.delete(packageName);
    }
  }

  /**
   * Reset the download manager to initial state.
   * Clears all downloads and resets the completed count.
   */
  reset(): void {
    this.downloads.clear();
    this.completedCount = 0;
  }
}
