/**
 * Minimal LineParser Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the ILineParser interface
 * that focuses on parsing the most essential UV log patterns for process monitoring.
 */
import type { ILineParser, ILogEvent } from '../architecture';
import { createLogEvent } from '../architecture';
import type {
  DownloadPrepareData,
  ErrorData,
  InstallationCompleteData,
  PackagesPreparedData,
  ProcessStartData,
  PythonVersionData,
  RequirementsFileData,
  ResolutionCompleteData,
  UnknownData,
} from '../event-types';

/**
 * Minimal stateless line parser that converts UV log lines to structured events.
 * Focuses on essential patterns for monitoring UV installation progress.
 */
export class LineParser implements ILineParser {
  /**
   * Regular expression patterns for parsing essential UV log events
   */
  private readonly patterns = {
    // Process start - UV version detection
    uvVersion: /DEBUG uv uv (\d+\.\d+\.\d+)/,

    // Requirements file detection
    requirementsFile: /from_source source=(.+\.txt)/,

    // Python version detection during resolution
    pythonVersion: /Solving with installed Python version: ([\d.]+)/,

    // Dependency resolution completion
    resolutionComplete: /Resolved (\d+) packages in ([\d.]+)s/,

    // Package download preparation
    downloadPrepare: /preparer::get_wheel name=([^=]+)==([\d.]+), size=(Some\(([\d_]+)\)|None), url="([^"]+)"/,

    // Package preparation completion
    packagesPrepared: /Prepared (\d+) packages? in ([\d.]+)(ms|s)/,

    // Installation completion
    installationComplete: /Installed (\d+) packages? in ([\d.]+)(ms|s)/,

    // Error detection
    error: /ERROR: (.+)/,
  } as const;

  /**
   * Parses a single log line into a structured event.
   * @param line Raw log line from UV process
   * @returns Structured event or undefined if line should be ignored
   */
  parseLine(line: string): ILogEvent | undefined {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      return undefined;
    }

    // Check each essential pattern
    for (const [patternKey, pattern] of Object.entries(this.patterns)) {
      const match = trimmed.match(pattern);
      if (match) {
        return this.createEventFromPattern(patternKey, match, line);
      }
    }

    // Ignore informational "Downloading" lines that don't contain structured data
    if (trimmed.startsWith('Downloading ') && !trimmed.includes('preparer::get_wheel')) {
      return undefined;
    }

    // Return unknown event for unrecognized but potentially important lines
    return createLogEvent(
      'unknown',
      {
        line: trimmed,
      } as UnknownData,
      line
    );
  }

  /**
   * Creates a structured event from a matched pattern.
   * @param patternKey The pattern key that matched
   * @param match The regex match result
   * @param rawLine The original log line
   * @returns Structured log event
   */
  private createEventFromPattern(patternKey: string, match: RegExpMatchArray, rawLine: string): ILogEvent {
    switch (patternKey) {
      case 'uvVersion':
        return createLogEvent(
          'process_start',
          {
            version: match[1],
          } as ProcessStartData,
          rawLine
        );

      case 'requirementsFile':
        return createLogEvent(
          'requirements_file',
          {
            file: match[1],
          } as RequirementsFileData,
          rawLine
        );

      case 'pythonVersion':
        return createLogEvent(
          'python_version',
          {
            version: match[1],
          } as PythonVersionData,
          rawLine
        );

      case 'resolutionComplete':
        return createLogEvent(
          'resolution_complete',
          {
            packageCount: Number.parseInt(match[1], 10),
            duration: Number.parseFloat(match[2]),
          } as ResolutionCompleteData,
          rawLine
        );

      case 'downloadPrepare': {
        // Parse size: "Some(1234_567)" -> 1234567, "None" -> 0
        const sizeString = match[3];
        const size = sizeString === 'None' ? 0 : Number.parseInt(match[4].replaceAll('_', ''), 10);

        return createLogEvent(
          'download_prepare',
          {
            packageName: match[1],
            version: match[2],
            size,
            url: match[5],
          } as DownloadPrepareData,
          rawLine
        );
      }

      case 'packagesPrepared': {
        // Convert duration to milliseconds if needed
        const preparedDuration = match[3] === 's' ? Number.parseFloat(match[2]) * 1000 : Number.parseFloat(match[2]);

        return createLogEvent(
          'packages_prepared',
          {
            count: Number.parseInt(match[1], 10),
            duration: preparedDuration,
          } as PackagesPreparedData,
          rawLine
        );
      }

      case 'installationComplete': {
        // Convert duration to milliseconds if needed
        const installDuration = match[3] === 's' ? Number.parseFloat(match[2]) * 1000 : Number.parseFloat(match[2]);

        return createLogEvent(
          'installation_complete',
          {
            count: Number.parseInt(match[1], 10),
            duration: installDuration,
          } as InstallationCompleteData,
          rawLine
        );
      }

      case 'error':
        return createLogEvent(
          'error',
          {
            message: match[1],
          } as ErrorData,
          rawLine
        );

      default:
        // Fallback for any unhandled pattern keys
        return createLogEvent(
          'unknown',
          {
            match,
            context: `Unhandled pattern: ${patternKey}`,
          } as UnknownData,
          rawLine
        );
    }
  }
}
