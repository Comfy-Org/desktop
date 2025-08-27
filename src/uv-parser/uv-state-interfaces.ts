/**
 * UV State Management Interfaces
 *
 * Interfaces for managing UV process state within the application.
 * Integrates with the existing app state architecture.
 */
import type { EventEmitter } from 'node:events';

import type { UVStage } from './state-manager.js';
import type {
  DownloadProgress,
  InstallationSummary,
  PackageInfo,
  PreparationSummary,
  ResolutionSummary,
  UVParsedOutput,
  WarningOrError,
} from './types.js';

/**
 * UV process identifiers for tracking different installations
 */
export type UVProcessId = string;

/**
 * UV process type indicates what kind of installation is happening
 */
export type UVProcessType =
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
export type UVProcessStatus =
  | 'idle' // No process running
  | 'starting' // Process is starting
  | 'running' // Process is running
  | 'completed' // Process completed successfully
  | 'failed' // Process failed with error
  | 'cancelled'; // Process was cancelled

/**
 * UV process state for a single installation
 */
export interface UVProcessState {
  /** Unique identifier for this process */
  readonly id: UVProcessId;

  /** Type of installation */
  readonly type: UVProcessType;

  /** Current status */
  status: UVProcessStatus;

  /** Current stage of the UV installation */
  stage: UVStage;

  /** Start timestamp */
  readonly startedAt: Date;

  /** End timestamp (if completed/failed) */
  endedAt?: Date;

  /** Duration in milliseconds */
  duration?: number;

  /** Packages being processed */
  packages: Map<string, PackageInfo>;

  /** Statistics about the process */
  statistics: UVProcessStatistics;

  /** Errors encountered */
  errors: WarningOrError[];

  /** Warnings encountered */
  warnings: WarningOrError[];

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
  parsedOutputs: UVParsedOutput[];
}

/**
 * Statistics for a UV process
 */
export interface UVProcessStatistics {
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
export type UVStateEvents = {
  /** Emitted when a UV process starts */
  'process:start': [process: UVProcessState];

  /** Emitted when UV process stage changes */
  'stage:change': [processId: UVProcessId, newStage: UVStage, oldStage: UVStage];

  /** Emitted when a line is parsed */
  'output:parsed': [processId: UVProcessId, output: UVParsedOutput];

  /** Emitted for download progress */
  'download:progress': [processId: UVProcessId, progress: DownloadProgress];

  /** Emitted when a package is resolved */
  'package:resolved': [processId: UVProcessId, packageInfo: PackageInfo];

  /** Emitted when a package is installed */
  'package:installed': [processId: UVProcessId, packageInfo: PackageInfo];

  /** Emitted when an error occurs */
  'process:error': [processId: UVProcessId, error: WarningOrError];

  /** Emitted when a warning occurs */
  'process:warning': [processId: UVProcessId, warning: WarningOrError];

  /** Emitted when a UV process completes */
  'process:complete': [process: UVProcessState];

  /** Emitted when a UV process fails */
  'process:failed': [processId: UVProcessId, error: Error];

  /** Emitted when a UV process is cancelled */
  'process:cancelled': [processId: UVProcessId];

  /** Emitted when all UV processes are idle */
  'all:idle': [];
};

/**
 * Options for creating a UV process
 */
export interface UVProcessOptions {
  /** Type of installation */
  type: UVProcessType;

  /** Optional custom ID (will be generated if not provided) */
  id?: UVProcessId;

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
export interface IUVState extends Pick<EventEmitter<UVStateEvents>, 'on' | 'once' | 'off' | 'emit'> {
  /** Get current active process (if any) */
  readonly activeProcess: UVProcessState | undefined;

  /** Check if any process is running */
  readonly isRunning: boolean;

  /** Get all processes (including completed) */
  readonly processes: Map<UVProcessId, UVProcessState>;

  /** Get count of running processes */
  readonly runningCount: number;

  /**
   * Start a new UV process
   * @param options Process options
   * @returns The created process state
   */
  startProcess(options: UVProcessOptions): UVProcessState;

  /**
   * Process a line of output for a specific process
   * @param processId Process identifier
   * @param line Output line to process
   * @returns Parsed output if any
   */
  processLine(processId: UVProcessId, line: string): UVParsedOutput | undefined;

  /**
   * Process multiple lines of output
   * @param processId Process identifier
   * @param lines Output lines to process
   * @returns Array of parsed outputs
   */
  processLines(processId: UVProcessId, lines: string[]): UVParsedOutput[];

  /**
   * Mark a process as completed
   * @param processId Process identifier
   */
  completeProcess(processId: UVProcessId): void;

  /**
   * Mark a process as failed
   * @param processId Process identifier
   * @param error Error that caused the failure
   */
  failProcess(processId: UVProcessId, error: Error): void;

  /**
   * Cancel a running process
   * @param processId Process identifier
   */
  cancelProcess(processId: UVProcessId): void;

  /**
   * Get a specific process state
   * @param processId Process identifier
   * @returns Process state if found
   */
  getProcess(processId: UVProcessId): UVProcessState | undefined;

  /**
   * Get all running processes
   * @returns Array of running process states
   */
  getRunningProcesses(): UVProcessState[];

  /**
   * Get all completed processes
   * @returns Array of completed process states
   */
  getCompletedProcesses(): UVProcessState[];

  /**
   * Get all failed processes
   * @returns Array of failed process states
   */
  getFailedProcesses(): UVProcessState[];

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
  getProcessSummary(processId: UVProcessId): ProcessSummary | undefined;

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
  id: UVProcessId;

  /** Process type */
  type: UVProcessType;

  /** Status */
  status: UVProcessStatus;

  /** Final stage reached */
  finalStage: UVStage;

  /** Duration in milliseconds */
  duration: number;

  /** Statistics */
  statistics: UVProcessStatistics;

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
export interface IUVStateFactory {
  /**
   * Create a new UV state instance
   * @returns New UV state manager
   */
  createUVState(): IUVState;

  /**
   * Get the singleton UV state instance
   * @returns Singleton UV state manager
   */
  getUVState(): IUVState;
}
