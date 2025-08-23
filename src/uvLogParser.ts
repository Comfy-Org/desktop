/**
 * Type definitions for UV log parser
 *
 * These interfaces define the structure of data extracted from uv pip install logs
 */

export type Phase =
  | 'idle'
  | 'started'
  | 'reading_requirements'
  | 'resolving'
  | 'resolved'
  | 'preparing_download'
  | 'downloading'
  | 'prepared'
  | 'installing'
  | 'installed'
  | 'error'
  | 'unknown';

export interface UvStatus {
  phase: Phase;
  message: string;
  timestamp?: number;

  // Process info
  uvVersion?: string;
  pythonVersion?: string;
  requirementsFile?: string;

  // Package info
  currentPackage?: string;
  packageVersion?: string;
  packageSize?: number;
  packageSizeFormatted?: string;
  downloadUrl?: string;

  // Progress info
  totalPackages?: number;
  preparedPackages?: number;
  installedPackages?: number;
  totalWheels?: number;

  // Timing info
  resolutionTime?: number;
  preparationTime?: number;
  installationTime?: number;

  // Stream info (for HTTP/2 tracking)
  streamId?: string;
  streamCompleted?: boolean;

  // Error info
  error?: string;
  rawLine?: string;
}

export interface PackageDownloadInfo {
  package: string;
  version: string;
  totalBytes: number;
  url: string;
  startTime?: number;
  endTime?: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
}

export interface TransferRateSample {
  timestamp: number;
  bytesPerSecond: number;
}

export interface DownloadProgress {
  package: string;
  totalBytes: number;
  bytesReceived?: number;
  estimatedBytesReceived?: number;
  percentComplete: number;
  startTime: number;
  currentTime: number;
  transferRateSamples: TransferRateSample[];
  averageTransferRate?: number;
  estimatedTimeRemaining?: number;
}

export interface HttpTransferInfo {
  streamId: string;
  frameCount: number;
  lastFrameTime: number;
  associatedPackage?: string;
}

export interface OverallState {
  phases: Phase[];
  currentPhase: Phase;
  isComplete: boolean;
  totalPackages: number;
  resolvedPackages: number;
  downloadedPackages: number;
  installedPackages: number;
  startTime?: number;
  endTime?: number;
  totalDuration?: number;
}

export interface IUvLogParser {
  // Core parsing
  parseLine(line: string): UvStatus;
  parseLines(lines: string[]): UvStatus[];

  // State queries
  getOverallState(): OverallState;
  getActiveDownloads(): PackageDownloadInfo[];
  getActiveTransfers(): Record<string, HttpTransferInfo>;
  getDownloadProgress(packageName: string): DownloadProgress | undefined;

  // Progress calculation
  calculateAverageTransferRate(progress: DownloadProgress): number;
  estimateTimeRemaining(progress: DownloadProgress, avgRate: number): number;

  // State management
  reset(): void;
}

/**
 * Regular expression patterns for parsing uv log lines
 */
export const UV_LOG_PATTERNS = {
  // Process start
  UV_VERSION: /DEBUG uv uv (\d+\.\d+\.\d+)/,
  REQUIREMENTS_FILE: /from_source source=(.+\.txt)/,

  // Resolution phase
  SOLVING_PYTHON: /Solving with installed Python version: ([\d.]+)/,
  ADDING_DEPENDENCY: /Adding direct dependency: ([^>=<]+)(.*)/,
  RESOLVED_PACKAGES: /Resolved (\d+) packages in ([\d.]+)s/,

  // Download preparation
  GET_WHEEL: /preparer::get_wheel name=([^=]+)==([\d.]+), size=Some\((\d+)\), url="([^"]+)"/,
  DOWNLOADING: /Downloading (\S+) \(([^)]+)\)/,

  // HTTP/2 transfer
  H2_DATA_FRAME:
    /([\d.]+)s.*h2::codec::framed_read received, frame=Data \{ stream_id: StreamId\((\d+)\)(?:, flags: \(0x1: END_STREAM\))?\s*\}/,

  // Completion phases
  PREPARED_PACKAGES: /Prepared (\d+) packages? in (\d+)ms/,
  INSTALL_BLOCKING: /install_blocking num_wheels=(\d+)/,
  INSTALLED_PACKAGES: /Installed (\d+) packages? in (\d+)ms/,

  // Errors
  ERROR: /ERROR: (.+)/,
  WARN: /WARN[^:]*: (.+)/,
};

/**
 * Placeholder implementation for UvLogParser
 * This is a stub for test-driven design - actual implementation to follow
 */
export class UvLogParser implements IUvLogParser {
  parseLine(line: string): UvStatus {
    // Stub implementation for TDD
    return {
      phase: 'unknown' as Phase,
      message: 'Not implemented',
      rawLine: line,
    };
  }

  parseLines(lines: string[]): UvStatus[] {
    return lines.map((line) => this.parseLine(line));
  }

  getOverallState(): OverallState {
    return {
      phases: [],
      currentPhase: 'idle' as Phase,
      isComplete: false,
      totalPackages: 0,
      resolvedPackages: 0,
      downloadedPackages: 0,
      installedPackages: 0,
    };
  }

  getActiveDownloads(): PackageDownloadInfo[] {
    return [];
  }

  getActiveTransfers(): Record<string, HttpTransferInfo> {
    return {};
  }

  getDownloadProgress(_packageName: string): DownloadProgress | undefined {
    return undefined;
  }

  calculateAverageTransferRate(_progress: DownloadProgress): number {
    return 0;
  }

  estimateTimeRemaining(_progress: DownloadProgress, _avgRate: number): number {
    return 0;
  }

  reset(): void {
    // Stub implementation
  }
}
