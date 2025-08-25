/**
 * UV Parser V2 - Modular Architecture Design
 *
 * This architecture provides a clean separation of concerns for parsing UV process output.
 * Each component has a single responsibility and communicates through well-defined interfaces.
 */
// Import and re-export strongly-typed event definitions
import type { ILogEvent } from './event-types';

export type { ILogEvent, EventType, EventData, EventDataMap } from './event-types';
export { isEventType, isErrorEvent, isDownloadEvent, isHttp2Event, createLogEvent } from './event-types';

// ============================================================================
// Core Data Types
// ============================================================================

/**
 * Represents the current phase of the UV installation process
 */
export type InstallationPhase =
  | 'idle'
  | 'started'
  | 'reading_requirements'
  | 'resolving'
  | 'resolved'
  | 'preparing_download'
  | 'downloading'
  | 'prepared'
  | 'installing'
  | 'installed'
  | 'error';

/**
 * Status of an individual package download
 */
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

// ============================================================================
// Component Interfaces
// ============================================================================

/**
 * Parses individual UV log lines into structured events.
 * This is a pure function with no state management.
 *
 * The returned ILogEvent is a discriminated union with strongly-typed
 * data for each event type. Use type guards like isEventType() to
 * narrow the type and access event-specific data safely.
 */
export interface ILineParser {
  /**
   * Parses a single log line and returns a structured event.
   * @param line The raw log line from UV process output
   * @returns A structured event or undefined if the line should be ignored
   */
  parseLine(line: string): ILogEvent | undefined;
}

/**
 * Manages the installation phase state machine.
 * Ensures valid phase transitions and tracks phase history.
 */
export interface IPhaseManager {
  /**
   * Gets the current installation phase
   */
  getCurrentPhase(): InstallationPhase;

  /**
   * Gets the complete phase history
   */
  getPhaseHistory(): InstallationPhase[];

  /**
   * Attempts to transition to a new phase.
   * @param newPhase The phase to transition to
   * @returns true if transition was successful, false if invalid
   */
  transitionTo(newPhase: InstallationPhase): boolean;

  /**
   * Checks if a phase transition is valid.
   * @param from Current phase
   * @param to Target phase
   * @returns true if the transition is allowed
   */
  isValidTransition(from: InstallationPhase, to: InstallationPhase): boolean;

  /**
   * Gets the timestamp of when a phase was entered.
   * @param phase The phase to query
   * @returns Timestamp or undefined if phase not reached
   */
  getPhaseTimestamp(phase: InstallationPhase): number | undefined;

  /**
   * Resets the phase manager to initial state
   */
  reset(): void;
}

/**
 * Information about a package in the installation
 */
export interface IPackageInfo {
  /** Package name */
  name: string;

  /** Package version */
  version: string;

  /** Version specification (e.g., ">=3.11.8") */
  versionSpec?: string;

  /** Download URL */
  url?: string;

  /** Package size in bytes */
  sizeBytes: number;

  /** When this package was first seen */
  discoveredAt: number;

  /** Current status */
  status: 'pending' | 'downloading' | 'downloaded' | 'installing' | 'installed' | 'failed';
}

/**
 * Registry of all packages involved in the installation.
 * Acts as the single source of truth for package information.
 */
export interface IPackageRegistry {
  /**
   * Registers a new package or updates existing package info.
   * @param info Package information
   */
  registerPackage(info: Partial<IPackageInfo> & { name: string }): void;

  /**
   * Gets information about a specific package.
   * @param name Package name
   * @returns Package info or undefined if not found
   */
  getPackage(name: string): IPackageInfo | undefined;

  /**
   * Gets all registered packages.
   * @returns Array of all package information
   */
  getAllPackages(): IPackageInfo[];

  /**
   * Gets packages filtered by status.
   * @param status Status to filter by
   * @returns Array of matching packages
   */
  getPackagesByStatus(status: IPackageInfo['status']): IPackageInfo[];

  /**
   * Updates the status of a package.
   * @param name Package name
   * @param status New status
   */
  updatePackageStatus(name: string, status: IPackageInfo['status']): void;

  /**
   * Gets count statistics for packages.
   * @returns Object with counts by status
   */
  getStatistics(): {
    total: number;
    pending: number;
    downloading: number;
    downloaded: number;
    installing: number;
    installed: number;
    failed: number;
  };

  /**
   * Resets the registry
   */
  reset(): void;
}

/**
 * Represents an active download operation
 */
export interface IDownload {
  /** Package name being downloaded */
  packageName: string;

  /** Total size in bytes */
  totalBytes: number;

  /** Bytes received so far */
  bytesReceived: number;

  /** Download start time */
  startTime: number;

  /** Last update time */
  lastUpdateTime: number;

  /** Current status */
  status: DownloadStatus;

  /** Associated HTTP/2 stream IDs */
  streamIds: Set<string>;
}

/**
 * Manages individual package downloads.
 * Tracks download progress and status for each package.
 */
export interface IDownloadManager {
  /**
   * Begins tracking a download operation.
   * @param packageName Package being downloaded
   * @param totalBytes Total size in bytes
   * @param url Download URL
   */
  trackDownload(packageName: string, totalBytes: number, url: string): void;

  /**
   * Updates download progress.
   * @param packageName Package name
   * @param bytesReceived New bytes received count
   */
  updateProgress(packageName: string, bytesReceived: number): void;

  /**
   * Marks a download as completed.
   * @param packageName Package name
   */
  completeDownload(packageName: string): void;

  /**
   * Marks a download as failed.
   * @param packageName Package name
   * @param error Error message
   */
  failDownload(packageName: string, error: string): void;

  /**
   * Gets download information for a package.
   * @param packageName Package name
   * @returns Download info or undefined
   */
  getDownload(packageName: string): IDownload | undefined;

  /**
   * Gets all active downloads.
   * @returns Array of active downloads
   */
  getActiveDownloads(): IDownload[];

  /**
   * Gets count of completed downloads.
   * @returns Number of completed downloads
   */
  getCompletedCount(): number;

  /**
   * Associates an HTTP/2 stream with a download.
   * @param packageName Package name
   * @param streamId Stream ID
   */
  associateStream(packageName: string, streamId: string): void;

  /**
   * Removes old completed downloads to prevent memory accumulation.
   * @param maxAge Maximum age in milliseconds
   */
  cleanupOldDownloads(maxAge: number): void;

  /**
   * Resets the download manager
   */
  reset(): void;
}

/**
 * Represents an HTTP/2 stream
 */
export interface IHttpStream {
  /** Stream ID */
  id: string;

  /** Number of data frames received */
  frameCount: number;

  /** Time of first frame */
  startTime: number;

  /** Time of last frame */
  lastFrameTime: number;

  /** Associated package name */
  packageName?: string;

  /** Whether stream has completed (END_STREAM flag) */
  isComplete: boolean;
}

/**
 * Tracks HTTP/2 streams and associates them with package downloads.
 * Handles the complex logic of matching streams to downloads.
 */
export interface IStreamTracker {
  /**
   * Registers a new HTTP/2 stream.
   * @param streamId Stream ID
   * @param timestamp When the stream started
   */
  registerStream(streamId: string, timestamp: number): void;

  /**
   * Records a data frame for a stream.
   * @param streamId Stream ID
   * @param timestamp Frame timestamp
   * @param isEndStream Whether this is the final frame
   */
  recordDataFrame(streamId: string, timestamp: number, isEndStream: boolean): void;

  /**
   * Associates a stream with a package download.
   * @param streamId Stream ID
   * @param packageName Package name
   * @returns true if association was successful
   */
  associateWithPackage(streamId: string, packageName: string): boolean;

  /**
   * Gets stream information.
   * @param streamId Stream ID
   * @returns Stream info or undefined
   */
  getStream(streamId: string): IHttpStream | undefined;

  /**
   * Gets all active streams.
   * @returns Map of stream ID to stream info
   */
  getActiveStreams(): Map<string, IHttpStream>;

  /**
   * Gets the package associated with a stream.
   * @param streamId Stream ID
   * @returns Package name or undefined
   */
  getPackageForStream(streamId: string): string | undefined;

  /**
   * Finds an unassociated stream that could belong to a package.
   * @param packageName Package to find stream for
   * @returns Stream ID or undefined
   */
  findUnassociatedStreamForPackage(packageName: string): string | undefined;

  /**
   * Updates the max frame size based on HTTP/2 settings.
   * @param maxFrameSize New max frame size in bytes
   */
  updateMaxFrameSize(maxFrameSize: number): void;

  /**
   * Gets the current max frame size.
   * @returns Max frame size in bytes
   */
  getMaxFrameSize(): number;

  /**
   * Cleans up completed streams.
   */
  cleanupCompletedStreams(): void;

  /**
   * Resets the stream tracker
   */
  reset(): void;
}

/**
 * Download progress with transfer rate calculation
 */
export interface IDownloadProgress {
  /** Package name */
  packageName: string;

  /** Total bytes to download */
  totalBytes: number;

  /** Bytes received */
  bytesReceived: number;

  /** Percentage complete (0-100) */
  percentComplete: number;

  /** Current transfer rate in bytes/second */
  transferRate: number;

  /** Estimated time remaining in seconds */
  etaSeconds?: number;

  /** Duration so far in milliseconds */
  elapsedMs: number;
}

/**
 * Calculates download progress, transfer rates, and ETAs.
 * Provides accurate progress tracking and time estimates.
 */
export interface IProgressCalculator {
  /**
   * Calculates progress for a download.
   * @param download Download information
   * @param stream Associated HTTP stream (optional)
   * @param maxFrameSize Max frame size for estimation
   * @returns Calculated progress
   */
  calculateProgress(download: IDownload, stream?: IHttpStream, maxFrameSize?: number): IDownloadProgress;

  /**
   * Calculates average transfer rate over a time window.
   * @param samples Array of {timestamp, bytesPerSecond} samples
   * @param windowMs Time window in milliseconds
   * @returns Average transfer rate in bytes/second
   */
  calculateTransferRate(samples: Array<{ timestamp: number; bytesPerSecond: number }>, windowMs: number): number;

  /**
   * Estimates time remaining for a download.
   * @param bytesRemaining Bytes left to download
   * @param transferRate Current transfer rate in bytes/second
   * @returns Estimated seconds remaining
   */
  estimateTimeRemaining(bytesRemaining: number, transferRate: number): number | undefined;

  /**
   * Formats bytes into human-readable string.
   * @param bytes Number of bytes
   * @returns Formatted string (e.g., "1.5 MB")
   */
  formatBytes(bytes: number): string;

  /**
   * Formats duration into human-readable string.
   * @param seconds Duration in seconds
   * @returns Formatted string (e.g., "1m 30s")
   */
  formatDuration(seconds: number): string;
}

/**
 * Overall installation state
 */
export interface IInstallationState {
  /** Current phase */
  phase: InstallationPhase;

  /** Phase history */
  phaseHistory: InstallationPhase[];

  /** Human-readable status message */
  message: string;

  /** UV version */
  uvVersion?: string;

  /** Python version */
  pythonVersion?: string;

  /** Requirements file path */
  requirementsFile?: string;

  /** Package statistics */
  packages: {
    total: number;
    resolved: number;
    downloaded: number;
    installed: number;
  };

  /** Currently active operation */
  currentOperation?: {
    type: 'resolving' | 'downloading' | 'installing';
    packageName?: string;
    progress?: IDownloadProgress;
  };

  /** Overall progress percentage (0-100) */
  overallProgress: number;

  /** Whether installation is complete */
  isComplete: boolean;

  /** Error information if failed */
  error?: {
    message: string;
    phase: InstallationPhase;
    timestamp: number;
  };

  /** Timing information */
  timing: {
    startTime?: number;
    endTime?: number;
    phaseDurations: Partial<Record<InstallationPhase, number>>;
  };
}

/**
 * Aggregates state from all components into a unified view.
 * Provides the overall installation state and progress.
 */
export interface IStateAggregator {
  /**
   * Updates state based on a parsed event.
   * @param event Parsed log event
   */
  processEvent(event: ILogEvent): void;

  /**
   * Gets the current aggregated state.
   * @returns Current installation state
   */
  getState(): IInstallationState;

  /**
   * Calculates overall installation progress.
   * @returns Progress percentage (0-100)
   */
  calculateOverallProgress(): number;

  /**
   * Generates a human-readable status message.
   * @returns Status message
   */
  generateStatusMessage(): string;

  /**
   * Checks if installation is complete.
   * @returns true if installation finished (success or failure)
   */
  isComplete(): boolean;

  /**
   * Resets the aggregator
   */
  reset(): void;
}

/**
 * Dispatches meaningful status change events.
 * Implements intelligent throttling to prevent event spam.
 */
export interface IEventDispatcher {
  /**
   * Processes a state change and emits events if needed.
   * @param newState New installation state
   * @param forceEmit Whether to force emit regardless of throttling
   */
  processStateChange(newState: IInstallationState, forceEmit?: boolean): void;

  /**
   * Registers a listener for status changes.
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  onStatusChange(listener: (state: IInstallationState) => void): () => void;

  /**
   * Registers a listener for errors.
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  onError(listener: (error: Error) => void): () => void;

  /**
   * Registers a listener for completion.
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  onComplete(listener: (success: boolean) => void): () => void;

  /**
   * Removes all listeners
   */
  removeAllListeners(): void;
}

// ============================================================================
// Main Orchestrator Interface
// ============================================================================

/**
 * Main orchestrator that coordinates all components.
 * This is the primary interface for using the UV parser.
 */
export interface IUvParser {
  /**
   * Processes a line of UV output.
   * @param line Raw log line from UV process
   */
  processLine(line: string): void;

  /**
   * Gets the current installation state.
   * @returns Current state snapshot
   */
  getState(): IInstallationState;

  /**
   * Registers a status change listener.
   * @param listener Callback for status changes
   * @returns Unsubscribe function
   */
  onStatusChange(listener: (state: IInstallationState) => void): () => void;

  /**
   * Registers an error listener.
   * @param listener Callback for errors
   * @returns Unsubscribe function
   */
  onError(listener: (error: Error) => void): () => void;

  /**
   * Registers a completion listener.
   * @param listener Callback for completion
   * @returns Unsubscribe function
   */
  onComplete(listener: (success: boolean) => void): () => void;

  /**
   * Resets the parser to initial state.
   */
  reset(): void;

  /**
   * Performs cleanup (removes old downloads, completed streams, etc).
   */
  cleanup(): void;

  /**
   * Gets a specific component for advanced usage.
   * @param component Component name
   * @returns Component instance
   */
  getComponent<T>(
    component: 'phaseManager' | 'packageRegistry' | 'downloadManager' | 'streamTracker' | 'progressCalculator'
  ): T;
}

// ============================================================================
// Factory Interface
// ============================================================================

/**
 * Factory for creating UV parser instances.
 * Handles dependency injection and configuration.
 */
export interface IUvParserFactory {
  /**
   * Creates a new UV parser instance.
   * @returns Configured parser instance
   */
  createParser(): IUvParser;

  /**
   * Creates individual components for testing or custom usage.
   */
  createComponents(): {
    lineParser: ILineParser;
    phaseManager: IPhaseManager;
    packageRegistry: IPackageRegistry;
    downloadManager: IDownloadManager;
    streamTracker: IStreamTracker;
    progressCalculator: IProgressCalculator;
    stateAggregator: IStateAggregator;
    eventDispatcher: IEventDispatcher;
  };
}
