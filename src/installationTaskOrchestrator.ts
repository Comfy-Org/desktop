import log from 'electron-log/main';
import { EventEmitter } from 'node:events';

import type { InstallationTask, OrchestrationStatus, UvInstallStatus } from './preload';
import type { UvInstallationState } from './uvInstallationState';
import type { ProcessCallbacks, VirtualEnvironment } from './virtualEnvironment';

// Re-export types for convenience
export type { InstallationTask, OrchestrationStatus } from './preload';

/**
 * Orchestrates multi-step installation processes with progress tracking.
 *
 * This class provides high-level task management on top of the existing
 * UvInstallationState system, giving users context about current and upcoming tasks.
 */
export class InstallationTaskOrchestrator extends EventEmitter {
  private tasks: InstallationTask[] = [];
  private currentTaskIndex = -1;
  private isExecuting = false;
  private uvInstallationState?: UvInstallationState;
  private currentTaskStartTime = 0;
  private taskStartTimes: number[] = [];

  constructor() {
    super();
  }

  /**
   * Sets the UV installation state manager for detailed progress tracking
   */
  setUvInstallationState(uvState: UvInstallationState): void {
    // Remove existing listener if any
    if (this.uvInstallationState) {
      this.uvInstallationState.removeAllListeners('statusChange');
    }

    this.uvInstallationState = uvState;

    // Listen for UV status updates and forward them with task context
    uvState.on('statusChange', (status: UvInstallStatus) => {
      this.handleUvStatusChange(status);
    });
  }

  /**
   * Configures the tasks to be executed in sequence
   */
  setTasks(tasks: InstallationTask[]): void {
    if (this.isExecuting) {
      throw new Error('Cannot set tasks while orchestration is running');
    }

    this.tasks = [...tasks];
    this.currentTaskIndex = -1;
    this.taskStartTimes = [];

    log.info(`Orchestrator configured with ${tasks.length} tasks:`, tasks.map((t) => t.name).join(' → '));
  }

  /**
   * Executes all configured tasks in sequence
   */
  async execute(): Promise<void> {
    if (this.isExecuting) {
      throw new Error('Orchestration already in progress');
    }

    if (this.tasks.length === 0) {
      throw new Error('No tasks configured for orchestration');
    }

    this.isExecuting = true;
    this.currentTaskIndex = -1;

    try {
      log.info('Starting installation orchestration');

      for (let i = 0; i < this.tasks.length; i++) {
        await this.executeTask(i);
      }

      log.info('Installation orchestration completed successfully');
      this.emitOrchestrationStatus({
        isComplete: true,
        overallProgress: 100,
      });
    } catch (error) {
      log.error('Installation orchestration failed:', error);
      this.emitOrchestrationStatus({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Gets the current orchestration status
   */
  getCurrentStatus(): OrchestrationStatus | null {
    if (this.tasks.length === 0) return null;

    const currentTask = this.currentTaskIndex >= 0 ? this.tasks[this.currentTaskIndex] : null;

    if (!currentTask) return null;

    return {
      currentTask,
      allTasks: [...this.tasks],
      currentTaskIndex: this.currentTaskIndex,
      totalTasks: this.tasks.length,
      overallProgress: this.calculateOverallProgress(),
      taskProgress: this.uvInstallationState?.getCurrentState() || undefined,
      isComplete: false,
    };
  }

  /**
   * Executes a single task with proper error handling and progress tracking
   */
  private async executeTask(taskIndex: number): Promise<void> {
    const task = this.tasks[taskIndex];
    this.currentTaskIndex = taskIndex;
    this.currentTaskStartTime = Date.now();
    this.taskStartTimes[taskIndex] = this.currentTaskStartTime;

    log.info(`Starting task ${taskIndex + 1}/${this.tasks.length}: ${task.name}`);

    // Reset UV state for new task
    this.uvInstallationState?.reset();

    // Emit task started status
    this.emitOrchestrationStatus();

    try {
      // Create process callbacks that integrate with our orchestration
      const orchestratedCallbacks = this.createOrchestratedCallbacks();

      // Execute the task
      await task.execute(orchestratedCallbacks);

      log.info(`Completed task: ${task.name}`);

      // Brief pause to ensure final status is sent
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      log.error(`Task failed: ${task.name}`, error);
      throw new Error(`Task "${task.name}" failed: ${error}`);
    }
  }

  /**
   * Creates ProcessCallbacks that integrate with our orchestration system
   */
  private createOrchestratedCallbacks(): ProcessCallbacks {
    return {
      onStdout: (data: string) => {
        // Log raw output for debugging
        log.debug(`Task stdout: ${data}`);
      },
      onStderr: (data: string) => {
        // Log errors
        log.error(`Task stderr: ${data}`);
      },
      uvInstallationState: this.uvInstallationState,
    };
  }

  /**
   * Handles UV status changes and adds orchestration context
   */
  private handleUvStatusChange(status: UvInstallStatus): void {
    // Add task context to the status and emit
    this.emitOrchestrationStatus({ taskProgress: status });
  }

  /**
   * Calculates overall progress across all tasks
   */
  private calculateOverallProgress(): number {
    if (this.tasks.length === 0) return 0;

    // Simple progress: completed tasks + current task progress
    const completedTasks = Math.max(0, this.currentTaskIndex);
    const currentTaskProgress = this.getCurrentTaskProgress();

    const totalProgress = (completedTasks + currentTaskProgress) / this.tasks.length;
    return Math.min(100, Math.max(0, Math.round(totalProgress * 100)));
  }

  /**
   * Gets progress of current task (0-1)
   */
  private getCurrentTaskProgress(): number {
    const uvStatus = this.uvInstallationState?.getCurrentState();

    if (!uvStatus) return 0;

    // Map UV phases to rough progress percentages
    switch (uvStatus.phase) {
      case 'idle':
      case 'started':
        return 0;
      case 'reading_requirements':
        return 0.1;
      case 'resolving':
        return 0.2;
      case 'resolved':
        return 0.3;
      case 'preparing_download':
        return 0.4;
      case 'downloading':
        // Use download progress if available
        if (uvStatus.totalBytes && uvStatus.downloadedBytes) {
          const downloadProgress = uvStatus.downloadedBytes / uvStatus.totalBytes;
          return 0.4 + downloadProgress * 0.4; // Download is 40% of task
        }
        return 0.5;
      case 'prepared':
        return 0.8;
      case 'installing':
        return 0.9;
      case 'installed':
        return 1;
      case 'error':
        return 0; // Error state
      default:
        return 0.5;
    }
  }

  /**
   * Emits orchestration status with optional overrides
   */
  private emitOrchestrationStatus(overrides: Partial<OrchestrationStatus> = {}): void {
    const status = this.getCurrentStatus();
    if (!status) return;

    const finalStatus = { ...status, ...overrides };
    this.emit('orchestrationStatus', finalStatus);
  }

  /**
   * Type-safe event emission
   */
  emit(event: 'orchestrationStatus', status: OrchestrationStatus): boolean {
    return super.emit(event, status);
  }

  /**
   * Type-safe event listener
   */
  on(event: 'orchestrationStatus', listener: (status: OrchestrationStatus) => void): this {
    return super.on(event, listener);
  }
}

/**
 * Factory function to create installation orchestrator for ComfyUI requirements
 */
export function createComfyUIInstallationOrchestrator(
  virtualEnvironment: VirtualEnvironment
): InstallationTaskOrchestrator {
  const orchestrator = new InstallationTaskOrchestrator();

  const tasks: InstallationTask[] = [
    {
      id: 'torch',
      name: 'PyTorch Dependencies',
      description: 'Installing PyTorch and CUDA dependencies',
      execute: (callbacks) => virtualEnvironment.installPytorch(callbacks),
      optional: true,
      estimatedDuration: 180, // 3 minutes
    },
    {
      id: 'comfyui-requirements',
      name: 'ComfyUI Requirements',
      description: 'Installing ComfyUI core dependencies',
      execute: (callbacks) => virtualEnvironment.installComfyUIRequirements(callbacks),
      estimatedDuration: 120, // 2 minutes
    },
    {
      id: 'manager-requirements',
      name: 'Manager Requirements',
      description: 'Installing ComfyUI Manager dependencies',
      execute: (callbacks) => virtualEnvironment.installComfyUIManagerRequirements(callbacks),
      estimatedDuration: 60, // 1 minute
    },
  ];

  orchestrator.setTasks(tasks);
  return orchestrator;
}
