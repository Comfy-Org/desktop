/**
 * UV Process Abstraction
 *
 * A clean, modern abstraction for running UV commands with integrated parsing
 * and real-time progress tracking. Replaces the node-pty approach with proper
 * process management using spawn.
 */
import log from 'electron-log/main';
import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { UVParser } from './parser.js';
import { UVStateManager } from './stateManager.js';
import type { UVStage } from './stateManager.js';
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
 * Configuration for UV process
 */
export interface UVProcessConfig {
  /** UV executable path */
  uvPath: string;

  /** UV command (e.g., 'pip', 'venv') */
  command: string;

  /** Arguments for the command */
  args: string[];

  /** Working directory */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Whether to enable verbose/debug output */
  verbose?: boolean;

  /** Optional timeout in milliseconds */
  timeout?: number;

  /** Whether to capture raw output for debugging */
  captureRawOutput?: boolean;
}

/**
 * Result of UV process execution
 */
export interface UVProcessResult {
  /** Exit code of the process */
  exitCode: number;

  /** Signal that terminated the process (if any) */
  signal?: NodeJS.Signals;

  /** Final stage reached */
  finalStage: UVStage;

  /** Whether the process completed successfully */
  success: boolean;

  /** Packages that were installed */
  installedPackages: PackageInfo[];

  /** Packages that were removed */
  removedPackages: PackageInfo[];

  /** Resolution summary if available */
  resolutionSummary?: ResolutionSummary;

  /** Installation summary if available */
  installationSummary?: InstallationSummary;

  /** Preparation summary if available */
  preparationSummary?: PreparationSummary;

  /** Errors encountered */
  errors: WarningOrError[];

  /** Warnings encountered */
  warnings: WarningOrError[];

  /** Duration in milliseconds */
  duration: number;

  /** Raw stdout if captured */
  rawStdout?: string;

  /** Raw stderr if captured */
  rawStderr?: string;
}

/**
 * Events emitted by UVProcess
 */
export interface UVProcessEvents {
  /** Emitted when stage changes */
  'stage-change': (newStage: UVStage, oldStage: UVStage) => void;

  /** Emitted when a line is parsed */
  'output-parsed': (output: UVParsedOutput) => void;

  /** Emitted for raw stdout data */
  stdout: (data: string) => void;

  /** Emitted for raw stderr data */
  stderr: (data: string) => void;

  /** Emitted when a package is resolved */
  'package-resolved': (packageInfo: PackageInfo) => void;

  /** Emitted when a package is downloaded */
  'download-progress': (progress: DownloadProgress) => void;

  /** Emitted when a package is installed */
  'package-installed': (packageInfo: PackageInfo) => void;

  /** Emitted when a package is removed */
  'package-removed': (packageInfo: PackageInfo) => void;

  /** Emitted when an error occurs */
  error: (error: WarningOrError) => void;

  /** Emitted when a warning occurs */
  warning: (warning: WarningOrError) => void;

  /** Emitted when the process completes */
  complete: (result: UVProcessResult) => void;
}

/**
 * UV Process abstraction
 */
export class UVProcess extends EventEmitter {
  private readonly config: UVProcessConfig;
  private readonly parser: UVParser;
  private readonly stateManager: UVStateManager;
  private childProcess?: ChildProcess;
  private startTime?: number;
  private readonly rawStdout?: string[];
  private readonly rawStderr?: string[];
  private timeoutHandle?: NodeJS.Timeout;
  private isDestroyed = false;
  private previousStage: UVStage = 'initializing';

  constructor(config: UVProcessConfig) {
    super();
    this.config = config;
    this.parser = new UVParser();
    this.stateManager = new UVStateManager();

    if (config.captureRawOutput) {
      this.rawStdout = [];
      this.rawStderr = [];
    }
  }

  /**
   * Execute the UV process
   */
  async execute(): Promise<UVProcessResult> {
    if (this.isDestroyed) {
      throw new Error('UVProcess has been destroyed');
    }

    this.startTime = Date.now();

    return new Promise<UVProcessResult>((resolve, reject) => {
      try {
        this.spawn();

        // Set up timeout if configured
        if (this.config.timeout) {
          this.timeoutHandle = setTimeout(() => {
            this.kill('SIGTERM');
            const error = new Error(`UV process timed out after ${this.config.timeout}ms`);
            reject(error);
          }, this.config.timeout);
        }

        // Handle process completion
        this.childProcess!.on('close', (exitCode, signal) => {
          this.cleanup();

          const duration = Date.now() - this.startTime!;
          const summary = this.stateManager.getSummary();

          const result: UVProcessResult = {
            exitCode: exitCode ?? -1,
            signal: signal ?? undefined,
            finalStage: this.stateManager.getCurrentStage(),
            success: exitCode === 0 && !this.stateManager.hasErrors(),
            installedPackages: summary.installedPackages,
            removedPackages: summary.removedPackages,
            resolutionSummary: summary.resolution as ResolutionSummary | undefined,
            installationSummary: summary.installation as InstallationSummary | undefined,
            preparationSummary: summary.preparation as PreparationSummary | undefined,
            errors: this.stateManager.getErrors() as WarningOrError[],
            warnings: this.stateManager.getWarnings() as WarningOrError[],
            duration,
            rawStdout: this.rawStdout?.join('\n'),
            rawStderr: this.rawStderr?.join('\n'),
          };

          this.emit('complete', result);

          if (exitCode === 0) {
            resolve(result);
          } else {
            const error = new Error(`UV process exited with code ${exitCode}`);
            reject(error);
          }
        });

        // Handle process errors
        this.childProcess!.on('error', (error) => {
          this.cleanup();
          reject(error);
        });
      } catch (error) {
        this.cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Kill the process
   */
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.childProcess && !this.childProcess.killed) {
      return this.childProcess.kill(signal);
    }
    return false;
  }

  /**
   * Destroy the process and clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.kill('SIGKILL');
    this.cleanup();
    this.isDestroyed = true;
    this.removeAllListeners();
  }

  /**
   * Spawn the child process
   */
  private spawn(): void {
    const args = this.buildArgs();
    const env = this.buildEnv();

    log.info(`Starting UV process: ${this.config.uvPath} ${args.join(' ')}`);

    this.childProcess = spawn(this.config.uvPath, args, {
      cwd: this.config.cwd || process.cwd(),
      env,
      shell: false,
    });

    // Handle stdout
    this.childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleStdout(text);
    });

    // Handle stderr
    this.childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleStderr(text);
    });
  }

  /**
   * Build command arguments
   */
  private buildArgs(): string[] {
    const args = [this.config.command, ...this.config.args];

    // Add verbose/debug flags if configured
    if (this.config.verbose) {
      // For debugging UV output
      args.unshift('--verbose');
    }

    return args;
  }

  /**
   * Build environment variables
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.env,
    };

    // Enable UV debug output for parsing
    if (this.config.verbose) {
      env.RUST_LOG = 'debug';
      env.UV_LOG_CONTEXT = '1';
    }

    return env;
  }

  /**
   * Handle stdout data
   */
  private handleStdout(data: string): void {
    // Capture raw output if configured
    if (this.rawStdout) {
      this.rawStdout.push(data);
    }

    // Emit raw stdout
    this.emit('stdout', data);

    // Parse line by line
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line);
      }
    }
  }

  /**
   * Handle stderr data
   */
  private handleStderr(data: string): void {
    // Capture raw output if configured
    if (this.rawStderr) {
      this.rawStderr.push(data);
    }

    // Emit raw stderr
    this.emit('stderr', data);

    // UV sometimes outputs to stderr, so parse it too
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line);
      }
    }
  }

  /**
   * Process a single line of output
   */
  private processLine(line: string): void {
    try {
      // Parse the line
      const parsed = this.parser.parseLine(line);

      if (parsed) {
        // Update state manager
        this.stateManager.processLine(line);

        // Check for stage change
        const currentStage = this.stateManager.getCurrentStage();
        if (currentStage !== this.previousStage) {
          this.emit('stage-change', currentStage, this.previousStage);
          this.previousStage = currentStage;
        }

        // Emit parsed output
        this.emit('output-parsed', parsed);

        // Emit specific events based on output type
        switch (parsed.type) {
          case 'resolution':
            if (parsed.package?.name) {
              this.emit('package-resolved', parsed.package);
            }
            break;

          case 'download_progress':
            this.emit('download-progress', parsed);
            break;

          case 'changed_package':
            if (parsed.operation === '+' && parsed.package?.name) {
              this.emit('package-installed', parsed.package);
            } else if (parsed.operation === '-' && parsed.package?.name) {
              this.emit('package-removed', parsed.package);
            }
            break;

          case 'error':
            this.emit('error', parsed);
            break;

          case 'warning':
            this.emit('warning', parsed);
            break;
        }
      }
    } catch (error) {
      log.error('Error processing UV output line:', error);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }

    this.childProcess = undefined;
  }
}

/**
 * Create a UV pip install process
 */
export function createPipInstallProcess(
  uvPath: string,
  options: {
    packages?: string[];
    requirementsFile?: string;
    indexUrl?: string;
    extraIndexUrl?: string;
    indexStrategy?: 'compatible' | 'unsafe-best-match';
    upgrade?: boolean;
    prerelease?: boolean;
    cwd?: string;
    env?: Record<string, string>;
    verbose?: boolean;
    timeout?: number;
  }
): UVProcess {
  const args: string[] = ['install'];

  if (options.upgrade) {
    args.push('-U');
  }

  if (options.prerelease) {
    args.push('--pre');
  }

  if (options.requirementsFile) {
    args.push('-r', options.requirementsFile);
  } else if (options.packages) {
    args.push(...options.packages);
  }

  if (options.indexUrl) {
    args.push('--index-url', options.indexUrl);
  }

  if (options.extraIndexUrl) {
    args.push('--extra-index-url', options.extraIndexUrl);
  }

  if (options.indexStrategy) {
    args.push('--index-strategy', options.indexStrategy);
  }

  return new UVProcess({
    uvPath,
    command: 'pip',
    args,
    cwd: options.cwd,
    env: options.env,
    verbose: options.verbose,
    timeout: options.timeout,
  });
}

/**
 * Create a UV venv process
 */
export function createVenvProcess(
  uvPath: string,
  options: {
    path: string;
    python?: string;
    pythonPreference?: 'only-managed' | 'managed' | 'system' | 'only-system';
    cwd?: string;
    env?: Record<string, string>;
    verbose?: boolean;
    timeout?: number;
  }
): UVProcess {
  const args: string[] = [];

  if (options.python) {
    args.push('--python', options.python);
  }

  if (options.pythonPreference) {
    args.push('--python-preference', options.pythonPreference);
  }

  args.push(options.path);

  return new UVProcess({
    uvPath,
    command: 'venv',
    args,
    cwd: options.cwd,
    env: options.env,
    verbose: options.verbose,
    timeout: options.timeout,
  });
}

/**
 * Create a UV cache clean process
 */
export function createCacheCleanProcess(
  uvPath: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    verbose?: boolean;
    timeout?: number;
  } = {}
): UVProcess {
  return new UVProcess({
    uvPath,
    command: 'cache',
    args: ['clean'],
    cwd: options.cwd,
    env: options.env,
    verbose: options.verbose,
    timeout: options.timeout,
  });
}
