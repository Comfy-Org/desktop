/**
 * Minimal ParserFactory Implementation for UV Parser V2
 *
 * This is a production-ready, minimal concrete factory for creating UV parser instances
 * with dependency injection. It creates and wires all required components together
 * to provide a ready-to-use IUvParser instance.
 */
import type { IInstallationState, IUvParser } from '../architecture';
import { DownloadManager } from './DownloadManager';
import { EventDispatcher, type IEventDispatcherConfig } from './EventDispatcher';
import { EventProcessor } from './EventProcessor';
import { LineParser } from './LineParser';
import { PackageRegistry } from './PackageRegistry';
import { PhaseManager } from './PhaseManager';
import { StateBuilder } from './StateBuilder';

/**
 * Configuration options for the UV parser factory
 */
export interface IParserFactoryConfig {
  /** Minimum time between progress updates in milliseconds (default: 100ms) */
  progressThrottleMs?: number;
  /** Minimum progress change percentage to emit (default: 5%) */
  progressThresholdPercent?: number;
  /** Whether to emit debug events (default: false) */
  emitDebugEvents?: boolean;
}

/**
 * Factory for creating fully configured UV parser instances.
 *
 * This factory handles all the complexity of creating and wiring components:
 * - Creates instances of all required implementation classes
 * - Wires components together through proper registration
 * - Configures EventDispatcher with sensible defaults
 * - Returns a ready-to-use IUvParser instance
 */
export class ParserFactory {
  /**
   * Creates a fully configured UV parser instance.
   *
   * This method:
   * 1. Creates instances of all required components
   * 2. Wires EventProcessor with components for event handling
   * 3. Wires StateBuilder with data sources for state building
   * 4. Configures EventDispatcher with provided settings
   * 5. Returns the configured UvParser ready for use
   *
   * @param config Optional configuration for event dispatching
   * @returns Ready-to-use IUvParser instance
   */
  createParser(config?: IParserFactoryConfig): IUvParser {
    // Step 1: Create all component instances
    const lineParser = new LineParser();
    const phaseManager = new PhaseManager();
    const packageRegistry = new PackageRegistry();
    const downloadManager = new DownloadManager();
    const eventProcessor = new EventProcessor();
    const stateBuilder = new StateBuilder();
    const eventDispatcher = new EventDispatcher();

    // Step 2: Wire EventProcessor with components for event handling
    // EventProcessor needs these components to update state based on parsed events
    eventProcessor.registerComponent('phaseManager', phaseManager);
    eventProcessor.registerComponent('packageRegistry', packageRegistry);
    eventProcessor.registerComponent('downloadManager', downloadManager);

    // Step 3: Wire StateBuilder with data sources for state aggregation
    // StateBuilder queries these components to build the unified installation state
    stateBuilder.registerDataSource('phaseManager', phaseManager);
    stateBuilder.registerDataSource('packageRegistry', packageRegistry);
    stateBuilder.registerDataSource('downloadManager', downloadManager);

    // Step 4: Configure EventDispatcher with provided settings
    if (config) {
      const dispatcherConfig: IEventDispatcherConfig = {
        progressThrottleMs: config.progressThrottleMs,
        progressThresholdPercent: config.progressThresholdPercent,
        emitDebugEvents: config.emitDebugEvents,
      };
      eventDispatcher.updateConfig(dispatcherConfig);
    }

    // Step 5: Create and return the main UvParser orchestrator
    // UvParser creates its own instances internally, but we need to replace them
    // with our pre-configured instances. Since UvParser constructor doesn't take
    // parameters, we'll create a custom wired instance.
    return new WiredUvParser(
      lineParser,
      eventProcessor,
      stateBuilder,
      eventDispatcher,
      phaseManager,
      packageRegistry,
      downloadManager
    );
  }
}

/**
 * Custom UvParser implementation that accepts pre-wired components.
 * This allows us to inject configured dependencies instead of creating new ones.
 */
class WiredUvParser implements IUvParser {
  constructor(
    private readonly lineParser: LineParser,
    private readonly eventProcessor: EventProcessor,
    private readonly stateBuilder: StateBuilder,
    private readonly eventDispatcher: EventDispatcher,
    private readonly phaseManager: PhaseManager,
    private readonly packageRegistry: PackageRegistry,
    private readonly downloadManager: DownloadManager
  ) {}

  /**
   * Processes a line of UV output through the complete pipeline.
   * Pipeline: Line → Event → Process Event → Build State → Maybe Emit Event
   */
  processLine(line: string): void {
    try {
      // Step 1: Parse line into structured event
      const event = this.lineParser.parseLine(line);
      if (!event) {
        return; // Line was ignored
      }

      // Step 2: Process event through components
      const hasStateChanges = this.eventProcessor.processEvent(event);
      if (!hasStateChanges) {
        return; // Event didn't change state significantly
      }

      // Step 3: Build current installation state
      const newState = this.stateBuilder.buildState();

      // Step 4: Dispatch events if state changed meaningfully
      this.eventDispatcher.processStateChange(newState);
    } catch (error) {
      // Handle processing errors gracefully
      console.error('ParserFactory.WiredUvParser: Error processing line', { line, error });

      try {
        const errorState = this.buildErrorState(error as Error);
        this.eventDispatcher.processStateChange(errorState, true);
      } catch {
        console.error('ParserFactory.WiredUvParser: Failed to emit error event');
      }
    }
  }

  /**
   * Gets the current installation state.
   */
  getState() {
    try {
      return this.stateBuilder.buildState();
    } catch (error) {
      console.error('ParserFactory.WiredUvParser: Error building state', error);
      return this.buildErrorState(error as Error);
    }
  }

  /**
   * Registers a status change listener.
   */
  onStatusChange(listener: (state: IInstallationState) => void): () => void {
    return this.eventDispatcher.onStatusChange(listener);
  }

  /**
   * Registers an error listener.
   */
  onError(listener: (error: Error) => void): () => void {
    return this.eventDispatcher.onError(listener);
  }

  /**
   * Registers a completion listener.
   */
  onComplete(listener: (success: boolean) => void): () => void {
    return this.eventDispatcher.onComplete(listener);
  }

  /**
   * Resets the parser to initial state.
   */
  reset(): void {
    try {
      this.phaseManager.reset();
      this.packageRegistry.reset();
      this.downloadManager.reset();
      this.eventProcessor.reset();
      this.eventDispatcher.removeAllListeners();

      const resetState = this.stateBuilder.buildState();
      this.eventDispatcher.processStateChange(resetState, true);
    } catch (error) {
      console.error('ParserFactory.WiredUvParser: Error during reset', error);
    }
  }

  /**
   * Performs cleanup operations.
   */
  cleanup(): void {
    try {
      const maxAge = 10 * 60 * 1000; // 10 minutes
      this.downloadManager.cleanupOldDownloads(maxAge);
    } catch (error) {
      console.error('ParserFactory.WiredUvParser: Error during cleanup', error);
    }
  }

  /**
   * Gets a specific component for advanced usage.
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
        return null as T; // Not implemented in minimal version
      case 'progressCalculator':
        return null as T; // Not implemented in minimal version
      default:
        throw new Error(`Unknown component: ${component}`);
    }
  }

  /**
   * Builds an error state when something goes wrong.
   */
  private buildErrorState(error: Error) {
    const currentPhase = this.phaseManager.getCurrentPhase();
    const phaseHistory = this.phaseManager.getPhaseHistory();
    const packageStats = this.packageRegistry.getStatistics();

    return {
      phase: 'error' as const,
      phaseHistory: [...phaseHistory, 'error' as const],
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
