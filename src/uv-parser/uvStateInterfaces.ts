/**
 * UV State Management Interfaces
 *
 * Interfaces for managing UV process state within the application.
 * Integrates with the existing app state architecture.
 */
import type { EventEmitter } from 'node:events';

import type { UvStage } from './stateManager';
import type {
  DownloadProgress,
  InstallationSummary,
  PackageInfo,
  PreparationSummary,
  ResolutionSummary,
  UvError,
  UvParsedOutput,
  UvWarning,
} from './types';

/**
 * UV process identifiers for tracking different installations
 */
export type UvProcessId = string;

/**
 * UV process type indicates what kind of installation is happening
 */
export type UvProcessType =
  | 'core_requirements' // Initial ComfyUI requirements
  | 'manager_requirements' // ComfyUI-Manager requirements
  | 'custom_node' // Custom node installation
  | 'model_download' // Model installation
  | 'package_update' // Package update
  | 'package_install' // Individual package install
  | 'venv_reset' // Virtual environment reset
  | 'troubleshooting'; // Troubleshooting reinstall

/**
 * UV process status
 */
export type UvProcessStatus =
  | 'idle' // No process running
  | 'starting' // Process is starting
  | 'running' // Process is running
  | 'completed' // Process completed successfully
  | 'failed' // Process failed with error
  | 'cancelled'; // Process was cancelled

/**
 * UV process state for a single installation
 */
export interface UvProcessState {
  /** Unique identifier for this process */
  readonly id: UvProcessId;

  /** Type of installation */
  readonly type: UvProcessType;

  /** Current status */
  status: UvProcessStatus;

  /** Current stage of the UV installation */
  stage: UvStage;

  /** Start timestamp */
  readonly startedAt: Date;

  /** End timestamp (if completed/failed) */
  endedAt?: Date;

  /** Duration in milliseconds */
  duration?: number;

  /** Packages being processed */
  packages: Map<string, PackageInfo>;

  /** Statistics about the process */
  statistics: UvProcessStatistics;

  /** Errors encountered */
  errors: UvError[];

  /** Warnings encountered */
  warnings: UvWarning[];

  /** Resolution summary if available */
  resolutionSummary?: ResolutionSummary;

  /** Preparation summary if available */
  preparationSummary?: PreparationSummary;

  /** Installation summary if available */
  installationSummary?: InstallationSummary;

  /** Final list of installed packages */
  installedPackages: PackageInfo[];

  /** Final list of removed packages */
  removedPackages: PackageInfo[];

  /** Raw output lines for debugging */
  rawOutput?: string[];

  /** Parsed outputs */
  parsedOutputs: UvParsedOutput[];
}

/**
 * Statistics for a UV process
 */
export interface UvProcessStatistics {
  /** Total lines of output processed */
  linesProcessed: number;

  /** Lines that were successfully parsed */
  linesParsed: number;

  /** Number of packages resolved */
  packagesResolved: number;

  /** Number of packages downloaded */
  packagesDownloaded: number;

  /** Number of packages installed */
  packagesInstalled: number;

  /** Number of packages removed */
  packagesRemoved: number;

  /** Cache hits during resolution */
  cacheHits: number;

  /** Cache misses during resolution */
  cacheMisses: number;

  /** Total download size in bytes */
  totalDownloadBytes?: number;

  /** Download speed in bytes per second */
  downloadSpeed?: number;
}

/**
 * UV state events emitted during process execution
 */
export type UvStateEvents = {
  /** Emitted when a UV process starts */
  'process:start': [process: UvProcessState];

  /** Emitted when UV process stage changes */
  'stage:change': [processId: UvProcessId, newStage: UvStage, oldStage: UvStage];

  /** Emitted when a line is parsed */
  'output:parsed': [processId: UvProcessId, output: UvParsedOutput];

  /** Emitted for download progress */
  'download:progress': [processId: UvProcessId, progress: DownloadProgress];

  /** Emitted when a package is resolved */
  'package:resolved': [processId: UvProcessId, packageInfo: PackageInfo];

  /** Emitted when a package is installed */
  'package:installed': [processId: UvProcessId, packageInfo: PackageInfo];

  /** Emitted when an error occurs */
  'process:error': [processId: UvProcessId, error: UvError];

  /** Emitted when a warning occurs */
  'process:warning': [processId: UvProcessId, warning: UvWarning];

  /** Emitted when a UV process completes */
  'process:complete': [process: UvProcessState];

  /** Emitted when a UV process fails */
  'process:failed': [processId: UvProcessId, error: Error];

  /** Emitted when a UV process is cancelled */
  'process:cancelled': [processId: UvProcessId];

  /** Emitted when all UV processes are idle */
  'all:idle': [];
};

/**
 * Options for creating a UV process
 */
export interface UvProcessOptions {
  /** Type of installation */
  type: UvProcessType;

  /** Optional custom ID (will be generated if not provided) */
  id?: UvProcessId;

  /** Whether to store raw output lines */
  storeRawOutput?: boolean;

  /** Maximum number of parsed outputs to keep */
  maxParsedOutputs?: number;

  /** Whether to emit events for every parsed line */
  emitAllOutputs?: boolean;
}

/**
 * UV state manager interface for the application
 */
export interface IUvState extends Pick<EventEmitter<UvStateEvents>, 'on' | 'once' | 'off' | 'emit'> {
  /** Get current active process (if any) */
  readonly activeProcess: UvProcessState | undefined;

  /** Check if any process is running */
  readonly isRunning: boolean;

  /** Get all processes (including completed) */
  readonly processes: Map<UvProcessId, UvProcessState>;

  /** Get count of running processes */
  readonly runningCount: number;

  /**
   * Start a new UV process
   * @param options Process options
   * @returns The created process state
   */
  startProcess(options: UvProcessOptions): UvProcessState;

  /**
   * Process a line of output for a specific process
   * @param processId Process identifier
   * @param line Output line to process
   * @returns Parsed output if any
   */
  processLine(processId: UvProcessId, line: string): UvParsedOutput | undefined;

  /**
   * Process multiple lines of output
   * @param processId Process identifier
   * @param lines Output lines to process
   * @returns Array of parsed outputs
   */
  processLines(processId: UvProcessId, lines: string[]): UvParsedOutput[];

  /**
   * Mark a process as completed
   * @param processId Process identifier
   */
  completeProcess(processId: UvProcessId): void;

  /**
   * Mark a process as failed
   * @param processId Process identifier
   * @param error Error that caused the failure
   */
  failProcess(processId: UvProcessId, error: Error): void;

  /**
   * Cancel a running process
   * @param processId Process identifier
   */
  cancelProcess(processId: UvProcessId): void;

  /**
   * Get a specific process state
   * @param processId Process identifier
   * @returns Process state if found
   */
  getProcess(processId: UvProcessId): UvProcessState | undefined;

  /**
   * Get all running processes
   * @returns Array of running process states
   */
  getRunningProcesses(): UvProcessState[];

  /**
   * Get all completed processes
   * @returns Array of completed process states
   */
  getCompletedProcesses(): UvProcessState[];

  /**
   * Get all failed processes
   * @returns Array of failed process states
   */
  getFailedProcesses(): UvProcessState[];

  /**
   * Clear completed/failed processes from memory
   * @param keepCount Number of recent processes to keep
   */
  clearCompletedProcesses(keepCount?: number): void;

  /**
   * Get summary of a process
   * @param processId Process identifier
   * @returns Process summary
   */
  getProcessSummary(processId: UvProcessId): ProcessSummary | undefined;

  /**
   * Reset the UV state (clear all processes)
   */
  reset(): void;
}

/**
 * Summary of a UV process
 */
export interface ProcessSummary {
  /** Process ID */
  id: UvProcessId;

  /** Process type */
  type: UvProcessType;

  /** Status */
  status: UvProcessStatus;

  /** Final stage reached */
  finalStage: UvStage;

  /** Duration in milliseconds */
  duration: number;

  /** Statistics */
  statistics: UvProcessStatistics;

  /** Number of errors */
  errorCount: number;

  /** Number of warnings */
  warningCount: number;

  /** Installed packages */
  installedPackages: PackageInfo[];

  /** Removed packages */
  removedPackages: PackageInfo[];

  /** Success indicator */
  success: boolean;
}

/**
 * Factory for creating UV state managers
 */
export interface IUvStateFactory {
  /**
   * Create a new UV state instance
   * @returns New UV state manager
   */
  createUvState(): IUvState;

  /**
   * Get the singleton UV state instance
   * @returns Singleton UV state manager
   */
  getUvState(): IUvState;
}
