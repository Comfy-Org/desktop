/**
 * Minimal PhaseManager Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the IPhaseManager interface
 * that manages the UV installation phase state machine with proper transition validation.
 */
import type { IPhaseManager, InstallationPhase } from '../architecture';

/**
 * Manages the installation phase state machine.
 * Ensures valid phase transitions and tracks phase history with timestamps.
 */
export class PhaseManager implements IPhaseManager {
  /** Current installation phase */
  private currentPhase: InstallationPhase = 'idle';

  /** Complete phase history */
  private phaseHistory: InstallationPhase[] = ['idle'];

  /** Timestamps for when each phase was entered */
  private readonly phaseTimestamps: Map<InstallationPhase, number> = new Map([['idle', Date.now()]]);

  /**
   * Valid phase transition rules.
   * Each phase maps to an array of valid target phases.
   */
  private readonly transitionRules: Record<InstallationPhase, InstallationPhase[]> = {
    idle: ['started'],
    started: ['reading_requirements', 'error'],
    reading_requirements: ['resolving', 'error'],
    resolving: ['resolved', 'error'],
    resolved: ['preparing_download', 'error'],
    preparing_download: ['downloading', 'error'],
    downloading: ['preparing_download', 'prepared', 'error'],
    prepared: ['installing', 'error'],
    installing: ['installed', 'error'],
    installed: ['error'], // Can error even after successful installation
    error: [], // Error is terminal - use reset() to recover
  } as const;

  /**
   * Gets the current installation phase.
   * @returns Current phase
   */
  getCurrentPhase(): InstallationPhase {
    return this.currentPhase;
  }

  /**
   * Gets the complete phase history.
   * @returns Array of all phases in chronological order
   */
  getPhaseHistory(): InstallationPhase[] {
    return [...this.phaseHistory];
  }

  /**
   * Attempts to transition to a new phase.
   * @param newPhase The phase to transition to
   * @returns true if transition was successful, false if invalid
   */
  transitionTo(newPhase: InstallationPhase): boolean {
    if (!this.isValidTransition(this.currentPhase, newPhase)) {
      return false;
    }

    this.currentPhase = newPhase;
    this.phaseHistory.push(newPhase);
    this.phaseTimestamps.set(newPhase, Date.now());

    return true;
  }

  /**
   * Checks if a phase transition is valid.
   * @param from Current phase
   * @param to Target phase
   * @returns true if the transition is allowed
   */
  isValidTransition(from: InstallationPhase, to: InstallationPhase): boolean {
    // No transition if already in target phase
    if (from === to) {
      return false;
    }

    // Error phase can be reached from any phase
    if (to === 'error') {
      return true;
    }

    // Check if target phase is in the valid transitions list for current phase
    const validTransitions = this.transitionRules[from];
    return validTransitions.includes(to);
  }

  /**
   * Gets the timestamp of when a phase was entered.
   * @param phase The phase to query
   * @returns Timestamp or undefined if phase not reached
   */
  getPhaseTimestamp(phase: InstallationPhase): number | undefined {
    return this.phaseTimestamps.get(phase);
  }

  /**
   * Resets the phase manager to initial state.
   */
  reset(): void {
    this.currentPhase = 'idle';
    this.phaseHistory = ['idle'];
    this.phaseTimestamps.clear();
    this.phaseTimestamps.set('idle', Date.now());
  }
}
