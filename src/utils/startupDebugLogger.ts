import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Debug logger for tracking detailed server startup timing.
 * Logs to a file with high-resolution timestamps for performance analysis.
 */
class StartupDebugLogger {
  private readonly logPath: string;
  private readonly startTime: number;
  private fileStream: fs.WriteStream | null = null;
  private isEnabled: boolean = true;
  private lastTimestamp: number;

  constructor() {
    this.startTime = performance.now();
    this.lastTimestamp = this.startTime;
    
    // Create log file in userData directory with timestamp
    const userDataPath = app.getPath('userData');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = path.join(userDataPath, `startup-debug-${timestamp}.log`);
    
    try {
      this.fileStream = fs.createWriteStream(this.logPath, { flags: 'a' });
      this.log('STARTUP_DEBUG_LOGGER', 'Session started');
      this.log('STARTUP_DEBUG_LOGGER', `Log file: ${this.logPath}`);
      this.log('STARTUP_DEBUG_LOGGER', `Platform: ${process.platform}`);
      this.log('STARTUP_DEBUG_LOGGER', `Node version: ${process.version}`);
      this.log('STARTUP_DEBUG_LOGGER', `Electron version: ${process.versions.electron}`);
    } catch (error) {
      console.error('Failed to create startup debug log file:', error);
      this.isEnabled = false;
    }
  }

  /**
   * Log a debug message with timing information.
   * @param category - Category or component name
   * @param message - Debug message
   * @param metadata - Optional metadata to include
   */
  log(category: string, message: string, metadata?: Record<string, unknown>): void {
    if (!this.isEnabled || !this.fileStream) return;

    const now = performance.now();
    const totalElapsed = now - this.startTime;
    const deltaFromLast = now - this.lastTimestamp;
    this.lastTimestamp = now;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      totalElapsedMs: totalElapsed.toFixed(3),
      deltaMs: deltaFromLast.toFixed(3),
      category,
      message,
      ...(metadata && { metadata }),
    };

    try {
      this.fileStream.write(JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write to startup debug log:', error);
    }
  }

  /**
   * Start a timer for measuring a specific operation.
   * @param name - Name of the operation
   * @returns A function to call when the operation completes
   */
  startTimer(name: string): () => void {
    const startTime = performance.now();
    this.log('TIMER_START', name);
    
    return () => {
      const elapsed = performance.now() - startTime;
      this.log('TIMER_END', name, { durationMs: elapsed.toFixed(3) });
    };
  }

  /**
   * Log an async operation with automatic timing.
   * @param category - Category name
   * @param operation - Operation name
   * @param fn - Async function to execute
   * @returns The result of the function
   */
  async measureAsync<T>(category: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const endTimer = this.startTimer(`${category}:${operation}`);
    try {
      const result = await fn();
      endTimer();
      return result;
    } catch (error) {
      this.log(category, `${operation} failed`, { error: String(error) });
      endTimer();
      throw error;
    }
  }

  /**
   * Close the log file stream.
   */
  close(): void {
    if (this.fileStream) {
      const totalTime = performance.now() - this.startTime;
      this.log('STARTUP_DEBUG_LOGGER', 'Session ended', { 
        totalSessionMs: totalTime.toFixed(3) 
      });
      this.fileStream.end();
      this.fileStream = null;
    }
  }

  /**
   * Get the path to the current log file.
   */
  getLogPath(): string {
    return this.logPath;
  }
}

// Singleton instance
let debugLogger: StartupDebugLogger | null = null;

/**
 * Get or create the startup debug logger instance.
 */
export function getStartupDebugLogger(): StartupDebugLogger {
  if (!debugLogger) {
    debugLogger = new StartupDebugLogger();
  }
  return debugLogger;
}

/**
 * Close and reset the debug logger.
 */
export function closeStartupDebugLogger(): void {
  if (debugLogger) {
    debugLogger.close();
    debugLogger = null;
  }
}