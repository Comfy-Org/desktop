/**
 * Minimal UvParser Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the IUvParser interface
 * that acts as the main orchestrator tying all components together.
 * It processes UV log lines through a pipeline of components and emits events.
 */
import type { IInstallationState, IUvParser } from '../architecture';
import type { IEventProcessor, IStateBuilder } from '../architecture-extended';
import { DownloadManager } from './DownloadManager';
import { EventDispatcher } from './EventDispatcher';
import { EventProcessor } from './EventProcessor';
// Import concrete implementations
import { LineParser } from './LineParser';
import { PackageRegistry } from './PackageRegistry';
import { PhaseManager } from './PhaseManager';
import { StateBuilder } from './StateBuilder';

/**
 * Main UV parser orchestrator that coordinates all components.
 * This orchestrates the complete parsing pipeline from raw log lines to state events.
 */
export class UvParser implements IUvParser {
  // Core processing components
  private readonly lineParser: LineParser;
  private readonly eventProcessor: IEventProcessor;
  private readonly stateBuilder: IStateBuilder;
  private readonly eventDispatcher: EventDispatcher;

  // State management components
  private readonly phaseManager: PhaseManager;
  private readonly packageRegistry: PackageRegistry;
  private readonly downloadManager: DownloadManager;

  /**
   * Creates a new UvParser instance with all components wired together.
   */
  constructor() {
    // Initialize components
    this.lineParser = new LineParser();
    this.phaseManager = new PhaseManager();
    this.packageRegistry = new PackageRegistry();
    this.downloadManager = new DownloadManager();
    this.eventProcessor = new EventProcessor();
    this.stateBuilder = new StateBuilder();
    this.eventDispatcher = new EventDispatcher();

    // Wire up event processor with components
    this.eventProcessor.registerComponent('phaseManager', this.phaseManager);
    this.eventProcessor.registerComponent('packageRegistry', this.packageRegistry);
    this.eventProcessor.registerComponent('downloadManager', this.downloadManager);

    // Wire up state builder with data sources
    this.stateBuilder.registerDataSource('phaseManager', this.phaseManager);
    this.stateBuilder.registerDataSource('packageRegistry', this.packageRegistry);
    this.stateBuilder.registerDataSource('downloadManager', this.downloadManager);
  }

  /**
   * Processes a line of UV output through the complete pipeline.
   *
   * Pipeline: Line → Event → Process Event → Build State → Maybe Emit Event
   *
   * @param line Raw log line from UV process
   */
  processLine(line: string): void {
    try {
      // Step 1: Parse line into structured event
      const event = this.lineParser.parseLine(line);
      if (!event) {
        // Line was ignored (empty, informational, etc.)
        return;
      }

      // Step 2: Process event through components
      const hasStateChanges = this.eventProcessor.processEvent(event);
      if (!hasStateChanges) {
        // Event didn't change state significantly
        return;
      }

      // Step 3: Build current installation state
      const newState = this.stateBuilder.buildState();

      // Step 4: Dispatch events if state changed meaningfully
      this.eventDispatcher.processStateChange(newState);
    } catch (error) {
      // Handle processing errors gracefully - don't let one bad line crash the parser
      console.error('UvParser: Error processing line', { line, error });

      // Try to emit an error event if possible
      try {
        const errorState = this.buildErrorState(error as Error);
        this.eventDispatcher.processStateChange(errorState, true);
      } catch {
        // If even error handling fails, log and continue
        console.error('UvParser: Failed to emit error event');
      }
    }
  }

  /**
   * Gets the current installation state.
   * This provides a snapshot of the current state without processing events.
   *
   * @returns Current installation state
   */
  getState(): IInstallationState {
    try {
      return this.stateBuilder.buildState();
    } catch (error) {
      // If state building fails, return a basic error state
      console.error('UvParser: Error building state', error);
      return this.buildErrorState(error as Error);
    }
  }

  /**
   * Registers a status change listener.
   * Delegates to EventDispatcher for listener management.
   *
   * @param listener Callback for status changes
   * @returns Unsubscribe function
   */
  onStatusChange(listener: (state: IInstallationState) => void): () => void {
    return this.eventDispatcher.onStatusChange(listener);
  }

  /**
   * Registers an error listener.
   * Delegates to EventDispatcher for listener management.
   *
   * @param listener Callback for errors
   * @returns Unsubscribe function
   */
  onError(listener: (error: Error) => void): () => void {
    return this.eventDispatcher.onError(listener);
  }

  /**
   * Registers a completion listener.
   * Delegates to EventDispatcher for listener management.
   *
   * @param listener Callback for completion
   * @returns Unsubscribe function
   */
  onComplete(listener: (success: boolean) => void): () => void {
    return this.eventDispatcher.onComplete(listener);
  }

  /**
   * Resets the parser to initial state.
   * Clears all components and restores to idle state.
   */
  reset(): void {
    try {
      // Reset all components to initial state
      this.phaseManager.reset();
      this.packageRegistry.reset();
      this.downloadManager.reset();
      this.eventProcessor.reset();

      // Clear event dispatcher state
      this.eventDispatcher.removeAllListeners();

      // Emit reset state to any remaining listeners
      const resetState = this.stateBuilder.buildState();
      this.eventDispatcher.processStateChange(resetState, true);
    } catch (error) {
      console.error('UvParser: Error during reset', error);
    }
  }

  /**
   * Performs cleanup operations.
   * Removes old downloads, completed streams, etc.
   */
  cleanup(): void {
    try {
      // Clean up old downloads (keep last 10 minutes)
      const maxAge = 10 * 60 * 1000; // 10 minutes in milliseconds
      this.downloadManager.cleanupOldDownloads(maxAge);

      // Note: StreamTracker and ProgressCalculator cleanup would go here
      // when they're implemented in future iterations
    } catch (error) {
      console.error('UvParser: Error during cleanup', error);
    }
  }

  /**
   * Gets a specific component for advanced usage.
   * Provides access to individual components for testing or specialized use cases.
   *
   * @param component Component name
   * @returns Component instance
   */
  getComponent<T>(
    component: 'phaseManager' | 'packageRegistry' | 'downloadManager' | 'streamTracker' | 'progressCalculator'
  ): T {
    switch (component) {
      case 'phaseManager':
        return this.phaseManager as T;
      case 'packageRegistry':
        return this.packageRegistry as T;
      case 'downloadManager':
        return this.downloadManager as T;
      case 'streamTracker':
        // For minimal implementation, return null - will be implemented in future
        return null as T;
      case 'progressCalculator':
        // For minimal implementation, return null - will be implemented in future
        return null as T;
      default:
        throw new Error(`Unknown component: ${component}`);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Builds an error state when something goes wrong during processing.
   *
   * @param error The error that occurred
   * @returns Error installation state
   */
  private buildErrorState(error: Error): IInstallationState {
    const currentPhase = this.phaseManager.getCurrentPhase();
    const phaseHistory = this.phaseManager.getPhaseHistory();
    const packageStats = this.packageRegistry.getStatistics();

    return {
      phase: 'error',
      phaseHistory: [...phaseHistory, 'error'],
      message: `Installation failed: ${error.message}`,
      packages: {
        total: packageStats.total,
        resolved: packageStats.total - packageStats.pending,
        downloaded: packageStats.downloaded,
        installed: packageStats.installed,
      },
      overallProgress: 0,
      isComplete: true,
      error: {
        message: error.message,
        phase: currentPhase,
        timestamp: Date.now(),
      },
      timing: {
        startTime: Date.now(),
        endTime: Date.now(),
        phaseDurations: {},
      },
    };
  }
}
