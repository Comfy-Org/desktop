/**
 * UV Parser Type Definitions
 *
 * Core types and interfaces for parsing UV pip install output
 */

/**
 * Represents the distinct stages of a UV pip install process.
 * UV progresses through these stages sequentially, though some may be skipped
 * based on cache state and installation requirements.
 */
export type UVStage =
  /** Default state before any output has been processed. */
  | 'initializing'
  /** UV startup and environment discovery phase. */
  | 'startup'
  /** Dependency resolution setup with PubGrub solver. */
  | 'resolution_setup'
  /** Cache checking and metadata retrieval (from cache or network). */
  | 'cache_checking'
  /** Dependency resolution using PubGrub algorithm. */
  | 'dependency_resolution'
  /** Resolution complete summary. */
  | 'resolution_summary'
  /** Planning what needs to be installed/removed. */
  | 'installation_planning'
  /** Downloading packages from network (skipped if all cached). */
  | 'package_downloads'
  /** Package preparation complete (only after downloads). */
  | 'package_preparation'
  /** Installing packages to environment. */
  | 'installation'
  /** Final summary with list of installed packages. */
  | 'final_summary'
  /** Process complete. */
  | 'complete';

/**
 * Log levels found in UV debug output
 */
export type LogLevel =
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  /** User-facing messages without log level prefix. */
  | '';

/**
 * UV modules/components that generate log messages
 */
export type UVModule =
  /** Main UV application. */
  | 'uv'
  /** Dependency resolver. */
  | 'uv_resolver'
  /** HTTP client and caching. */
  | 'uv_client'
  /** Installation planning and execution. */
  | 'uv_installer'
  /** Distribution database and metadata. */
  | 'uv_distribution'
  /** PubGrub solver. */
  | 'pubgrub'
  /** HTTP/2 protocol. */
  | 'h2'
  /** HTTP client library. */
  | 'reqwest'
  /** Unknown/other module. */
  | 'other';

/**
 * Represents cache operation results
 */
export type CacheStatus =
  /** Found in cache and still fresh. */
  | 'hit'
  /** Not found in cache. */
  | 'miss'
  /** Found but stale, needs refresh. */
  | 'stale'
  /** Writing new entry to cache. */
  | 'write';

/**
 * Package installation actions determined during planning
 */
export type InstallAction =
  /** Package needs to be downloaded. */
  | 'download'
  /** Package already cached locally. */
  | 'use_cache'
  /** Package already installed in environment. */
  | 'already_installed'
  /** Package should be removed as unnecessary. */
  | 'remove';

/**
 * Base interface for all parsed output objects
 */
export interface ParsedOutput {
  /** Type discriminator for runtime type checking */
  type: string;

  /** Raw line that was parsed */
  rawLine: string;

  /** Line number in the original output (1-indexed) */
  lineNumber?: number;

  /** Timestamp if available (seconds from process start) */
  timestamp?: number;

  /** Operation-relative timestamp if available (e.g., "253ms") */
  relativeTime?: string;
}

/**
 * Log message from UV debug output
 */
export interface LogMessage extends ParsedOutput {
  type: 'log_message';

  /** Log level */
  level: LogLevel;

  /** Module that generated the log */
  module: UVModule;

  /** Log message content */
  message: string;

  /** Additional structured data from the log */
  data?: Record<string, unknown>;
}

/**
 * Package information
 */
export interface PackageInfo {
  /** Package name */
  name: string;

  /** Package version */
  version?: string;

  /** Package specification (e.g., "package==1.2.3") */
  specification?: string;

  /** Size as shown in output (e.g., "15.3 MiB") */
  size?: string;
}

/**
 * Resolution event (package selected by solver)
 */
export interface ResolutionEvent extends ParsedOutput {
  type: 'resolution';

  /** Package being resolved */
  package: PackageInfo;

  /** Resolution decision type */
  decision: 'selected' | 'searching' | 'backtracking';

  /** Solver state information */
  solverInfo?: {
    packageId?: number;
    checkingDependencies?: boolean;
  };
}

/**
 * Summary of resolution phase
 */
export interface ResolutionSummary extends ParsedOutput {
  type: 'resolution_summary';

  /** Number of packages resolved */
  packageCount: number;

  /** Time taken to resolve as shown in output (e.g., "379ms") */
  duration: string;
}

/**
 * Installation planning decision for a package
 */
export interface InstallPlanItem extends ParsedOutput {
  type: 'install_plan';

  /** Package affected */
  package: PackageInfo;

  /** Action to take */
  action: InstallAction;

  /** Reason for the action */
  reason?: string;
}

/**
 * Download progress event
 */
export interface DownloadProgress extends ParsedOutput {
  type: 'download_progress';

  /** Package being downloaded */
  package: PackageInfo;

  /** HTTP/2 stream ID */
  streamId?: number;

  /** Download state */
  state: 'started' | 'progress' | 'completed';
}

/**
 * Package preparation complete summary
 */
export interface PreparationSummary extends ParsedOutput {
  type: 'preparation_summary';

  /** Number of packages prepared */
  packageCount: number;

  /** Time taken to prepare as shown in output (e.g., "21.72s") */
  duration: string;
}

/**
 * Installation complete summary
 */
export interface InstallationSummary extends ParsedOutput {
  type: 'installation_summary';

  /** Number of packages installed */
  packageCount: number;

  /** Time taken to install as shown in output (e.g., "215ms") */
  duration: string;
}

/**
 * Cache operation event
 */
export interface CacheEvent extends ParsedOutput {
  type: 'cache_event';

  /** Cache operation status */
  status: CacheStatus;

  /** URL or path involved */
  resource: string;

  /** Package if identifiable */
  package?: string;

  /** Cache file path if applicable */
  cachePath?: string;
}

/**
 * HTTP/2 frame event for detailed network analysis
 */
export interface Http2Frame extends ParsedOutput {
  type: 'http2_frame';

  /** Frame type */
  frameType: 'Settings' | 'Headers' | 'Data' | 'WindowUpdate' | 'GoAway' | 'Ping' | 'RstStream';

  /** Stream ID */
  streamId?: number;

  /** Frame flags */
  flags?: string;

  /** Frame details */
  details?: Record<string, unknown>;
}

/**
 * Warning or error message
 */
export interface WarningOrError extends ParsedOutput {
  type: 'warning' | 'error';

  /** Severity level */
  severity: 'warning' | 'error';

  /** Error/warning message */
  message: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * User-facing status message (no log level prefix)
 */
export interface StatusMessage extends ParsedOutput {
  type: 'status_message';

  /** Status message text */
  message: string;

  /** Message category if identifiable */
  category?: 'downloading' | 'resolving' | 'installing' | 'summary' | 'other';
}

/**
 * Changed package in the final summary (e.g., " + numpy==2.1.0")
 */
export interface ChangedPackage extends ParsedOutput {
  type: 'changed_package';

  /** Package information */
  package: PackageInfo;

  /** Operation ('+' for added, '-' for removed) */
  operation: '+' | '-';
}

/**
 * Union type of all possible parsed output types
 */
export type UVParsedOutput =
  | LogMessage
  | ResolutionEvent
  | ResolutionSummary
  | InstallPlanItem
  | DownloadProgress
  | PreparationSummary
  | InstallationSummary
  | CacheEvent
  | Http2Frame
  | WarningOrError
  | StatusMessage
  | ChangedPackage;

/**
 * State tracking for UV installation process (used by state manager, not parser)
 */
export interface UVState {
  /** Current stage of the installation */
  currentStage: UVStage;

  /** Packages being tracked */
  packages: Map<string, PackageInfo>;

  /** Active download streams */
  activeDownloads: Map<number, string>; // streamId -> packageName

  /** Statistics collected during parsing */
  statistics: {
    packagesResolved: number;
    packagesDownloaded: number;
    packagesInstalled: number;
    cacheHits: number;
    cacheMisses: number;
    totalDuration?: number;
  };

  /** Any errors encountered */
  errors: WarningOrError[];

  /** Any warnings encountered */
  warnings: WarningOrError[];
}
