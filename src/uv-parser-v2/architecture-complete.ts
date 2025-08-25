/**
 * UV Parser V2 - Complete Architecture Overview
 *
 * This file shows how all interfaces work together to create a complete system.
 * Each interface documents its interactions with other components inline.
 */
import type {
  IDownloadManager,
  IEventDispatcher,
  ILineParser,
  IPackageRegistry,
  IPhaseManager,
  IProgressCalculator,
  IStreamTracker,
} from './architecture';
import type {
  IErrorCollector,
  IEventProcessor,
  IMetricsCollector,
  IProgressTracker,
  IStateBuilder,
  IStreamAssociationStrategy,
  ITransferRateTracker,
} from './architecture-extended';
import type { InstallationEvent, InstallationSnapshot } from './data-models';

// ============================================================================
// Complete System Architecture
// ============================================================================

/**
 * The complete UV Parser system with all components properly composed.
 * This interface shows how all the granular components work together.
 *
 * COMPONENT INTERACTION FLOW:
 *
 * 1. Raw log line arrives from UV process
 * 2. ILineParser converts it to ILogEvent
 * 3. IEventProcessor receives the event and:
 *    - Updates IPhaseManager if phase change needed
 *    - Updates IPackageRegistry for package events
 *    - Updates IDownloadManager for download events
 *    - Updates IStreamTracker for HTTP/2 events
 *    - Notifies IErrorCollector for errors
 *    - Triggers IMetricsCollector updates
 * 4. IStateBuilder queries all components to build state
 * 5. IProgressTracker calculates overall progress
 * 6. IEventDispatcher checks if state change is significant
 * 7. If significant, event is emitted to UI/consumers
 */
export interface ICompleteUvParser {
  // ==================== Core Components ====================

  /**
   * Parses raw log lines into structured events.
   *
   * RECEIVES: Raw string lines from UV process stdout/stderr
   * PRODUCES: ILogEvent objects
   * SENDS TO: IEventProcessor.processEvent()
   */
  readonly lineParser: ILineParser;

  /**
   * Processes events and updates all relevant components.
   *
   * RECEIVES: ILogEvent from ILineParser
   * UPDATES: All state management components based on event type
   * NOTIFIES: IStateBuilder when state may have changed
   */
  readonly eventProcessor: IEventProcessor;

  // ==================== State Management Components ====================

  /**
   * Manages installation phase transitions.
   *
   * UPDATED BY: IEventProcessor on phase-related events
   * NOTIFIES: IMetricsCollector on phase changes
   * QUERIED BY: IStateBuilder, IProgressTracker
   */
  readonly phaseManager: IPhaseManager;

  /**
   * Central registry for all packages.
   *
   * UPDATED BY: IEventProcessor on package discovery/status changes
   * QUERIED BY: IStateBuilder for package statistics
   * QUERIED BY: IProgressTracker for progress calculation
   * ASSOCIATES WITH: IDownloadManager for download status
   */
  readonly packageRegistry: IPackageRegistry;

  /**
   * Manages individual package downloads.
   *
   * UPDATED BY: IEventProcessor on download events
   * NOTIFIES: ITransferRateTracker with rate samples
   * ASSOCIATES WITH: IStreamTracker for HTTP/2 streams
   * QUERIED BY: IStateBuilder, IProgressTracker
   */
  readonly downloadManager: IDownloadManager;

  /**
   * Tracks HTTP/2 streams and associations.
   *
   * UPDATED BY: IEventProcessor on HTTP/2 frame events
   * USES: IStreamAssociationStrategy to match streams to downloads
   * NOTIFIES: IDownloadManager of stream associations
   * PROVIDES: Frame counts to IProgressCalculator
   */
  readonly streamTracker: IStreamTracker;

  // ==================== Error and Metrics Components ====================

  /**
   * Collects and manages errors.
   *
   * UPDATED BY: IEventProcessor on error events
   * QUERIED BY: IStateBuilder for error information
   * QUERIED BY: IProgressTracker to determine if failed
   * NOTIFIES: IEventDispatcher of critical errors
   */
  readonly errorCollector: IErrorCollector;

  /**
   * Collects timing and performance metrics.
   *
   * UPDATED BY: IPhaseManager on phase transitions
   * UPDATED BY: IEventProcessor on countable operations
   * QUERIED BY: IStateBuilder for timing information
   * PROVIDES: Historical data to IProgressCalculator for ETAs
   */
  readonly metricsCollector: IMetricsCollector;

  /**
   * Tracks transfer rates over time.
   *
   * UPDATED BY: IDownloadManager with rate samples
   * QUERIED BY: IProgressCalculator for rate calculations
   * QUERIED BY: IStateBuilder for current rates
   * PROVIDES: Rate history for ETA calculations
   */
  readonly transferRateTracker: ITransferRateTracker;

  // ==================== Calculation Components ====================

  /**
   * Calculates download progress and ETAs.
   *
   * USES: IDownloadManager for download info
   * USES: IStreamTracker for frame counts
   * USES: ITransferRateTracker for rate history
   * USES: IMetricsCollector for historical timing
   * PROVIDES: Progress calculations to IStateBuilder
   */
  readonly progressCalculator: IProgressCalculator;

  /**
   * Tracks overall installation progress.
   *
   * USES: IPhaseManager for current phase
   * USES: IPackageRegistry for package counts
   * USES: IDownloadManager for download progress
   * USES: IMetricsCollector for phase timing
   * PROVIDES: Overall progress to IStateBuilder
   */
  readonly progressTracker: IProgressTracker;

  // ==================== State Building and Events ====================

  /**
   * Builds unified state from all components.
   *
   * QUERIES: All state management components
   * USES: IProgressTracker for overall progress
   * USES: IProgressCalculator for detailed progress
   * PRODUCES: InstallationSnapshot
   * SENDS TO: IEventDispatcher
   */
  readonly stateBuilder: IStateBuilder;

  /**
   * Dispatches events with intelligent throttling.
   *
   * RECEIVES: InstallationSnapshot from IStateBuilder
   * EVALUATES: Whether change is significant
   * THROTTLES: Based on time and progress thresholds
   * EMITS: InstallationEvent to consumers
   */
  readonly eventDispatcher: IEventDispatcher;

  // ==================== Strategy Components ====================

  /**
   * Strategy for associating streams with downloads.
   *
   * USED BY: IStreamTracker when new streams arrive
   * ANALYZES: Timing, size, and order heuristics
   * RETURNS: Best package match with confidence score
   */
  readonly associationStrategy: IStreamAssociationStrategy;

  // ==================== Main Interface Methods ====================

  /**
   * Processes a line of UV output through the entire pipeline.
   *
   * FLOW:
   * 1. LineParser.parseLine() → ILogEvent
   * 2. EventProcessor.processEvent() → Updates components
   * 3. StateBuilder.buildState() → InstallationSnapshot
   * 4. EventDispatcher.processStateChange() → Maybe emit event
   *
   * @param line Raw log line from UV process
   */
  processLine(line: string): void;

  /**
   * Gets the current installation state.
   *
   * FLOW:
   * 1. StateBuilder queries all components
   * 2. ProgressTracker calculates progress
   * 3. Returns complete InstallationSnapshot
   *
   * @returns Current state snapshot
   */
  getState(): InstallationSnapshot;

  /**
   * Registers a listener for installation events.
   *
   * @param listener Callback for events
   * @returns Unsubscribe function
   */
  onEvent(listener: (event: InstallationEvent) => void): () => void;

  /**
   * Performs cleanup of old data.
   *
   * TRIGGERS:
   * - DownloadManager.cleanupOldDownloads()
   * - StreamTracker.cleanupCompletedStreams()
   * - TransferRateTracker.cleanupOldSamples()
   */
  cleanup(): void;

  /**
   * Resets all components to initial state.
   *
   * TRIGGERS: reset() on all components
   */
  reset(): void;
}

// ============================================================================
// Factory with Dependency Injection
// ============================================================================

/**
 * Factory that creates and wires up all components.
 * Handles the complex dependency injection and component wiring.
 */
export interface ICompleteParserFactory {
  /**
   * Creates a fully configured parser with all components wired up.
   *
   * DEPENDENCY INJECTION FLOW:
   *
   * 1. Create all components
   * 2. Wire bidirectional dependencies:
   *    - EventProcessor ← All updatable components
   *    - StateBuilder ← All queryable components
   *    - Components ← Their validators
   * 3. Register event listeners between components
   * 4. Return configured parser
   *
   * @param config Configuration options
   * @returns Fully configured parser
   */
  createCompleteParser(config?: ICompleteParserConfig): ICompleteUvParser;

  /**
   * Creates components with custom implementations.
   * Allows overriding specific components for testing.
   *
   * @param overrides Custom component implementations
   * @returns Components with overrides applied
   */
  createWithOverrides(overrides: Partial<ComponentOverrides>): ICompleteUvParser;
}

/**
 * Configuration for the complete parser
 */
export interface ICompleteParserConfig {
  /** Event throttling configuration */
  eventThrottling?: {
    /** Minimum time between events (ms) */
    minInterval?: number;
    /** Minimum progress change (%) */
    minProgressChange?: number;
  };

  /** Memory management configuration */
  memoryManagement?: {
    /** Max downloads to track */
    maxDownloads?: number;
    /** Max age for completed items (ms) */
    maxAge?: number;
    /** Cleanup interval (ms) */
    cleanupInterval?: number;
  };

  /** Debug configuration */
  debug?: {
    /** Enable debug logging */
    enabled?: boolean;
    /** Log all events */
    logAllEvents?: boolean;
    /** Log component interactions */
    logInteractions?: boolean;
  };
}

/**
 * Allows overriding specific component implementations
 */
export interface ComponentOverrides {
  lineParser?: ILineParser;
  eventProcessor?: IEventProcessor;
  phaseManager?: IPhaseManager;
  packageRegistry?: IPackageRegistry;
  downloadManager?: IDownloadManager;
  streamTracker?: IStreamTracker;
  errorCollector?: IErrorCollector;
  metricsCollector?: IMetricsCollector;
  transferRateTracker?: ITransferRateTracker;
  progressCalculator?: IProgressCalculator;
  progressTracker?: IProgressTracker;
  stateBuilder?: IStateBuilder;
  eventDispatcher?: IEventDispatcher;
  associationStrategy?: IStreamAssociationStrategy;
}

// ============================================================================
// System Composition Example
// ============================================================================

/**
 * Example of how the complete system is composed and used:
 *
 * ```typescript
 * // Create the parser with all components
 * const factory = new CompleteParserFactory();
 * const parser = factory.createCompleteParser({
 *   eventThrottling: {
 *     minInterval: 100,
 *     minProgressChange: 5
 *   },
 *   memoryManagement: {
 *     maxDownloads: 100,
 *     maxAge: 300000
 *   }
 * });
 *
 * // Register event listener
 * parser.onEvent((event) => {
 *   if (event.type === 'progress_update') {
 *     console.log(`Progress: ${event.data.progress.overall}%`);
 *   }
 * });
 *
 * // Process UV output
 * uvProcess.stdout.on('data', (chunk) => {
 *   const lines = chunk.toString().split('\\n');
 *   lines.forEach(line => parser.processLine(line));
 * });
 *
 * // Periodic cleanup
 * setInterval(() => parser.cleanup(), 60000);
 * ```
 */
export const COMPOSITION_EXAMPLE = true;
