/**
 * UV State Manager Implementation
 *
 * Concrete implementation of UV state management for the application.
 * Manages UV process states and integrates with the parser.
 */
import log from 'electron-log/main';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { UVStateManager } from './state-manager.js';
import type { UVStage } from './state-manager.js';
import type {
  InstallationSummary,
  PackageInfo,
  PreparationSummary,
  ResolutionSummary,
  UVParsedOutput,
  WarningOrError,
} from './types.js';
import type {
  IUVState,
  IUVStateFactory,
  ProcessSummary,
  UVProcessId,
  UVProcessOptions,
  UVProcessState,
  UVProcessStatistics,
  UVProcessStatus,
  UVProcessType,
  UVStateEvents,
} from './uv-state-interfaces.js';

/**
 * Concrete implementation of UV process state
 */
class UVProcessStateImpl implements UVProcessState {
  readonly id: UVProcessId;
  readonly type: UVProcessType;
  status: UVProcessStatus;
  stage: UVStage;
  readonly startedAt: Date;
  endedAt?: Date;
  duration?: number;
  packages: Map<string, PackageInfo>;
  statistics: UVProcessStatistics;
  errors: WarningOrError[];
  warnings: WarningOrError[];
  resolutionSummary?: ResolutionSummary;
  preparationSummary?: PreparationSummary;
  installationSummary?: InstallationSummary;
  installedPackages: PackageInfo[];
  removedPackages: PackageInfo[];
  rawOutput?: string[];
  parsedOutputs: UVParsedOutput[];

  private readonly stateManager: UVStateManager;
  private readonly maxParsedOutputs: number;
  private readonly storeRawOutput: boolean;

  constructor(options: UVProcessOptions) {
    this.id = options.id || randomUUID();
    this.type = options.type;
    this.status = 'starting';
    this.stage = 'initializing';
    this.startedAt = new Date();
    this.packages = new Map();
    this.statistics = {
      linesProcessed: 0,
      linesParsed: 0,
      packagesResolved: 0,
      packagesDownloaded: 0,
      packagesInstalled: 0,
      packagesRemoved: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    this.errors = [];
    this.warnings = [];
    this.installedPackages = [];
    this.removedPackages = [];
    this.parsedOutputs = [];

    this.stateManager = new UVStateManager();
    this.maxParsedOutputs = options.maxParsedOutputs || 1000;
    this.storeRawOutput = options.storeRawOutput || false;

    if (this.storeRawOutput) {
      this.rawOutput = [];
    }
  }

  /**
   * Process a line of output
   */
  processLine(line: string): UVParsedOutput | undefined {
    if (this.storeRawOutput) {
      this.rawOutput?.push(line);
    }

    const output = this.stateManager.processLine(line);

    if (output) {
      // Limit stored parsed outputs
      if (this.parsedOutputs.length >= this.maxParsedOutputs) {
        this.parsedOutputs.shift();
      }
      this.parsedOutputs.push(output);

      // Update our state based on the output
      this.updateFromOutput(output);
    }

    // Update statistics
    const stats = this.stateManager.getStatistics();
    this.statistics = {
      ...this.statistics,
      ...stats,
    };

    // Update stage
    const newStage = this.stateManager.getCurrentStage();
    if (newStage !== this.stage) {
      this.stage = newStage;
    }

    // Update status
    if (this.status === 'starting') {
      this.status = 'running';
    }

    return output;
  }

  /**
   * Update state from parsed output
   */
  private updateFromOutput(output: UVParsedOutput): void {
    switch (output.type) {
      case 'error':
        this.errors.push(output);
        break;

      case 'warning':
        this.warnings.push(output);
        break;

      case 'resolution_summary':
        this.resolutionSummary = output;
        break;

      case 'preparation_summary':
        this.preparationSummary = output;
        break;

      case 'installation_summary':
        this.installationSummary = output;
        break;

      case 'changed_package':
        if (output.operation === '+') {
          this.installedPackages.push(output.package);
        } else {
          this.removedPackages.push(output.package);
        }
        break;

      case 'install_plan':
      case 'resolution':
      case 'download_progress':
        if (output.package.name) {
          this.packages.set(output.package.name, output.package);
        }
        break;
    }
  }

  /**
   * Mark the process as completed
   */
  complete(): void {
    this.status = 'completed';
    this.endedAt = new Date();
    this.duration = this.endedAt.getTime() - this.startedAt.getTime();

    // Get final state from state manager
    const summary = this.stateManager.getSummary();
    this.installedPackages = summary.installedPackages;
    this.removedPackages = summary.removedPackages;
    this.statistics.packagesInstalled = summary.installedPackages.length;
    this.statistics.packagesRemoved = summary.removedPackages.length;
  }

  /**
   * Mark the process as failed
   */
  fail(error: Error): void {
    this.status = 'failed';
    this.endedAt = new Date();
    this.duration = this.endedAt.getTime() - this.startedAt.getTime();

    // Add error to errors list
    this.errors.push({
      type: 'error',
      severity: 'error',
      message: error.message,
      context: {
        name: error.name,
        stack: error.stack,
      },
    });
  }

  /**
   * Cancel the process
   */
  cancel(): void {
    this.status = 'cancelled';
    this.endedAt = new Date();
    this.duration = this.endedAt.getTime() - this.startedAt.getTime();
  }
}

/**
 * Concrete implementation of UV state manager
 */
export class UVState extends EventEmitter<UVStateEvents> implements IUVState {
  private readonly processMap = new Map<UVProcessId, UVProcessStateImpl>();
  private _activeProcess?: UVProcessStateImpl;

  get activeProcess(): UVProcessState | undefined {
    return this._activeProcess;
  }

  get isRunning(): boolean {
    return this._activeProcess !== undefined;
  }

  get processes(): Map<UVProcessId, UVProcessState> {
    return new Map(this.processMap);
  }

  get runningCount(): number {
    let count = 0;
    for (const process of this.processMap.values()) {
      if (process.status === 'running' || process.status === 'starting') {
        count++;
      }
    }
    return count;
  }

  startProcess(options: UVProcessOptions): UVProcessState {
    // For now, we only support one active process at a time
    // This matches the current UV usage pattern in the app
    if (this._activeProcess && this._activeProcess.status === 'running') {
      log.warn('Attempting to start UV process while another is running');
      throw new Error('Another UV process is already running');
    }

    const process = new UVProcessStateImpl(options);
    this.processMap.set(process.id, process);
    this._activeProcess = process;

    log.info(`Starting UV process: ${process.id} (${process.type})`);
    this.emit('process:start', process);

    return process;
  }

  processLine(processId: UVProcessId, line: string): UVParsedOutput | undefined {
    const process = this.processMap.get(processId);
    if (!process) {
      log.warn(`Process not found: ${processId}`);
      return undefined;
    }

    const oldStage = process.stage;
    const output = process.processLine(line);

    // Emit stage change event if stage changed
    if (process.stage !== oldStage) {
      this.emit('stage:change', processId, process.stage, oldStage);
    }

    // Emit output events
    if (output) {
      this.emit('output:parsed', processId, output);

      // Emit specific events based on output type
      switch (output.type) {
        case 'download_progress':
          this.emit('download:progress', processId, output);
          break;
        case 'resolution':
          if (output.package.name) {
            this.emit('package:resolved', processId, output.package);
          }
          break;
        case 'changed_package':
          if (output.operation === '+' && output.package.name) {
            this.emit('package:installed', processId, output.package);
          }
          break;
        case 'error':
          this.emit('process:error', processId, output);
          break;
        case 'warning':
          this.emit('process:warning', processId, output);
          break;
      }
    }

    return output;
  }

  processLines(processId: UVProcessId, lines: string[]): UVParsedOutput[] {
    const results: UVParsedOutput[] = [];
    for (const line of lines) {
      const output = this.processLine(processId, line);
      if (output) {
        results.push(output);
      }
    }
    return results;
  }

  completeProcess(processId: UVProcessId): void {
    const process = this.processMap.get(processId);
    if (!process) {
      log.warn(`Process not found: ${processId}`);
      return;
    }

    process.complete();

    if (this._activeProcess === process) {
      this._activeProcess = undefined;
    }

    log.info(`UV process completed: ${processId} (${process.type}) - ${process.duration}ms`);
    this.emit('process:complete', process);

    // Check if all processes are idle
    if (this.runningCount === 0) {
      this.emit('all:idle');
    }
  }

  failProcess(processId: UVProcessId, error: Error): void {
    const process = this.processMap.get(processId);
    if (!process) {
      log.warn(`Process not found: ${processId}`);
      return;
    }

    process.fail(error);

    if (this._activeProcess === process) {
      this._activeProcess = undefined;
    }

    log.error(`UV process failed: ${processId} (${process.type})`, error);
    this.emit('process:failed', processId, error);

    // Check if all processes are idle
    if (this.runningCount === 0) {
      this.emit('all:idle');
    }
  }

  cancelProcess(processId: UVProcessId): void {
    const process = this.processMap.get(processId);
    if (!process) {
      log.warn(`Process not found: ${processId}`);
      return;
    }

    process.cancel();

    if (this._activeProcess === process) {
      this._activeProcess = undefined;
    }

    log.info(`UV process cancelled: ${processId} (${process.type})`);
    this.emit('process:cancelled', processId);

    // Check if all processes are idle
    if (this.runningCount === 0) {
      this.emit('all:idle');
    }
  }

  getProcess(processId: UVProcessId): UVProcessState | undefined {
    return this.processMap.get(processId);
  }

  getRunningProcesses(): UVProcessState[] {
    const running: UVProcessState[] = [];
    for (const process of this.processMap.values()) {
      if (process.status === 'running' || process.status === 'starting') {
        running.push(process);
      }
    }
    return running;
  }

  getCompletedProcesses(): UVProcessState[] {
    const completed: UVProcessState[] = [];
    for (const process of this.processMap.values()) {
      if (process.status === 'completed') {
        completed.push(process);
      }
    }
    return completed;
  }

  getFailedProcesses(): UVProcessState[] {
    const failed: UVProcessState[] = [];
    for (const process of this.processMap.values()) {
      if (process.status === 'failed') {
        failed.push(process);
      }
    }
    return failed;
  }

  clearCompletedProcesses(keepCount = 10): void {
    const completed = this.getCompletedProcesses();
    const failed = this.getFailedProcesses();
    const cancelled = [...this.processMap.values()].filter((p) => p.status === 'cancelled');

    const toRemove = [...completed, ...failed, ...cancelled]
      .sort((a, b) => (b.endedAt?.getTime() || 0) - (a.endedAt?.getTime() || 0))
      .slice(keepCount);

    for (const process of toRemove) {
      this.processMap.delete(process.id);
    }
  }

  getProcessSummary(processId: UVProcessId): ProcessSummary | undefined {
    const process = this.processMap.get(processId);
    if (!process) {
      return undefined;
    }

    return {
      id: process.id,
      type: process.type,
      status: process.status,
      finalStage: process.stage,
      duration: process.duration || 0,
      statistics: process.statistics,
      errorCount: process.errors.length,
      warningCount: process.warnings.length,
      installedPackages: process.installedPackages,
      removedPackages: process.removedPackages,
      success: process.status === 'completed' && process.errors.length === 0,
    };
  }

  reset(): void {
    // Cancel any running processes
    for (const process of this.processMap.values()) {
      if (process.status === 'running' || process.status === 'starting') {
        this.cancelProcess(process.id);
      }
    }

    // Clear all processes
    this.processMap.clear();
    this._activeProcess = undefined;

    log.info('UV state reset');
  }
}

/**
 * UV state factory implementation
 */
class UVStateFactoryImpl implements IUVStateFactory {
  private static instance?: UVState;

  createUVState(): IUVState {
    return new UVState();
  }

  getUVState(): IUVState {
    if (!UVStateFactoryImpl.instance) {
      UVStateFactoryImpl.instance = new UVState();
    }
    return UVStateFactoryImpl.instance;
  }
}

// Export factory instance
export const uvStateFactory = new UVStateFactoryImpl();

// Export convenience function for getting singleton
export function getUVState(): IUVState {
  return uvStateFactory.getUVState();
}
