/**
 * Example Implementations for UV Parser V2 Architecture
 *
 * These examples demonstrate how the interfaces would be implemented
 * while maintaining separation of concerns and clean architecture.
 */
import type {
  IDownload,
  IDownloadManager,
  IDownloadProgress,
  IEventDispatcher,
  IHttpStream,
  IInstallationState,
  ILineParser,
  ILogEvent,
  IPackageInfo,
  IPackageRegistry,
  IPhaseManager,
  IProgressCalculator,
  IStateAggregator,
  IStreamTracker,
  IUvParser,
  InstallationPhase,
} from './architecture';

// ============================================================================
// LineParser Implementation Example
// ============================================================================

/**
 * Stateless line parser that converts UV log lines to structured events.
 * Uses regular expressions to identify and extract information from log patterns.
 */
export class LineParser implements ILineParser {
  private readonly patterns = {
    uvVersion: /DEBUG uv uv (\d+\.\d+\.\d+)/,
    requirementsFile: /from_source source=(.+\.txt)/,
    pythonVersion: /Solving with installed Python version: ([\d.]+)/,
    dependencyAdded: /Adding direct dependency: ([^<=>]+)(.*)/,
    resolutionComplete: /Resolved (\d+) packages in ([\d.]+)s/,
    downloadPrepare: /preparer::get_wheel name=([^=]+)==([\d.]+), size=(Some\(([\d_]+)\)|None), url="([^"]+)"/,
    downloadInfo: /Downloading (\S+) \(([^)]+)\)/,
    http2Headers: /h2::codec::framed_write send, frame=Headers { stream_id: StreamId\((\d+)\)/,
    http2Data:
      /h2::codec::framed_read received, frame=Data { stream_id: StreamId\((\d+)\)(?:, flags: \(0x1: END_STREAM\))?/,
    http2Settings: /frame=Settings.*max_frame_size:\s*Some\((\d+)\)/,
    packagesPrepared: /Prepared (\d+) packages? in ([\d.]+)(ms|s)/,
    packagesUninstalled: /Uninstalled (\d+) packages? in ([\d.]+)(ms|s)/,
    installationStart: /install_blocking num_wheels=(\d+)/,
    installationComplete: /Installed (\d+) packages? in ([\d.]+)(ms|s)/,
    error: /ERROR: (.+)/,
    warning: /WARN[^:]*: (.+)/,
  };

  /**
   * Parses a single log line into a structured event.
   * @param line Raw log line from UV process
   * @returns Structured event or undefined if line should be ignored
   */
  parseLine(line: string): ILogEvent | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    // Check each pattern and return appropriate event
    for (const [key, pattern] of Object.entries(this.patterns)) {
      const match = trimmed.match(pattern);
      if (match) {
        return this.createEvent(key, match, line);
      }
    }

    // Special case: ignore pure informational "Downloading" lines
    if (trimmed.startsWith('Downloading ') && !trimmed.includes('preparer::get_wheel')) {
      return undefined;
    }

    return {
      type: 'unknown',
      timestamp: Date.now(),
      data: { line: trimmed },
      rawLine: line,
    };
  }

  private createEvent(patternKey: string, match: RegExpMatchArray, rawLine: string): ILogEvent {
    const timestamp = Date.now();

    switch (patternKey) {
      case 'uvVersion':
        return {
          type: 'process_start',
          timestamp,
          data: { version: match[1] },
          rawLine,
        };

      case 'requirementsFile':
        return {
          type: 'requirements_file',
          timestamp,
          data: { file: match[1] },
          rawLine,
        };

      case 'pythonVersion':
        return {
          type: 'python_version',
          timestamp,
          data: { version: match[1] },
          rawLine,
        };

      case 'dependencyAdded':
        return {
          type: 'dependency_added',
          timestamp,
          data: {
            packageName: match[1].trim(),
            versionSpec: match[2].trim(),
          },
          rawLine,
        };

      case 'resolutionComplete':
        return {
          type: 'resolution_complete',
          timestamp,
          data: {
            packageCount: Number.parseInt(match[1]),
            duration: Number.parseFloat(match[2]),
          },
          rawLine,
        };

      case 'downloadPrepare':
        return {
          type: 'download_prepare',
          timestamp,
          data: {
            packageName: match[1],
            version: match[2],
            size: match[3] === 'None' ? 0 : Number.parseInt(match[4].replaceAll('_', '')),
            url: match[5],
          },
          rawLine,
        };

      case 'http2Headers':
        return {
          type: 'http2_headers',
          timestamp,
          data: { streamId: match[1] },
          rawLine,
        };

      case 'http2Data':
        return {
          type: 'http2_data',
          timestamp,
          data: {
            streamId: match[1],
            isEndStream: rawLine.includes('END_STREAM'),
          },
          rawLine,
        };

      case 'http2Settings':
        return {
          type: 'http2_settings',
          timestamp,
          data: { maxFrameSize: Number.parseInt(match[1]) },
          rawLine,
        };

      case 'packagesPrepared':
        return {
          type: 'packages_prepared',
          timestamp,
          data: {
            count: Number.parseInt(match[1]),
            duration: match[3] === 's' ? Number.parseFloat(match[2]) * 1000 : Number.parseFloat(match[2]),
          },
          rawLine,
        };

      case 'installationComplete':
        return {
          type: 'installation_complete',
          timestamp,
          data: {
            count: Number.parseInt(match[1]),
            duration: match[3] === 's' ? Number.parseFloat(match[2]) * 1000 : Number.parseFloat(match[2]),
          },
          rawLine,
        };

      case 'error':
        return {
          type: 'error',
          timestamp,
          data: { message: match[1] },
          rawLine,
        };

      default:
        return {
          type: 'unknown',
          timestamp,
          data: { match },
          rawLine,
        };
    }
  }
}

// ============================================================================
// PhaseManager Implementation Example
// ============================================================================

/**
 * Manages the installation phase state machine with valid transitions.
 * Tracks phase history and timing for performance analysis.
 */
export class PhaseManager implements IPhaseManager {
  private currentPhase: InstallationPhase = 'idle';
  private phaseHistory: InstallationPhase[] = ['idle'];
  private readonly phaseTimestamps: Map<InstallationPhase, number> = new Map();

  private readonly validTransitions: Record<InstallationPhase, InstallationPhase[]> = {
    idle: ['started'],
    started: ['reading_requirements'],
    reading_requirements: ['resolving'],
    resolving: ['resolved', 'error'],
    resolved: ['preparing_download', 'error'],
    preparing_download: ['downloading', 'prepared', 'error'],
    downloading: ['preparing_download', 'prepared', 'error'],
    prepared: ['installing', 'error'],
    installing: ['installed', 'error'],
    installed: [],
    error: [],
  };

  constructor() {
    this.phaseTimestamps.set('idle', Date.now());
  }

  getCurrentPhase(): InstallationPhase {
    return this.currentPhase;
  }

  getPhaseHistory(): InstallationPhase[] {
    return [...this.phaseHistory];
  }

  transitionTo(newPhase: InstallationPhase): boolean {
    if (!this.isValidTransition(this.currentPhase, newPhase)) {
      // Special case: allow downloading <-> preparing_download cycles
      const isCyclicDownload =
        (this.currentPhase === 'downloading' && newPhase === 'preparing_download') ||
        (this.currentPhase === 'preparing_download' && newPhase === 'downloading');

      if (!isCyclicDownload) {
        return false;
      }
    }

    this.currentPhase = newPhase;

    // Only add to history if it's a new phase (not a cycle)
    if (!this.phaseHistory.includes(newPhase) || newPhase === 'error') {
      this.phaseHistory.push(newPhase);
      this.phaseTimestamps.set(newPhase, Date.now());
    }

    return true;
  }

  isValidTransition(from: InstallationPhase, to: InstallationPhase): boolean {
    // Error can be entered from any phase
    if (to === 'error') return true;

    // Check if transition is in the valid list
    return this.validTransitions[from]?.includes(to) ?? false;
  }

  getPhaseTimestamp(phase: InstallationPhase): number | undefined {
    return this.phaseTimestamps.get(phase);
  }

  reset(): void {
    this.currentPhase = 'idle';
    this.phaseHistory = ['idle'];
    this.phaseTimestamps.clear();
    this.phaseTimestamps.set('idle', Date.now());
  }
}

// ============================================================================
// PackageRegistry Implementation Example
// ============================================================================

/**
 * Central registry for all packages in the installation.
 * Maintains package metadata and status throughout the process.
 */
export class PackageRegistry implements IPackageRegistry {
  private readonly packages: Map<string, IPackageInfo> = new Map();

  registerPackage(info: Partial<IPackageInfo> & { name: string }): void {
    const existing = this.packages.get(info.name);

    const packageInfo: IPackageInfo = {
      name: info.name,
      version: info.version || existing?.version || '',
      versionSpec: info.versionSpec || existing?.versionSpec,
      url: info.url || existing?.url,
      sizeBytes: info.sizeBytes ?? existing?.sizeBytes ?? 0,
      discoveredAt: existing?.discoveredAt || Date.now(),
      status: info.status || existing?.status || 'pending',
    };

    this.packages.set(info.name, packageInfo);
  }

  getPackage(name: string): IPackageInfo | undefined {
    return this.packages.get(name);
  }

  getAllPackages(): IPackageInfo[] {
    return [...this.packages.values()];
  }

  getPackagesByStatus(status: IPackageInfo['status']): IPackageInfo[] {
    return [...this.packages.values()].filter((pkg) => pkg.status === status);
  }

  updatePackageStatus(name: string, status: IPackageInfo['status']): void {
    const pkg = this.packages.get(name);
    if (pkg) {
      pkg.status = status;
    }
  }

  getStatistics() {
    const stats = {
      total: 0,
      pending: 0,
      downloading: 0,
      downloaded: 0,
      installing: 0,
      installed: 0,
      failed: 0,
    };

    for (const pkg of this.packages.values()) {
      stats.total++;
      stats[pkg.status]++;
    }

    return stats;
  }

  reset(): void {
    this.packages.clear();
  }
}

// ============================================================================
// DownloadManager Implementation Example
// ============================================================================

/**
 * Manages individual package downloads with progress tracking.
 * Handles download lifecycle from start to completion/failure.
 */
export class DownloadManager implements IDownloadManager {
  private readonly downloads: Map<string, IDownload> = new Map();
  private completedCount = 0;
  private readonly maxDownloads: number;

  constructor(maxDownloads = 100) {
    this.maxDownloads = maxDownloads;
  }

  startDownload(packageName: string, totalBytes: number, url: string): void {
    const download: IDownload = {
      packageName,
      totalBytes,
      bytesReceived: 0,
      estimatedBytes: 0,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      status: 'pending',
      streamIds: new Set(),
    };

    // Store URL for reference (could be used for retry logic)
    console.debug(`Starting download from ${url}`);

    this.downloads.set(packageName, download);

    // Cleanup if we have too many downloads
    if (this.downloads.size > this.maxDownloads) {
      this.cleanupOldDownloads(300_000); // 5 minutes
    }
  }

  updateProgress(packageName: string, bytesReceived: number): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.bytesReceived = bytesReceived;
      download.lastUpdateTime = Date.now();

      if (download.status === 'pending') {
        download.status = 'downloading';
      }
    }
  }

  updateEstimatedProgress(packageName: string, estimatedBytes: number): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.estimatedBytes = Math.min(estimatedBytes, download.totalBytes);
      download.lastUpdateTime = Date.now();

      if (download.status === 'pending') {
        download.status = 'downloading';
      }
    }
  }

  completeDownload(packageName: string): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.status = 'completed';
      download.bytesReceived = download.totalBytes;
      download.lastUpdateTime = Date.now();
      this.completedCount++;
    }
  }

  failDownload(packageName: string, error: string): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.status = 'failed';
      download.lastUpdateTime = Date.now();
      console.error(`Download failed for ${packageName}: ${error}`);
    }
  }

  getDownload(packageName: string): IDownload | undefined {
    return this.downloads.get(packageName);
  }

  getActiveDownloads(): IDownload[] {
    return [...this.downloads.values()].filter((d) => d.status === 'downloading' || d.status === 'pending');
  }

  getCompletedCount(): number {
    return this.completedCount;
  }

  associateStream(packageName: string, streamId: string): void {
    const download = this.downloads.get(packageName);
    if (download) {
      download.streamIds.add(streamId);
    }
  }

  cleanupOldDownloads(maxAge: number): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [name, download] of this.downloads.entries()) {
      if (download.status === 'completed' || download.status === 'failed') {
        const age = now - download.lastUpdateTime;
        if (age > maxAge) {
          toDelete.push(name);
        }
      }
    }

    for (const name of toDelete) {
      this.downloads.delete(name);
    }
  }

  reset(): void {
    this.downloads.clear();
    this.completedCount = 0;
  }
}

// ============================================================================
// StreamTracker Implementation Example
// ============================================================================

/**
 * Tracks HTTP/2 streams and intelligently associates them with downloads.
 * Handles the complex stream-to-package matching logic.
 */
export class StreamTracker implements IStreamTracker {
  private readonly streams: Map<string, IHttpStream> = new Map();
  private readonly streamToPackage: Map<string, string> = new Map();
  private maxFrameSize = 16_384; // Default HTTP/2 frame size

  registerStream(streamId: string, timestamp: number): void {
    const stream: IHttpStream = {
      id: streamId,
      frameCount: 0,
      startTime: timestamp,
      lastFrameTime: timestamp,
      isComplete: false,
    };

    this.streams.set(streamId, stream);
  }

  recordDataFrame(streamId: string, timestamp: number, isEndStream: boolean): void {
    let stream = this.streams.get(streamId);

    if (!stream) {
      // Create stream if it doesn't exist (first frame)
      stream = {
        id: streamId,
        frameCount: 1,
        startTime: timestamp,
        lastFrameTime: timestamp,
        isComplete: isEndStream,
      };
      this.streams.set(streamId, stream);
    } else {
      stream.frameCount++;
      stream.lastFrameTime = timestamp;
      stream.isComplete = isEndStream;
    }

    if (isEndStream) {
      // Schedule cleanup after a delay
      setTimeout(() => this.cleanupCompletedStreams(), 1000);
    }
  }

  associateWithPackage(streamId: string, packageName: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    // Check if already associated
    if (stream.packageName) return false;

    stream.packageName = packageName;
    this.streamToPackage.set(streamId, packageName);
    return true;
  }

  getStream(streamId: string): IHttpStream | undefined {
    return this.streams.get(streamId);
  }

  getActiveStreams(): Map<string, IHttpStream> {
    const active = new Map<string, IHttpStream>();

    for (const [id, stream] of this.streams.entries()) {
      if (!stream.isComplete) {
        active.set(id, stream);
      }
    }

    return active;
  }

  getPackageForStream(streamId: string): string | undefined {
    return this.streamToPackage.get(streamId);
  }

  findUnassociatedStreamForPackage(packageName: string): string | undefined {
    // Find streams without package associations
    // Could use packageName for heuristic matching in future
    console.debug(`Finding stream for package: ${packageName}`);
    for (const [id, stream] of this.streams.entries()) {
      if (!stream.packageName && !stream.isComplete) {
        return id;
      }
    }
    return undefined;
  }

  updateMaxFrameSize(maxFrameSize: number): void {
    this.maxFrameSize = maxFrameSize;
  }

  getMaxFrameSize(): number {
    return this.maxFrameSize;
  }

  cleanupCompletedStreams(): void {
    const toDelete: string[] = [];

    for (const [id, stream] of this.streams.entries()) {
      if (stream.isComplete) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.streams.delete(id);
      this.streamToPackage.delete(id);
    }
  }

  reset(): void {
    this.streams.clear();
    this.streamToPackage.clear();
    this.maxFrameSize = 16_384;
  }
}

// ============================================================================
// ProgressCalculator Implementation Example
// ============================================================================

/**
 * Calculates download progress, transfer rates, and time estimates.
 * Provides accurate progress tracking using multiple data sources.
 */
export class ProgressCalculator implements IProgressCalculator {
  private readonly transferRateSamples: Map<string, Array<{ timestamp: number; bytesPerSecond: number }>> = new Map();

  calculateProgress(download: IDownload, stream?: IHttpStream, maxFrameSize = 16_384): IDownloadProgress {
    const now = Date.now();
    const elapsedMs = now - download.startTime;

    // Calculate bytes received (prefer actual, fallback to estimated)
    const bytesReceived = download.bytesReceived;
    let estimatedBytes = download.estimatedBytes;

    if (stream && !bytesReceived) {
      estimatedBytes = Math.min(stream.frameCount * maxFrameSize, download.totalBytes);
    }

    const effectiveBytes = bytesReceived || estimatedBytes;
    const percentComplete = download.totalBytes > 0 ? (effectiveBytes / download.totalBytes) * 100 : 0;

    // Calculate transfer rate
    const transferRate = this.calculateCurrentTransferRate(download.packageName, effectiveBytes, elapsedMs);

    // Estimate time remaining
    const bytesRemaining = download.totalBytes - effectiveBytes;
    const etaSeconds = this.estimateTimeRemaining(bytesRemaining, transferRate);

    return {
      packageName: download.packageName,
      totalBytes: download.totalBytes,
      bytesReceived,
      estimatedBytes,
      percentComplete: Math.min(100, percentComplete),
      transferRate,
      etaSeconds,
      elapsedMs,
    };
  }

  private calculateCurrentTransferRate(packageName: string, currentBytes: number, elapsedMs: number): number {
    // Get or create samples array for this package
    let samples = this.transferRateSamples.get(packageName);
    if (!samples) {
      samples = [];
      this.transferRateSamples.set(packageName, samples);
    }

    // Calculate instantaneous rate
    const elapsedSeconds = Math.max(elapsedMs / 1000, 0.001);
    const instantRate = currentBytes / elapsedSeconds;

    // Add new sample
    samples.push({
      timestamp: Date.now(),
      bytesPerSecond: instantRate,
    });

    // Keep only recent samples (last 5 seconds)
    const windowMs = 5000;
    const cutoff = Date.now() - windowMs;
    const recentSamples = samples.filter((s) => s.timestamp > cutoff);
    this.transferRateSamples.set(packageName, recentSamples);

    // Calculate average rate
    return this.calculateTransferRate(recentSamples, windowMs);
  }

  calculateTransferRate(samples: Array<{ timestamp: number; bytesPerSecond: number }>, windowMs: number): number {
    if (samples.length === 0) return 0;

    // Filter samples within the time window
    const cutoff = Date.now() - windowMs;
    const recentSamples = samples.filter((s) => s.timestamp > cutoff);

    if (recentSamples.length === 0) return 0;

    // Simple average of recent samples
    const sum = recentSamples.reduce((acc, s) => acc + s.bytesPerSecond, 0);
    return sum / recentSamples.length;
  }

  estimateTimeRemaining(bytesRemaining: number, transferRate: number): number | undefined {
    if (bytesRemaining <= 0) return 0;
    if (transferRate <= 0) return undefined;

    return bytesRemaining / transferRate;
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    if (i === 0) return `${bytes} B`;

    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(1)} ${units[i]}`;
  }

  formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

// ============================================================================
// Main UvParser Implementation Example
// ============================================================================

/**
 * Main orchestrator that coordinates all components.
 * Provides the primary interface for parsing UV output.
 */
export class UvParser implements IUvParser {
  private readonly lineParser: ILineParser;
  private readonly phaseManager: IPhaseManager;
  private readonly packageRegistry: IPackageRegistry;
  private readonly downloadManager: IDownloadManager;
  private readonly streamTracker: IStreamTracker;
  private readonly progressCalculator: IProgressCalculator;
  private readonly stateAggregator: IStateAggregator;
  private readonly eventDispatcher: IEventDispatcher;

  constructor(components: {
    lineParser: ILineParser;
    phaseManager: IPhaseManager;
    packageRegistry: IPackageRegistry;
    downloadManager: IDownloadManager;
    streamTracker: IStreamTracker;
    progressCalculator: IProgressCalculator;
    stateAggregator: IStateAggregator;
    eventDispatcher: IEventDispatcher;
  }) {
    this.lineParser = components.lineParser;
    this.phaseManager = components.phaseManager;
    this.packageRegistry = components.packageRegistry;
    this.downloadManager = components.downloadManager;
    this.streamTracker = components.streamTracker;
    this.progressCalculator = components.progressCalculator;
    this.stateAggregator = components.stateAggregator;
    this.eventDispatcher = components.eventDispatcher;
  }

  processLine(line: string): void {
    const event = this.lineParser.parseLine(line);
    if (event) {
      this.stateAggregator.processEvent(event);
      const state = this.stateAggregator.getState();
      this.eventDispatcher.processStateChange(state);
    }
  }

  getState(): IInstallationState {
    return this.stateAggregator.getState();
  }

  onStatusChange(listener: (state: IInstallationState) => void): () => void {
    return this.eventDispatcher.onStatusChange(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    return this.eventDispatcher.onError(listener);
  }

  onComplete(listener: (success: boolean) => void): () => void {
    return this.eventDispatcher.onComplete(listener);
  }

  reset(): void {
    this.phaseManager.reset();
    this.packageRegistry.reset();
    this.downloadManager.reset();
    this.streamTracker.reset();
    this.stateAggregator.reset();
  }

  cleanup(): void {
    this.downloadManager.cleanupOldDownloads(300_000);
    this.streamTracker.cleanupCompletedStreams();
  }

  getComponent<T>(component: string): T {
    const components: Record<string, unknown> = {
      phaseManager: this.phaseManager,
      packageRegistry: this.packageRegistry,
      downloadManager: this.downloadManager,
      streamTracker: this.streamTracker,
      progressCalculator: this.progressCalculator,
    };

    return components[component] as T;
  }
}
