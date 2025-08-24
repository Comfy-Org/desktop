/**
 * Test suite for InstallationTaskOrchestrator
 * 
 * Tests the orchestration of multi-step installation processes with proper
 * progress tracking and frontend communication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InstallationTaskOrchestrator, createComfyUIInstallationOrchestrator } from '../../src/installationTaskOrchestrator';
import type { InstallationTask, OrchestrationStatus } from '../../src/preload';
import { UvInstallationState } from '../../src/uvInstallationState';

describe('InstallationTaskOrchestrator', () => {
  let orchestrator: InstallationTaskOrchestrator;
  let mockUvState: UvInstallationState;

  beforeEach(() => {
    orchestrator = new InstallationTaskOrchestrator();
    mockUvState = new UvInstallationState();
  });

  describe('Task Configuration', () => {
    it('should configure tasks correctly', () => {
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'First Task',
          description: 'First task description',
          execute: vi.fn().mockResolvedValue(undefined),
        },
        {
          id: 'task2', 
          name: 'Second Task',
          description: 'Second task description',
          execute: vi.fn().mockResolvedValue(undefined),
          optional: true,
          estimatedDuration: 120,
        },
      ];

      orchestrator.setTasks(tasks);
      
      const status = orchestrator.getCurrentStatus();
      expect(status).toBeNull(); // No current task before execution
    });

    it('should not allow task configuration during execution', async () => {
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Task 1',
          description: 'Description',
          execute: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100))),
        },
      ];

      orchestrator.setTasks(tasks);
      
      // Start execution (don't await to test concurrent access)
      const executionPromise = orchestrator.execute();
      
      // Try to set tasks during execution
      expect(() => orchestrator.setTasks([])).toThrow('Cannot set tasks while orchestration is running');
      
      await executionPromise;
    });

    it('should throw error if no tasks configured for execution', async () => {
      await expect(orchestrator.execute()).rejects.toThrow('No tasks configured for orchestration');
    });
  });

  describe('UV Installation State Integration', () => {
    it('should set UV installation state correctly', async () => {
      // First configure tasks so orchestrator can emit status
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Test Task',
          description: 'Test description',
          execute: vi.fn().mockResolvedValue(undefined),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);
      
      // Verify state is connected by triggering a status change during execution
      const statusUpdateSpy = vi.fn();
      orchestrator.on('orchestrationStatus', statusUpdateSpy);
      
      // Start execution to enable status updates
      const executionPromise = orchestrator.execute();
      
      // Brief delay to let execution start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Simulate UV status change
      mockUvState.updateFromUvStatus({
        phase: 'downloading',
        message: 'Downloading package',
      });

      await executionPromise;

      // The orchestrator should have emitted status updates
      expect(statusUpdateSpy).toHaveBeenCalled();
    });

    it('should handle UV status changes during execution', async () => {
      const task1Execute = vi.fn().mockImplementation(async (callbacks) => {
        // Simulate task execution triggering UV status updates
        if (callbacks?.uvInstallationState) {
          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'downloading',
            message: 'Downloading numpy',
            currentPackage: 'numpy',
          });
          
          await new Promise(resolve => setTimeout(resolve, 50));
          
          callbacks.uvInstallationState.updateFromUvStatus({
            phase: 'installed',
            message: 'Installation complete',
          });
        }
      });

      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Install Packages',
          description: 'Install Python packages',
          execute: task1Execute,
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);
      
      const statusUpdates: OrchestrationStatus[] = [];
      orchestrator.on('orchestrationStatus', (status) => {
        statusUpdates.push({ ...status });
      });

      await orchestrator.execute();

      expect(task1Execute).toHaveBeenCalledWith({
        onStdout: expect.any(Function),
        onStderr: expect.any(Function),
        uvInstallationState: mockUvState,
      });

      expect(statusUpdates.length).toBeGreaterThan(0);
      expect(statusUpdates.some(s => s.taskProgress?.phase === 'downloading')).toBe(true);
    });
  });

  describe('Task Execution', () => {
    it('should execute tasks in sequence', async () => {
      const executionOrder: string[] = [];
      
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'First Task',
          description: 'First task',
          execute: vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            executionOrder.push('task1');
          }),
        },
        {
          id: 'task2',
          name: 'Second Task', 
          description: 'Second task',
          execute: vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 30));
            executionOrder.push('task2');
          }),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);
      
      await orchestrator.execute();

      expect(executionOrder).toEqual(['task1', 'task2']);
    });

    it('should emit orchestration status updates during execution', async () => {
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Test Task',
          description: 'Test description',
          execute: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100))),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);

      const statusUpdates: OrchestrationStatus[] = [];
      orchestrator.on('orchestrationStatus', (status) => {
        statusUpdates.push({ ...status });
      });

      await orchestrator.execute();

      // Should have at least task start and completion status
      expect(statusUpdates.length).toBeGreaterThanOrEqual(2);
      
      const finalStatus = statusUpdates[statusUpdates.length - 1];
      expect(finalStatus.isComplete).toBe(true);
      expect(finalStatus.overallProgress).toBe(100);
    });

    it('should handle task execution errors', async () => {
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Failing Task',
          description: 'This task will fail',
          execute: vi.fn().mockRejectedValue(new Error('Task failed')),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);

      await expect(orchestrator.execute()).rejects.toThrow('Task "Failing Task" failed: Error: Task failed');
    });

    it('should reset UV state for each task', async () => {
      const resetSpy = vi.spyOn(mockUvState, 'reset');
      
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'First Task',
          description: 'First',
          execute: vi.fn().mockResolvedValue(undefined),
        },
        {
          id: 'task2',
          name: 'Second Task',
          description: 'Second', 
          execute: vi.fn().mockResolvedValue(undefined),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);

      await orchestrator.execute();

      expect(resetSpy).toHaveBeenCalledTimes(2); // Once per task
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate overall progress correctly', async () => {
      const tasks: InstallationTask[] = [
        {
          id: 'task1',
          name: 'Task 1',
          description: 'First task',
          execute: vi.fn().mockImplementation(async (callbacks) => {
            // Simulate task progress
            if (callbacks?.uvInstallationState) {
              callbacks.uvInstallationState.updateFromUvStatus({
                phase: 'downloading',
                message: 'Downloading...',
              });
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }),
        },
        {
          id: 'task2',
          name: 'Task 2',
          description: 'Second task',
          execute: vi.fn().mockResolvedValue(undefined),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);

      const progressValues: number[] = [];
      orchestrator.on('orchestrationStatus', (status) => {
        progressValues.push(status.overallProgress);
      });

      await orchestrator.execute();

      // Progress should increase and end at 100%
      expect(Math.max(...progressValues)).toBe(100);
      expect(progressValues[0]).toBeLessThan(progressValues[progressValues.length - 1]);
    });

    it('should map UV phases to task progress correctly', async () => {
      const task = {
        id: 'test',
        name: 'Test Task',
        description: 'Test',
        execute: vi.fn().mockImplementation(async (callbacks) => {
          if (!callbacks?.uvInstallationState) return;
          
          const phases = ['started', 'resolving', 'downloading', 'installing', 'installed'];
          for (const phase of phases) {
            callbacks.uvInstallationState.updateFromUvStatus({
              phase: phase as any,
              message: `Phase: ${phase}`,
            });
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }),
      };

      orchestrator.setTasks([task]);
      orchestrator.setUvInstallationState(mockUvState);

      const statusUpdates: OrchestrationStatus[] = [];
      orchestrator.on('orchestrationStatus', (status) => {
        statusUpdates.push({ ...status });
      });

      await orchestrator.execute();

      // Verify progress increases with each phase
      const progressValues = statusUpdates.map(s => s.overallProgress);
      const uniqueProgress = [...new Set(progressValues)];
      expect(uniqueProgress.length).toBeGreaterThan(1);
    });
  });

  describe('Concurrent Execution Protection', () => {
    it('should prevent concurrent executions', async () => {
      const tasks: InstallationTask[] = [
        {
          id: 'slow-task',
          name: 'Slow Task',
          description: 'Takes time',
          execute: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200))),
        },
      ];

      orchestrator.setTasks(tasks);
      orchestrator.setUvInstallationState(mockUvState);

      // Start first execution
      const firstExecution = orchestrator.execute();
      
      // Try to start second execution
      await expect(orchestrator.execute()).rejects.toThrow('Orchestration already in progress');

      // Wait for first to complete
      await firstExecution;
      
      // Now second execution should work
      await expect(orchestrator.execute()).resolves.not.toThrow();
    });
  });
});

describe('createComfyUIInstallationOrchestrator', () => {
  let mockVirtualEnvironment: any;

  beforeEach(() => {
    mockVirtualEnvironment = {
      installTorch: vi.fn().mockResolvedValue(undefined),
      installComfyUIRequirements: vi.fn().mockResolvedValue(undefined),
      installComfyUIManagerRequirements: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should create orchestrator with correct tasks', () => {
    const orchestrator = createComfyUIInstallationOrchestrator(mockVirtualEnvironment);
    
    const status = orchestrator.getCurrentStatus();
    expect(status).toBeNull(); // No current task before execution
  });

  it('should execute ComfyUI installation sequence', async () => {
    const orchestrator = createComfyUIInstallationOrchestrator(mockVirtualEnvironment);
    const uvState = new UvInstallationState();
    orchestrator.setUvInstallationState(uvState);

    const statusUpdates: OrchestrationStatus[] = [];
    orchestrator.on('orchestrationStatus', (status) => {
      statusUpdates.push({ ...status });
    });

    await orchestrator.execute();

    // Verify all methods were called
    expect(mockVirtualEnvironment.installTorch).toHaveBeenCalled();
    expect(mockVirtualEnvironment.installComfyUIRequirements).toHaveBeenCalled();
    expect(mockVirtualEnvironment.installComfyUIManagerRequirements).toHaveBeenCalled();

    // Verify task sequence
    const taskNames = statusUpdates.map(s => s.currentTask?.name).filter(Boolean);
    const uniqueTaskNames = [...new Set(taskNames)];
    
    expect(uniqueTaskNames).toContain('PyTorch Dependencies');
    expect(uniqueTaskNames).toContain('ComfyUI Requirements');
    expect(uniqueTaskNames).toContain('Manager Requirements');
  });

  it('should pass callbacks correctly to virtual environment methods', async () => {
    const orchestrator = createComfyUIInstallationOrchestrator(mockVirtualEnvironment);
    const uvState = new UvInstallationState();
    orchestrator.setUvInstallationState(uvState);

    await orchestrator.execute();

    // Verify each method received proper callbacks
    expect(mockVirtualEnvironment.installTorch).toHaveBeenCalledWith({
      onStdout: expect.any(Function),
      onStderr: expect.any(Function),
      uvInstallationState: uvState,
    });

    expect(mockVirtualEnvironment.installComfyUIRequirements).toHaveBeenCalledWith({
      onStdout: expect.any(Function),
      onStderr: expect.any(Function),
      uvInstallationState: uvState,
    });

    expect(mockVirtualEnvironment.installComfyUIManagerRequirements).toHaveBeenCalledWith({
      onStdout: expect.any(Function),
      onStderr: expect.any(Function),
      uvInstallationState: uvState,
    });
  });

  it('should handle task failures correctly', async () => {
    // Make the second task fail
    mockVirtualEnvironment.installComfyUIRequirements.mockRejectedValue(new Error('Install failed'));

    const orchestrator = createComfyUIInstallationOrchestrator(mockVirtualEnvironment);
    const uvState = new UvInstallationState();
    orchestrator.setUvInstallationState(uvState);

    await expect(orchestrator.execute()).rejects.toThrow('ComfyUI Requirements');

    // First task should have been called
    expect(mockVirtualEnvironment.installTorch).toHaveBeenCalled();
    
    // Failed task should have been called
    expect(mockVirtualEnvironment.installComfyUIRequirements).toHaveBeenCalled();
    
    // Third task should NOT have been called
    expect(mockVirtualEnvironment.installComfyUIManagerRequirements).not.toHaveBeenCalled();
  });
});