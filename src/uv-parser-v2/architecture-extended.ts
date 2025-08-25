/**
 * UV Parser V2 - Extended Architecture Components
 *
 * Additional granular interfaces that provide better separation of concerns
 * and address the requirement that "everything that can be broken down should be"
 */
import type { IDownload, IHttpStream, IInstallationState, ILogEvent, InstallationPhase } from './architecture';

// ============================================================================
// Error Management Interfaces
// ============================================================================

/**
 * Represents a single error occurrence during installation
 */
export interface IErrorEntry {
  /** Timestamp when error occurred */
  timestamp: number;
  /** Phase when error occurred */
  phase: InstallationPhase;
  /** Error message */
  message: string;
  /** Associated package if applicable */
  packageName?: string;
  /** Original log line that generated the error */
  rawLine?: string;
}

/**
 * Manages error collection and querying throughout the installation process.
 *
 * Interactions:
 * - Receives error events from IEventProcessor
 * - Provides error history to IStateBuilder
 * - Can trigger error notifications through IEventDispatcher
 */
export interface IErrorCollector {
  /**
   * Records a new error.
   * Called by IEventProcessor when processing error events.
   *
   * @param error Error details to record
   */
  recordError(error: IErrorEntry): void;

  /**
   * Gets all recorded errors.
   * Used by IStateBuilder to include errors in installation state.
   *
   * @returns Array of all errors
   */
  getAllErrors(): IErrorEntry[];

  /**
   * Gets errors for a specific package.
   * Used by IPackageRegistry to update package status.
   *
   * @param packageName Package to filter by
   * @returns Array of errors for that package
   */
  getErrorsForPackage(packageName: string): IErrorEntry[];

  /**
   * Gets the most recent error.
   * Used by IStateBuilder for current error status.
   *
   * @returns Most recent error or undefined
   */
  getLastError(): IErrorEntry | undefined;

  /**
   * Checks if any critical errors have occurred.
   * Used by IProgressTracker to determine if installation should halt.
   *
   * @returns true if critical errors exist
   */
  hasCriticalErrors(): boolean;

  /**
   * Clears all errors.
   */
  reset(): void;
}

// ============================================================================
// Timing and Metrics Interfaces
// ============================================================================

/**
 * Tracks timing metrics for each phase of the installation
 */
export interface IPhaseMetrics {
  /** Phase name */
  phase: InstallationPhase;
  /** Start timestamp */
  startTime: number;
  /** End timestamp (undefined if still running) */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Number of operations in this phase */
  operationCount?: number;
}

/**
 * Collects and manages timing metrics throughout the installation.
 *
 * Interactions:
 * - Updated by IPhaseManager on phase transitions
 * - Provides metrics to IStateBuilder for timing information
 * - Used by IProgressCalculator for ETA calculations
 */
export interface IMetricsCollector {
  /**
   * Records the start of a phase.
   * Called by IPhaseManager when transitioning to a new phase.
   *
   * @param phase Phase that is starting
   */
  recordPhaseStart(phase: InstallationPhase): void;

  /**
   * Records the end of a phase.
   * Called by IPhaseManager when leaving a phase.
   *
   * @param phase Phase that is ending
   */
  recordPhaseEnd(phase: InstallationPhase): void;

  /**
   * Records an operation within a phase.
   * Called by IEventProcessor for countable operations.
   *
   * @param phase Current phase
   * @param operation Operation type (e.g., 'package_resolved', 'download_started')
   */
  recordOperation(phase: InstallationPhase, operation: string): void;

  /**
   * Gets metrics for a specific phase.
   * Used by IStateBuilder to include timing in state.
   *
   * @param phase Phase to get metrics for
   * @returns Metrics or undefined if phase not recorded
   */
  getPhaseMetrics(phase: InstallationPhase): IPhaseMetrics | undefined;

  /**
   * Gets all phase metrics.
   * Used by IStateBuilder for complete timing information.
   *
   * @returns Array of all phase metrics
   */
  getAllMetrics(): IPhaseMetrics[];

  /**
   * Calculates total elapsed time.
   * Used by IProgressTracker for overall progress calculation.
   *
   * @returns Total milliseconds elapsed
   */
  getTotalElapsedTime(): number;

  /**
   * Estimates remaining time based on historical metrics.
   * Used by IProgressCalculator for ETA calculations.
   *
   * @param currentPhase Current phase
   * @param progress Progress in current phase (0-100)
   * @returns Estimated milliseconds remaining
   */
  estimateRemainingTime(currentPhase: InstallationPhase, progress: number): number | undefined;

  /**
   * Resets all metrics.
   */
  reset(): void;
}

// ============================================================================
// Transfer Rate Management Interfaces
// ============================================================================

/**
 * Sample of transfer rate at a point in time
 */
export interface ITransferSample {
  /** Timestamp of sample */
  timestamp: number;
  /** Package this sample is for */
  packageName: string;
  /** Bytes per second at this time */
  bytesPerSecond: number;
  /** Total bytes transferred so far */
  totalBytes: number;
}

/**
 * Manages transfer rate history and calculations.
 *
 * Interactions:
 * - Updated by IDownloadManager as downloads progress
 * - Used by IProgressCalculator for rate calculations
 * - Provides data to IStateBuilder for current transfer rates
 */
export interface ITransferRateTracker {
  /**
   * Records a transfer rate sample.
   * Called by IDownloadManager when progress updates.
   *
   * @param sample Transfer rate sample
   */
  recordSample(sample: ITransferSample): void;

  /**
   * Gets recent samples for a package.
   * Used by IProgressCalculator for rate calculations.
   *
   * @param packageName Package to get samples for
   * @param windowMs Time window in milliseconds
   * @returns Array of recent samples
   */
  getRecentSamples(packageName: string, windowMs: number): ITransferSample[];

  /**
   * Calculates average rate for a package.
   * Used by IProgressCalculator for ETA calculations.
   *
   * @param packageName Package to calculate for
   * @param windowMs Time window for average
   * @returns Average bytes per second
   */
  getAverageRate(packageName: string, windowMs: number): number;

  /**
   * Gets global average transfer rate.
   * Used by IStateBuilder for overall transfer rate.
   *
   * @param windowMs Time window for average
   * @returns Global average bytes per second
   */
  getGlobalAverageRate(windowMs: number): number;

  /**
   * Cleans up old samples to prevent memory growth.
   * Called periodically by main parser.
   *
   * @param maxAge Maximum age in milliseconds
   */
  cleanupOldSamples(maxAge: number): void;

  /**
   * Resets all samples.
   */
  reset(): void;
}

// ============================================================================
// Stream Association Strategy Interfaces
// ============================================================================

/**
 * Strategy for associating HTTP/2 streams with package downloads
 */
export interface IStreamAssociationStrategy {
  /**
   * Attempts to associate a stream with a package.
   * Called by IStreamTracker when new streams arrive.
   *
   * @param streamId Stream to associate
   * @param streamInfo Stream information
   * @param activeDownloads Currently active downloads
   * @param existingAssociations Current stream-to-package mappings
   * @returns Package name if association made, undefined otherwise
   */
  associateStream(
    streamId: string,
    streamInfo: IHttpStream,
    activeDownloads: IDownload[],
    existingAssociations: Map<string, string>
  ): string | undefined;

  /**
   * Validates an existing association.
   * Called by IStreamTracker to verify associations are still valid.
   *
   * @param streamId Stream ID
   * @param packageName Associated package
   * @param streamInfo Current stream info
   * @param downloadInfo Current download info
   * @returns true if association is valid
   */
  validateAssociation(streamId: string, packageName: string, streamInfo: IHttpStream, downloadInfo: IDownload): boolean;

  /**
   * Gets confidence score for an association.
   * Used to pick best association when multiple options exist.
   *
   * @param streamInfo Stream information
   * @param downloadInfo Download information
   * @returns Confidence score (0-1)
   */
  getConfidenceScore(streamInfo: IHttpStream, downloadInfo: IDownload): number;
}

// ============================================================================
// Event Processing Interfaces (Decomposed from StateAggregator)
// ============================================================================

/**
 * Processes log events and updates relevant components.
 * This is a decomposition of StateAggregator's event processing logic.
 *
 * Interactions:
 * - Receives events from ILineParser
 * - Updates IPhaseManager, IPackageRegistry, IDownloadManager, IStreamTracker
 * - Notifies IErrorCollector of errors
 * - Triggers IMetricsCollector updates
 */
export interface IEventProcessor {
  /**
   * Processes a parsed log event.
   * Main entry point called by IUvParser for each parsed line.
   *
   * @param event Event to process
   * @returns true if event caused state changes
   */
  processEvent(event: ILogEvent): boolean;

  /**
   * Registers a component to be updated.
   * Called during initialization to wire up components.
   *
   * @param componentType Type of component
   * @param component Component instance
   */
  registerComponent(componentType: string, component: unknown): void;

  /**
   * Gets the last processed event.
   * Used for debugging and state reconstruction.
   *
   * @returns Last event or undefined
   */
  getLastEvent(): ILogEvent | undefined;

  /**
   * Resets the processor.
   */
  reset(): void;
}

// ============================================================================
// State Building Interfaces (Decomposed from StateAggregator)
// ============================================================================

/**
 * Builds the unified installation state from all components.
 * This is a decomposition of StateAggregator's state building logic.
 *
 * Interactions:
 * - Queries IPhaseManager for current phase
 * - Queries IPackageRegistry for package statistics
 * - Queries IDownloadManager for active downloads
 * - Queries IErrorCollector for errors
 * - Queries IMetricsCollector for timing
 * - Queries IProgressTracker for overall progress
 */
export interface IStateBuilder {
  /**
   * Builds the current installation state.
   * Called after event processing to get current state.
   *
   * @returns Current installation state
   */
  buildState(): IInstallationState;

  /**
   * Registers a data source.
   * Called during initialization to wire up components.
   *
   * @param sourceType Type of source
   * @param source Source instance
   */
  registerDataSource(sourceType: string, source: unknown): void;

  /**
   * Generates a human-readable status message.
   * Used by IEventDispatcher for user-facing messages.
   *
   * @param state Current state
   * @returns Status message
   */
  generateStatusMessage(state: IInstallationState): string;

  /**
   * Checks if installation is complete.
   * Used to trigger completion events.
   *
   * @param state Current state
   * @returns true if complete (success or failure)
   */
  isComplete(state: IInstallationState): boolean;
}

// ============================================================================
// Progress Tracking Interfaces (Decomposed from StateAggregator)
// ============================================================================

/**
 * Tracks overall installation progress across all phases.
 * This is a decomposition of StateAggregator's progress calculation logic.
 *
 * Interactions:
 * - Uses IPhaseManager to know current phase
 * - Uses IPackageRegistry for package counts
 * - Uses IDownloadManager for download progress
 * - Provides progress to IStateBuilder
 */
export interface IProgressTracker {
  /**
   * Calculates overall installation progress.
   * Called by IStateBuilder when building state.
   *
   * @returns Progress percentage (0-100)
   */
  calculateOverallProgress(): number;

  /**
   * Calculates progress for current phase.
   * Used to show phase-specific progress.
   *
   * @param phase Current phase
   * @returns Phase progress percentage (0-100)
   */
  calculatePhaseProgress(phase: InstallationPhase): number;

  /**
   * Updates progress based on a state change.
   * Called after event processing.
   */
  updateProgress(): void;

  /**
   * Gets progress breakdown by phase.
   * Used for detailed progress reporting.
   *
   * @returns Map of phase to progress percentage
   */
  getProgressBreakdown(): Map<InstallationPhase, number>;

  /**
   * Estimates time to completion.
   * Uses historical data and current progress.
   *
   * @returns Estimated seconds to completion
   */
  estimateTimeToCompletion(): number | undefined;

  /**
   * Resets progress tracking.
   */
  reset(): void;
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export type { IInstallationState } from './architecture';
