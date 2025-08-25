/**
 * Minimal EventDispatcher Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the IEventDispatcher interface
 * that dispatches UV installation events with intelligent throttling to prevent spam.
 */
import type { IInstallationState } from '../architecture';

/**
 * Configuration interface for the EventDispatcher
 */
export interface IEventDispatcherConfig {
  /** Minimum time between progress updates in milliseconds (default: 100ms) */
  progressThrottleMs?: number;
  /** Minimum progress change percentage to emit (default: 5%) */
  progressThresholdPercent?: number;
  /** Whether to emit debug events (default: false) */
  emitDebugEvents?: boolean;
}

/**
 * Extended EventDispatcher interface with configuration support
 */
export interface IEventDispatcher {
  processStateChange(newState: IInstallationState, forceEmit?: boolean): void;
  onStatusChange(listener: (state: IInstallationState) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onComplete(listener: (success: boolean) => void): () => void;
  updateConfig(config: IEventDispatcherConfig): void;
  removeAllListeners(): void;
}

/**
 * Dispatches meaningful status change events with intelligent throttling.
 * Prevents event spam while ensuring critical changes are immediately reported.
 */
export class EventDispatcher implements IEventDispatcher {
  /** Configuration for throttling and event emission */
  private config: Required<IEventDispatcherConfig> = {
    progressThrottleMs: 100,
    progressThresholdPercent: 5,
    emitDebugEvents: false,
  };

  /** Registered listeners for status changes */
  private readonly statusListeners: Array<(state: IInstallationState) => void> = [];

  /** Registered listeners for errors */
  private readonly errorListeners: Array<(error: Error) => void> = [];

  /** Registered listeners for completion */
  private readonly completeListeners: Array<(success: boolean) => void> = [];

  /** Last emitted state for comparison */
  private lastEmittedState?: IInstallationState;

  /** Timestamp of last emission */
  private lastEmitTime: number = 0;

  /**
   * Processes a state change and emits events if needed.
   * Applies intelligent throttling based on the significance of the change.
   *
   * @param newState New installation state
   * @param forceEmit Whether to force emit regardless of throttling
   */
  processStateChange(newState: IInstallationState, forceEmit = false): void {
    const now = Date.now();
    const timeSinceLastEmit = now - this.lastEmitTime;

    // Always emit for significant changes
    if (this.shouldEmitForSignificantChange(newState, timeSinceLastEmit) || forceEmit) {
      this.emitStatusChange(newState);
      this.lastEmittedState = this.deepClone(newState);
      this.lastEmitTime = now;

      // Emit error event if state contains an error
      if (newState.error && !this.lastEmittedState?.error) {
        this.emitError(new Error(newState.error.message));
      }

      // Emit completion event if installation is complete
      if (newState.isComplete && !this.lastEmittedState?.isComplete) {
        const success = newState.phase === 'installed' && !newState.error;
        this.emitComplete(success);
      }
    }
  }

  /**
   * Registers a listener for status changes.
   *
   * @param listener Callback function for status changes
   * @returns Unsubscribe function
   */
  onStatusChange(listener: (state: IInstallationState) => void): () => void {
    this.statusListeners.push(listener);

    return () => {
      const index = this.statusListeners.indexOf(listener);
      if (index !== -1) {
        this.statusListeners.splice(index, 1);
      }
    };
  }

  /**
   * Registers a listener for errors.
   *
   * @param listener Callback function for errors
   * @returns Unsubscribe function
   */
  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.push(listener);

    return () => {
      const index = this.errorListeners.indexOf(listener);
      if (index !== -1) {
        this.errorListeners.splice(index, 1);
      }
    };
  }

  /**
   * Registers a listener for completion.
   *
   * @param listener Callback function for completion
   * @returns Unsubscribe function
   */
  onComplete(listener: (success: boolean) => void): () => void {
    this.completeListeners.push(listener);

    return () => {
      const index = this.completeListeners.indexOf(listener);
      if (index !== -1) {
        this.completeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Updates the configuration for event dispatching.
   *
   * @param config New configuration values
   */
  updateConfig(config: IEventDispatcherConfig): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Removes all registered listeners.
   */
  removeAllListeners(): void {
    this.statusListeners.length = 0;
    this.errorListeners.length = 0;
    this.completeListeners.length = 0;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Determines if a state change is significant enough to emit immediately.
   * Checks for phase changes, errors, completion, and significant progress.
   */
  private shouldEmitForSignificantChange(newState: IInstallationState, timeSinceLastEmit: number): boolean {
    // Always emit on first state
    if (!this.lastEmittedState) {
      return true;
    }

    // Always emit on phase changes
    if (newState.phase !== this.lastEmittedState.phase) {
      return true;
    }

    // Always emit on errors
    if (newState.error && !this.lastEmittedState.error) {
      return true;
    }

    // Always emit on completion
    if (newState.isComplete && !this.lastEmittedState.isComplete) {
      return true;
    }

    // Emit on significant progress changes if enough time has passed
    if (timeSinceLastEmit >= this.config.progressThrottleMs) {
      const progressChange = Math.abs(newState.overallProgress - this.lastEmittedState.overallProgress);
      if (progressChange >= this.config.progressThresholdPercent) {
        return true;
      }
    }

    // Emit if package counts changed significantly
    if (this.hasSignificantPackageCountChange(newState)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if package counts have changed significantly.
   */
  private hasSignificantPackageCountChange(newState: IInstallationState): boolean {
    if (!this.lastEmittedState) {
      return true;
    }

    const lastPkgs = this.lastEmittedState.packages;
    const newPkgs = newState.packages;

    return (
      lastPkgs.total !== newPkgs.total ||
      lastPkgs.resolved !== newPkgs.resolved ||
      lastPkgs.downloaded !== newPkgs.downloaded ||
      lastPkgs.installed !== newPkgs.installed
    );
  }

  /**
   * Emits a status change event to all registered listeners.
   */
  private emitStatusChange(state: IInstallationState): void {
    // Create a copy to prevent external modification
    const stateCopy = this.deepClone(state);

    for (const listener of this.statusListeners) {
      try {
        listener(stateCopy);
      } catch (error) {
        // Log error but don't let it break other listeners
        if (this.config.emitDebugEvents) {
          console.warn('EventDispatcher: Error in status change listener:', error);
        }
      }
    }
  }

  /**
   * Emits an error event to all registered listeners.
   */
  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        // Log error but don't let it break other listeners
        if (this.config.emitDebugEvents) {
          console.warn('EventDispatcher: Error in error listener:', listenerError);
        }
      }
    }
  }

  /**
   * Emits a completion event to all registered listeners.
   */
  private emitComplete(success: boolean): void {
    for (const listener of this.completeListeners) {
      try {
        listener(success);
      } catch (error) {
        // Log error but don't let it break other listeners
        if (this.config.emitDebugEvents) {
          console.warn('EventDispatcher: Error in completion listener:', error);
        }
      }
    }
  }

  /**
   * Creates a deep clone of an object to prevent external modification.
   */
  private deepClone<T>(obj: T): T {
    return structuredClone(obj);
  }
}
