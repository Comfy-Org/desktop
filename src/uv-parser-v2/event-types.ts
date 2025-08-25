/**
 * Strongly-typed event data definitions for UV Parser V2
 *
 * This file contains specific data types for each log event,
 * replacing the generic Record<string, unknown> with type-safe interfaces.
 */

// ============================================================================
// Event Data Interfaces
// ============================================================================

/**
 * Data for process_start event - UV process initialization
 */
export interface ProcessStartData {
  /** UV version number (e.g., "0.8.13") */
  version: string;
}

/**
 * Data for requirements_file event - Requirements file detection
 */
export interface RequirementsFileData {
  /** Path to the requirements file */
  file: string;
}

/**
 * Data for python_version event - Python version detection
 */
export interface PythonVersionData {
  /** Python version string (e.g., "3.12.9") */
  version: string;
}

/**
 * Data for dependency_added event - Package dependency resolution
 */
export interface DependencyAddedData {
  /** Package name being added */
  packageName: string;
  /** Version specification (e.g., ">=3.11.8") */
  versionSpec: string;
}

/**
 * Data for resolution_complete event - Dependency resolution completion
 */
export interface ResolutionCompleteData {
  /** Number of packages resolved */
  packageCount: number;
  /** Time taken for resolution in seconds */
  duration: number;
}

/**
 * Data for download_prepare event - Package download preparation
 */
export interface DownloadPrepareData {
  /** Package name */
  packageName: string;
  /** Package version */
  version: string;
  /** Size in bytes (0 if unknown) */
  size: number;
  /** Download URL */
  url: string;
}

/**
 * Data for download_info event - User-friendly download message
 */
export interface DownloadInfoData {
  /** Package name with version */
  packageSpec: string;
  /** Human-readable size (e.g., "1.2MiB") */
  sizeFormatted: string;
}

/**
 * Data for http2_headers event - HTTP/2 stream headers frame
 */
export interface Http2HeadersData {
  /** HTTP/2 stream ID */
  streamId: string;
  /** Optional flags from the frame */
  flags?: string;
}

/**
 * Data for http2_data event - HTTP/2 stream data frame
 */
export interface Http2DataData {
  /** HTTP/2 stream ID */
  streamId: string;
  /** Whether this is the final frame (END_STREAM flag) */
  isEndStream: boolean;
  /** Timestamp from log if available */
  logTimestamp?: string;
}

/**
 * Data for http2_settings event - HTTP/2 settings frame
 */
export interface Http2SettingsData {
  /** Maximum frame size in bytes */
  maxFrameSize: number;
  /** Other settings that might be present */
  otherSettings?: Record<string, number>;
}

/**
 * Data for packages_prepared event - Package preparation completion
 */
export interface PackagesPreparedData {
  /** Number of packages prepared */
  count: number;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Data for packages_uninstalled event - Package uninstallation
 */
export interface PackagesUninstalledData {
  /** Number of packages uninstalled */
  count: number;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Data for installation_start event - Installation phase start
 */
export interface InstallationStartData {
  /** Number of wheel files to install */
  wheelCount: number;
}

/**
 * Data for installation_complete event - Installation completion
 */
export interface InstallationCompleteData {
  /** Number of packages installed */
  count: number;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Data for error event - Error occurrence
 */
export interface ErrorData {
  /** Error message */
  message: string;
  /** Error code if available */
  code?: string;
  /** Stack trace if available */
  stack?: string;
}

/**
 * Data for warning event - Warning message
 */
export interface WarningData {
  /** Warning message */
  message: string;
  /** Warning type/category if available */
  type?: string;
}

/**
 * Data for unknown event - Unrecognized log line
 */
export interface UnknownData {
  /** The original line that couldn't be parsed */
  line?: string;
  /** RegExp match array if partially matched */
  match?: RegExpMatchArray;
  /** Any additional context */
  context?: unknown;
}

// ============================================================================
// Event Type Mapping
// ============================================================================

/**
 * Maps event type strings to their corresponding data interfaces
 */
export interface EventDataMap {
  process_start: ProcessStartData;
  requirements_file: RequirementsFileData;
  python_version: PythonVersionData;
  dependency_added: DependencyAddedData;
  resolution_complete: ResolutionCompleteData;
  download_prepare: DownloadPrepareData;
  download_info: DownloadInfoData;
  http2_headers: Http2HeadersData;
  http2_data: Http2DataData;
  http2_settings: Http2SettingsData;
  packages_prepared: PackagesPreparedData;
  packages_uninstalled: PackagesUninstalledData;
  installation_start: InstallationStartData;
  installation_complete: InstallationCompleteData;
  error: ErrorData;
  warning: WarningData;
  unknown: UnknownData;
}

/**
 * All possible event types
 */
export type EventType = keyof EventDataMap;

/**
 * Union of all possible event data types
 */
export type EventData = EventDataMap[EventType];

// ============================================================================
// Strongly-Typed Log Event (Discriminated Union)
// ============================================================================

/**
 * Base interface for all log events
 */
interface ILogEventBase {
  /** Timestamp when the event was parsed */
  timestamp: number;
  /** Original log line that generated this event */
  rawLine: string;
}

/**
 * Strongly-typed log event using discriminated union
 * Each event type has its specific data structure
 */
export type ILogEvent = {
  [K in EventType]: ILogEventBase & {
    type: K;
    data: EventDataMap[K];
  };
}[EventType];

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an event is of a specific type
 * @param event The event to check
 * @param type The event type to check for
 * @returns True if the event is of the specified type
 */
export function isEventType<T extends EventType>(event: ILogEvent, type: T): event is Extract<ILogEvent, { type: T }> {
  return event.type === type;
}

/**
 * Type guard to check if an event is an error event
 * @param event The event to check
 * @returns True if the event is an error event
 */
export function isErrorEvent(event: ILogEvent): event is ILogEventBase & { type: 'error'; data: ErrorData } {
  return event.type === 'error';
}

/**
 * Type guard to check if an event is a download-related event
 * @param event The event to check
 * @returns True if the event is related to downloading
 */
export function isDownloadEvent(
  event: ILogEvent
): event is Extract<ILogEvent, { type: 'download_prepare' | 'download_info' }> {
  return event.type === 'download_prepare' || event.type === 'download_info';
}

/**
 * Type guard to check if an event is an HTTP/2 event
 * @param event The event to check
 * @returns True if the event is HTTP/2 related
 */
export function isHttp2Event(
  event: ILogEvent
): event is Extract<ILogEvent, { type: 'http2_headers' | 'http2_data' | 'http2_settings' }> {
  return event.type === 'http2_headers' || event.type === 'http2_data' || event.type === 'http2_settings';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a strongly-typed log event
 * @param type The event type
 * @param data The event data
 * @param rawLine The original log line
 * @returns A strongly-typed log event
 */
export function createLogEvent<T extends EventType>(
  type: T,
  data: EventDataMap[T],
  rawLine: string
): ILogEventBase & { type: T; data: EventDataMap[T] } {
  return {
    type,
    data,
    timestamp: Date.now(),
    rawLine,
  };
}

/**
 * Extracts data from an event with type safety
 * @param event The event to extract data from
 * @param type The expected event type
 * @returns The event data if type matches, undefined otherwise
 */
export function extractEventData<T extends EventType>(event: ILogEvent, type: T): EventDataMap[T] | undefined {
  if (event.type === type) {
    return event.data as EventDataMap[T];
  }
  return undefined;
}
