/**
 * UV Output Parser Implementation
 *
 * Stateless parser for UV pip install output.
 * Each line is parsed independently without requiring context.
 */
import type { IUVParser } from './interfaces.js';
import {
  AUDITED_PATTERN,
  CACHE_HIT_PATTERN,
  CACHE_MISS_PATTERN,
  CACHE_WRITE_PATTERN,
  CHANGED_PACKAGE_PATTERN,
  DOWNLOADING_SIMPLE_PATTERN,
  DOWNLOADING_WITH_SIZE_PATTERN,
  HTTP2_FRAME_PATTERN,
  INSTALLED_PATTERN,
  INSTALL_PLAN_CACHED,
  INSTALL_PLAN_INSTALLED,
  INSTALL_PLAN_UNCACHED,
  INSTALL_PLAN_UNNECESSARY,
  MODULE_TRACE_PATTERN,
  PREPARED_PATTERN,
  RESOLUTION_DECISION_PATTERN,
  RESOLVED_PATTERN,
  SEARCHING_PATTERN,
  SELECTING_PATTERN,
  TIMESTAMP_LOG_PATTERN,
  extractPackageFromUrl,
  getModuleCategory,
  parseTimestamp,
} from './patterns.js';
import type {
  ChangedPackage,
  DownloadProgress,
  Http2Frame,
  Http2FrameReceived,
  Http2FrameSent,
  InstallationSummary,
  LogLevel,
  LogMessage,
  PreparationSummary,
  ResolutionSummary,
  StatusMessage,
  UVModule,
  UVParsedOutput,
} from './types.js';

/**
 * Stateless UV output parser implementation
 */
export class UVParser implements IUVParser {
  /**
   * Parse a single line of UV output without any state context.
   * Returns undefined if the line cannot be parsed or is not relevant.
   */
  parseLine(line: string): UVParsedOutput | undefined {
    // Check for empty lines
    if (!line.trim()) {
      return undefined;
    }

    // Try each parser in order of likelihood/specificity

    // 1. Check for final package list (most specific pattern)
    const changedPackage = this.parseChangedPackage(line);
    if (changedPackage) return changedPackage;

    // 2. Check for user-facing status messages (no timestamp)
    const statusMessage = this.parseStatusMessage(line);
    if (statusMessage) return statusMessage;

    // 3. Check for timestamped log messages
    const logMessage = this.parseLogMessage(line);
    if (logMessage) {
      // Extract additional information from log messages
      const specificParse = this.parseSpecificLogContent(logMessage);
      if (specificParse) return specificParse;
      return logMessage;
    }

    // 4. Check for module trace lines (indented, no timestamp)
    const moduleTrace = this.parseModuleTrace(line);
    if (moduleTrace) return moduleTrace;

    // If no pattern matches, return undefined
    return undefined;
  }

  /**
   * Parse multiple lines of UV output.
   */
  parseLines(lines: string[]): UVParsedOutput[] {
    const results: UVParsedOutput[] = [];
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  }

  /**
   * Parse a complete UV output string.
   */
  parseOutput(output: string): UVParsedOutput[] {
    const lines = output.split('\n');
    return this.parseLines(lines);
  }

  /**
   * Check if a line can be parsed by this parser.
   */
  canParse(line: string): boolean {
    return this.parseLine(line) !== undefined;
  }

  /**
   * Get the type of output a line would produce without fully parsing it.
   */
  getLineType(line: string): UVParsedOutput['type'] | undefined {
    const parsed = this.parseLine(line);
    return parsed?.type;
  }

  /**
   * Parse a changed package line from the final summary
   */
  private parseChangedPackage(line: string): ChangedPackage | undefined {
    const match = line.match(CHANGED_PACKAGE_PATTERN);
    if (!match) return undefined;

    const [, operation, name, version] = match;
    return {
      type: 'changed_package',
      operation: operation as '+' | '-',
      package: {
        name,
        version,
        specification: `${name}==${version}`,
      },
    };
  }

  /**
   * Parse user-facing status messages
   */
  private parseStatusMessage(
    line: string
  ): StatusMessage | ResolutionSummary | PreparationSummary | InstallationSummary | DownloadProgress | undefined {
    // Resolution summary
    let match = line.match(RESOLVED_PATTERN);
    if (match) {
      const [, count, duration] = match;
      return {
        type: 'resolution_summary',
        packageCount: Number.parseInt(count, 10),
        duration,
      };
    }

    // Preparation summary
    match = line.match(PREPARED_PATTERN);
    if (match) {
      const [, count, duration] = match;
      return {
        type: 'preparation_summary',
        packageCount: Number.parseInt(count, 10),
        duration,
      };
    }

    // Installation summary
    match = line.match(INSTALLED_PATTERN);
    if (match) {
      const [, count, duration] = match;
      return {
        type: 'installation_summary',
        packageCount: Number.parseInt(count, 10),
        duration,
      };
    }

    // Audited packages (treat as status message)
    match = line.match(AUDITED_PATTERN);
    if (match) {
      const [, count, duration] = match;
      return {
        type: 'status_message',
        message: `Audited ${count} packages in ${duration}`,
        category: 'summary',
      };
    }

    // Downloading with size
    match = line.match(DOWNLOADING_WITH_SIZE_PATTERN);
    if (match) {
      const [, name, size] = match;
      return {
        type: 'download_progress',
        state: 'started',
        package: {
          name,
          size,
        },
      };
    }

    // Simple downloading
    match = line.match(DOWNLOADING_SIMPLE_PATTERN);
    if (match) {
      const [, name] = match;
      return {
        type: 'download_progress',
        state: 'started',
        package: {
          name,
        },
      };
    }

    return undefined;
  }

  /**
   * Parse timestamped log messages
   */
  private parseLogMessage(line: string): LogMessage | undefined {
    const match = line.match(TIMESTAMP_LOG_PATTERN);
    if (!match) return undefined;

    const [, timestamp, relativeTime, level, module, message] = match;

    return {
      type: 'log_message',
      timestamp: parseTimestamp(timestamp),
      relativeTime: relativeTime || undefined,
      level: level as LogLevel,
      module: getModuleCategory(module) as UVModule,
      message,
    };
  }

  /**
   * Parse module trace lines
   */
  private parseModuleTrace(line: string): LogMessage | undefined {
    const match = line.match(MODULE_TRACE_PATTERN);
    if (!match) return undefined;

    const [, module, rest] = match;

    return {
      type: 'log_message',
      level: '',
      module: getModuleCategory(module) as UVModule,
      message: `${module} ${rest}`.trim(),
    };
  }

  /**
   * Parse specific content from log messages
   */
  private parseSpecificLogContent(log: LogMessage): UVParsedOutput | undefined {
    const message = log.message;

    // Warning or Error
    if (log.level === 'WARN') {
      return {
        type: 'warning',
        severity: 'warning',
        message,
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    if (log.level === 'ERROR') {
      return {
        type: 'error',
        severity: 'error',
        message,
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    // Installation planning
    let match = message.match(INSTALL_PLAN_CACHED);
    if (match) {
      const [, name, version] = match;
      return {
        type: 'install_plan',
        action: 'use_cache',
        package: {
          name,
          version,
          specification: `${name}==${version}`,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(INSTALL_PLAN_INSTALLED);
    if (match) {
      const [, name, version] = match;
      return {
        type: 'install_plan',
        action: 'already_installed',
        package: {
          name,
          version,
          specification: `${name}==${version}`,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(INSTALL_PLAN_UNCACHED);
    if (match) {
      const [, name, version] = match;
      return {
        type: 'install_plan',
        action: 'download',
        package: {
          name,
          version,
          specification: `${name}==${version}`,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(INSTALL_PLAN_UNNECESSARY);
    if (match) {
      const [, name, version] = match;
      return {
        type: 'install_plan',
        action: 'remove',
        package: {
          name,
          version,
          specification: `${name}==${version}`,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    // Cache events
    match = message.match(CACHE_HIT_PATTERN);
    if (match) {
      const [, resource] = match;
      return {
        type: 'cache_event',
        status: 'hit',
        resource,
        package: extractPackageFromUrl(resource),
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(CACHE_MISS_PATTERN);
    if (match) {
      const [, resource] = match;
      return {
        type: 'cache_event',
        status: 'miss',
        resource,
        package: extractPackageFromUrl(resource),
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(CACHE_WRITE_PATTERN);
    if (match) {
      const [, cachePath] = match;
      return {
        type: 'cache_event',
        status: 'write',
        resource: cachePath,
        cachePath,
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    // Resolution events
    match = message.match(RESOLUTION_DECISION_PATTERN);
    if (match) {
      const [, packageId, version, rest] = match;

      // Skip Python version decisions (packageId 0)
      if (packageId === '0') return undefined;

      return {
        type: 'resolution',
        decision: 'selected',
        package: {
          name: '', // Will be filled from other context
          version,
        },
        solverInfo: {
          packageId: Number.parseInt(packageId, 10),
          checkingDependencies: !rest.includes('without checking'),
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(SELECTING_PATTERN);
    if (match) {
      const [, name, version] = match;
      return {
        type: 'resolution',
        decision: 'selected',
        package: {
          name,
          version,
          specification: `${name}==${version}`,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    match = message.match(SEARCHING_PATTERN);
    if (match) {
      const [, name] = match;
      return {
        type: 'resolution',
        decision: 'searching',
        package: {
          name,
        },
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
      };
    }

    // HTTP/2 frames
    match = message.match(HTTP2_FRAME_PATTERN);
    if (match) {
      const [, direction, frameType, streamId, flags, sizeIncrement] = match;

      if (direction === 'send') {
        return {
          type: 'http2_frame',
          direction: 'send',
          frameType: frameType as Http2Frame['frameType'],
          streamId: streamId ? Number.parseInt(streamId, 10) : undefined,
          flags: flags || undefined,
          sizeIncrement: sizeIncrement ? Number.parseInt(sizeIncrement, 10) : undefined,
          timestamp: log.timestamp,
          relativeTime: log.relativeTime,
        } satisfies Http2FrameSent;
      } else {
        return {
          type: 'http2_frame',
          direction: 'received',
          frameType: frameType as Http2Frame['frameType'],
          streamId: streamId ? Number.parseInt(streamId, 10) : undefined,
          flags: flags || undefined,
          sizeIncrement: sizeIncrement ? Number.parseInt(sizeIncrement, 10) : undefined,
          timestamp: log.timestamp,
          relativeTime: log.relativeTime,
        } satisfies Http2FrameReceived;
      }
    }

    return undefined;
  }
}

/**
 * Create a new UV parser instance
 */
export function createUVParser(): IUVParser {
  return new UVParser();
}
