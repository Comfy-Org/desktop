/**
 * UV Parser V2 - Data Models
 *
 * Pure data structures separated from behavior interfaces.
 * These models represent the state and data flowing through the system.
 */

// ============================================================================
// Core Installation Data Models
// ============================================================================

/**
 * Complete state of the UV installation process at a point in time.
 * This is a snapshot that can be serialized, stored, or transmitted.
 */
export interface InstallationSnapshot {
  /** Unique identifier for this installation session */
  sessionId: string;

  /** Timestamp when snapshot was taken */
  timestamp: number;

  /** Process information */
  process: ProcessInfo;

  /** Current phase information */
  phase: PhaseInfo;

  /** Package states */
  packages: PackageSnapshot;

  /** Download states */
  downloads: DownloadSnapshot;

  /** Stream states */
  streams: StreamSnapshot;

  /** Error information */
  errors: ErrorSnapshot;

  /** Performance metrics */
  metrics: MetricsSnapshot;

  /** Overall progress */
  progress: ProgressSnapshot;
}

/**
 * Information about the UV process
 */
export interface ProcessInfo {
  /** UV version */
  uvVersion?: string;

  /** Python version */
  pythonVersion?: string;

  /** Requirements file being processed */
  requirementsFile?: string;

  /** Process start time */
  startTime: number;

  /** Process end time (if complete) */
  endTime?: number;

  /** Process ID if available */
  pid?: number;

  /** Command line arguments */
  args?: string[];
}

/**
 * Current phase information
 */
export interface PhaseInfo {
  /** Current phase */
  current: string;

  /** Phase history in order */
  history: string[];

  /** Time entered current phase */
  enteredAt: number;

  /** Transitions that occurred */
  transitions: PhaseTransition[];
}

/**
 * Record of a phase transition
 */
export interface PhaseTransition {
  /** Phase transitioned from */
  from: string;

  /** Phase transitioned to */
  to: string;

  /** When transition occurred */
  timestamp: number;

  /** Trigger event type */
  trigger?: string;
}

// ============================================================================
// Package Data Models
// ============================================================================

/**
 * Snapshot of all package states
 */
export interface PackageSnapshot {
  /** Total number of packages */
  total: number;

  /** Packages by status */
  byStatus: {
    pending: string[];
    downloading: string[];
    downloaded: string[];
    installing: string[];
    installed: string[];
    failed: string[];
  };

  /** Detailed package information */
  packages: PackageData[];
}

/**
 * Data for a single package
 */
export interface PackageData {
  /** Package name */
  name: string;

  /** Version string */
  version: string;

  /** Version specification */
  versionSpec?: string;

  /** Download URL */
  url?: string;

  /** Size in bytes */
  sizeBytes: number;

  /** Formatted size string */
  sizeFormatted?: string;

  /** Current status */
  status: 'pending' | 'downloading' | 'downloaded' | 'installing' | 'installed' | 'failed';

  /** Dependencies of this package */
  dependencies?: string[];

  /** When package was discovered */
  discoveredAt: number;

  /** When status last changed */
  statusChangedAt: number;

  /** Associated error if failed */
  error?: string;
}

// ============================================================================
// Download Data Models
// ============================================================================

/**
 * Snapshot of all download states
 */
export interface DownloadSnapshot {
  /** Active downloads */
  active: DownloadData[];

  /** Completed downloads */
  completed: CompletedDownloadData[];

  /** Failed downloads */
  failed: FailedDownloadData[];

  /** Global statistics */
  statistics: DownloadStatistics;
}

/**
 * Data for an active download
 */
export interface DownloadData {
  /** Package being downloaded */
  packageName: string;

  /** Total size in bytes */
  totalBytes: number;

  /** Bytes received so far */
  bytesReceived: number;

  /** Estimated bytes based on frames */
  estimatedBytes: number;

  /** Progress percentage */
  percentComplete: number;

  /** Current transfer rate */
  transferRate: number;

  /** Formatted transfer rate */
  transferRateFormatted?: string;

  /** ETA in seconds */
  etaSeconds?: number;

  /** ETA formatted string */
  etaFormatted?: string;

  /** Download start time */
  startTime: number;

  /** Last update time */
  lastUpdateTime: number;

  /** Associated stream IDs */
  streamIds: string[];
}

/**
 * Data for a completed download
 */
export interface CompletedDownloadData {
  /** Package name */
  packageName: string;

  /** Total bytes downloaded */
  totalBytes: number;

  /** Time taken in milliseconds */
  duration: number;

  /** Average transfer rate */
  averageRate: number;

  /** Start time */
  startTime: number;

  /** End time */
  endTime: number;
}

/**
 * Data for a failed download
 */
export interface FailedDownloadData {
  /** Package name */
  packageName: string;

  /** Bytes received before failure */
  bytesReceived: number;

  /** Total bytes expected */
  totalBytes: number;

  /** Error message */
  error: string;

  /** When failure occurred */
  failedAt: number;

  /** How long it ran before failing */
  duration: number;
}

/**
 * Overall download statistics
 */
export interface DownloadStatistics {
  /** Total bytes to download */
  totalBytes: number;

  /** Total bytes downloaded */
  downloadedBytes: number;

  /** Current global transfer rate */
  currentRate: number;

  /** Average global transfer rate */
  averageRate: number;

  /** Peak transfer rate seen */
  peakRate: number;

  /** Number of active downloads */
  activeCount: number;

  /** Number of completed downloads */
  completedCount: number;

  /** Number of failed downloads */
  failedCount: number;
}

// ============================================================================
// Stream Data Models
// ============================================================================

/**
 * Snapshot of HTTP/2 stream states
 */
export interface StreamSnapshot {
  /** Active streams */
  active: StreamData[];

  /** Recently completed streams */
  completed: StreamData[];

  /** Stream to package associations */
  associations: StreamAssociation[];

  /** HTTP/2 settings */
  settings: Http2Settings;
}

/**
 * Data for an HTTP/2 stream
 */
export interface StreamData {
  /** Stream ID */
  id: string;

  /** Number of frames received */
  frameCount: number;

  /** Estimated bytes transferred */
  estimatedBytes: number;

  /** Stream start time */
  startTime: number;

  /** Last frame time */
  lastFrameTime: number;

  /** Whether stream is complete */
  isComplete: boolean;

  /** Associated package */
  packageName?: string;

  /** Confidence of association (0-1) */
  associationConfidence?: number;
}

/**
 * Stream to package association
 */
export interface StreamAssociation {
  /** Stream ID */
  streamId: string;

  /** Associated package */
  packageName: string;

  /** When association was made */
  associatedAt: number;

  /** Confidence score */
  confidence: number;

  /** Method used for association */
  method: 'timing' | 'size' | 'order' | 'explicit';
}

/**
 * HTTP/2 settings
 */
export interface Http2Settings {
  /** Maximum frame size */
  maxFrameSize: number;

  /** Window size */
  windowSize?: number;

  /** Max concurrent streams */
  maxConcurrentStreams?: number;

  /** When settings were last updated */
  updatedAt: number;
}

// ============================================================================
// Error Data Models
// ============================================================================

/**
 * Snapshot of error states
 */
export interface ErrorSnapshot {
  /** All errors */
  errors: ErrorData[];

  /** Errors by package */
  byPackage: Record<string, ErrorData[]>;

  /** Critical errors */
  critical: ErrorData[];

  /** Warnings */
  warnings: WarningData[];

  /** Whether installation has failed */
  hasFailed: boolean;
}

/**
 * Data for an error
 */
export interface ErrorData {
  /** Error ID */
  id: string;

  /** Error message */
  message: string;

  /** Error code if available */
  code?: string;

  /** Phase when error occurred */
  phase: string;

  /** Associated package */
  packageName?: string;

  /** When error occurred */
  timestamp: number;

  /** Stack trace if available */
  stack?: string;

  /** Whether error is critical */
  isCritical: boolean;

  /** Original log line */
  rawLine?: string;
}

/**
 * Data for a warning
 */
export interface WarningData {
  /** Warning message */
  message: string;

  /** When warning occurred */
  timestamp: number;

  /** Associated context */
  context?: string;
}

// ============================================================================
// Metrics Data Models
// ============================================================================

/**
 * Snapshot of performance metrics
 */
export interface MetricsSnapshot {
  /** Phase durations */
  phaseDurations: PhaseDuration[];

  /** Operation counts */
  operationCounts: Record<string, number>;

  /** Transfer rate history */
  transferRates: TransferRateHistory;

  /** Resource usage */
  resourceUsage?: ResourceUsage;

  /** Performance statistics */
  statistics: PerformanceStatistics;
}

/**
 * Duration of a phase
 */
export interface PhaseDuration {
  /** Phase name */
  phase: string;

  /** Start time */
  startTime: number;

  /** End time */
  endTime?: number;

  /** Duration in milliseconds */
  duration?: number;

  /** Number of operations */
  operationCount: number;
}

/**
 * Transfer rate history
 */
export interface TransferRateHistory {
  /** Rate samples over time */
  samples: RateSample[];

  /** Rates by package */
  byPackage: Record<string, RateSample[]>;

  /** Statistics */
  statistics: {
    average: number;
    peak: number;
    current: number;
    percentile95: number;
  };
}

/**
 * Single rate sample
 */
export interface RateSample {
  /** Timestamp */
  timestamp: number;

  /** Rate in bytes per second */
  bytesPerSecond: number;

  /** Package if specific to one */
  packageName?: string;
}

/**
 * Resource usage metrics
 */
export interface ResourceUsage {
  /** Memory usage in bytes */
  memoryBytes: number;

  /** CPU usage percentage */
  cpuPercent: number;

  /** Network connections */
  networkConnections: number;

  /** Disk I/O bytes */
  diskIOBytes?: number;
}

/**
 * Overall performance statistics
 */
export interface PerformanceStatistics {
  /** Total time elapsed */
  totalElapsedMs: number;

  /** Time spent downloading */
  downloadTimeMs: number;

  /** Time spent installing */
  installTimeMs: number;

  /** Time spent resolving */
  resolveTimeMs: number;

  /** Average package download time */
  avgPackageDownloadMs: number;

  /** Average package install time */
  avgPackageInstallMs: number;
}

// ============================================================================
// Progress Data Models
// ============================================================================

/**
 * Snapshot of progress information
 */
export interface ProgressSnapshot {
  /** Overall progress percentage */
  overall: number;

  /** Progress by phase */
  byPhase: Record<string, number>;

  /** Current operation */
  currentOperation?: CurrentOperation;

  /** Estimated time remaining */
  etaSeconds?: number;

  /** Progress message */
  message: string;

  /** Whether installation is complete */
  isComplete: boolean;

  /** Success status if complete */
  success?: boolean;
}

/**
 * Currently executing operation
 */
export interface CurrentOperation {
  /** Operation type */
  type: 'resolving' | 'downloading' | 'installing' | 'preparing';

  /** Description */
  description: string;

  /** Associated package */
  packageName?: string;

  /** Operation progress */
  progress?: number;

  /** Started at */
  startTime: number;
}

// ============================================================================
// Event Data Models
// ============================================================================

/**
 * Event emitted during installation
 */
export interface InstallationEvent {
  /** Event ID */
  id: string;

  /** Event type */
  type: 'status_change' | 'progress_update' | 'error' | 'warning' | 'complete';

  /** Event timestamp */
  timestamp: number;

  /** Event data */
  data: InstallationSnapshot | Partial<InstallationSnapshot>;

  /** Changed fields from previous state */
  changes?: string[];

  /** Whether this is a significant change */
  isSignificant: boolean;
}
