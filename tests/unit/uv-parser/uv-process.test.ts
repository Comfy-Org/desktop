/**
 * Tests for UVProcess class
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UVStage } from '@/uv-parser/state-manager';
import { UVProcess, createCacheCleanProcess, createPipInstallProcess, createVenvProcess } from '@/uv-parser/uv-process';
import type { UVProcessConfig } from '@/uv-parser/uv-process';

// Mock child_process spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock electron-log
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('UVProcess', () => {
  let mockChildProcess: any;

  beforeEach(() => {
    // Create mock child process
    mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn(() => true);
    mockChildProcess.killed = false;
    mockChildProcess.pid = 12_345;

    // Set up spawn mock
    vi.mocked(spawn).mockReturnValue(mockChildProcess);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      const config: UVProcessConfig = {
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      };

      const process = new UVProcess(config);
      expect(process).toBeInstanceOf(UVProcess);
      expect(process).toBeInstanceOf(EventEmitter);
    });
  });

  describe('execute', () => {
    it('should spawn process with correct arguments', async () => {
      const config: UVProcessConfig = {
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
        cwd: '/project',
        env: { CUSTOM_VAR: 'value' },
      };

      const process = new UVProcess(config);
      const promise = process.execute();

      // Verify spawn was called correctly
      expect(spawn).toHaveBeenCalledWith(
        '/path/to/uv',
        ['pip', 'install', 'numpy'],
        expect.objectContaining({
          cwd: '/project',
          env: expect.objectContaining({
            CUSTOM_VAR: 'value',
          }),
          shell: false,
        })
      );

      // Simulate process completion
      setImmediate(() => {
        mockChildProcess.emit('close', 0, null);
      });

      const result = await promise;
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should add verbose flags when configured', () => {
      const config: UVProcessConfig = {
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
        verbose: true,
      };

      const process = new UVProcess(config);
      void process.execute();

      expect(spawn).toHaveBeenCalledWith(
        '/path/to/uv',
        ['--verbose', 'pip', 'install', 'numpy'],
        expect.objectContaining({
          env: expect.objectContaining({
            RUST_LOG: 'debug',
            UV_LOG_CONTEXT: '1',
          }),
        })
      );

      // Clean up
      mockChildProcess.emit('close', 0, null);
    });

    it('should reject on non-zero exit code', async () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'invalid-package'],
      });

      const promise = process.execute();

      // Simulate process failure
      setImmediate(() => {
        mockChildProcess.emit('close', 1, null);
      });

      await expect(promise).rejects.toThrow('UV process exited with code 1');
    });

    it('should handle process errors', async () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      const promise = process.execute();

      // Simulate process error
      const error = new Error('spawn error');
      setImmediate(() => {
        mockChildProcess.emit('error', error);
      });

      await expect(promise).rejects.toThrow('spawn error');
    });

    it('should handle timeout', async () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
        timeout: 100,
      });

      const promise = process.execute();

      // Wait for timeout
      await expect(promise).rejects.toThrow('UV process timed out after 100ms');
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should capture raw output when configured', async () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
        captureRawOutput: true,
      });

      const promise = process.execute();

      // Emit some output
      mockChildProcess.stdout.emit('data', Buffer.from('stdout line 1\n'));
      mockChildProcess.stdout.emit('data', Buffer.from('stdout line 2\n'));
      mockChildProcess.stderr.emit('data', Buffer.from('stderr line 1\n'));

      // Complete process
      setImmediate(() => {
        mockChildProcess.emit('close', 0, null);
      });

      const result = await promise;
      expect(result.rawStdout).toContain('stdout line 1');
      expect(result.rawStdout).toContain('stdout line 2');
      expect(result.rawStderr).toContain('stderr line 1');
    });
  });

  describe('event emission', () => {
    it('should emit stdout events', () =>
      new Promise<void>((resolve) => {
        const process = new UVProcess({
          uvPath: '/path/to/uv',
          command: 'pip',
          args: ['install', 'numpy'],
        });

        process.on('stdout', (data) => {
          expect(data).toBe('test output\n');
          resolve();
        });

        void process.execute();
        mockChildProcess.stdout.emit('data', Buffer.from('test output\n'));
      }));

    it('should emit parsed output events', () =>
      new Promise<void>((resolve) => {
        const process = new UVProcess({
          uvPath: '/path/to/uv',
          command: 'pip',
          args: ['install', 'numpy'],
        });

        process.on('output-parsed', (output) => {
          expect(output).toBeDefined();
          resolve();
        });

        void process.execute();

        // Emit a parseable line (final package installation)
        mockChildProcess.stdout.emit('data', Buffer.from(' + numpy==1.24.0\n'));
      }));

    it('should emit stage change events', () =>
      new Promise<void>((resolve) => {
        const process = new UVProcess({
          uvPath: '/path/to/uv',
          command: 'pip',
          args: ['install', 'numpy'],
        });

        let stageChangeCount = 0;
        process.on('stage-change', (newStage: UVStage, oldStage: UVStage) => {
          stageChangeCount++;
          if (stageChangeCount === 1) {
            expect(oldStage).toBe('initializing');
            expect(newStage).toBe('startup');
          }
          resolve();
        });

        void process.execute();

        // Emit UV startup message
        mockChildProcess.stdout.emit('data', Buffer.from('    0.000172s DEBUG uv uv 0.7.9 (13a86a23b 2025-05-30)\n'));
      }));

    it('should emit package-installed events', () =>
      new Promise<void>((resolve) => {
        const process = new UVProcess({
          uvPath: '/path/to/uv',
          command: 'pip',
          args: ['install', 'numpy'],
        });

        process.on('package-installed', (pkg) => {
          expect(pkg.name).toBe('numpy');
          expect(pkg.version).toBe('1.24.0');
          resolve();
        });

        void process.execute();

        // Emit final package list
        mockChildProcess.stdout.emit('data', Buffer.from(' + numpy==1.24.0\n'));
      }));
  });

  describe('kill', () => {
    it('should kill the child process', () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      void process.execute();
      const result = process.kill('SIGTERM');

      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should return false if no process is running', () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      const result = process.kill();
      expect(result).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      void process.execute();
      process.destroy();

      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should prevent multiple destroys', () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      void process.execute();
      process.destroy();
      process.destroy(); // Second call should be no-op

      expect(mockChildProcess.kill).toHaveBeenCalledTimes(1);
    });

    it('should prevent execute after destroy', async () => {
      const process = new UVProcess({
        uvPath: '/path/to/uv',
        command: 'pip',
        args: ['install', 'numpy'],
      });

      process.destroy();

      await expect(process.execute()).rejects.toThrow('UVProcess has been destroyed');
    });
  });
});

describe('Factory functions', () => {
  let mockChildProcess: any;

  beforeEach(() => {
    // Create mock child process
    mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn(() => true);
    mockChildProcess.killed = false;
    mockChildProcess.pid = 12_345;

    // Set up spawn mock
    vi.mocked(spawn).mockReturnValue(mockChildProcess);
  });

  describe('createPipInstallProcess', () => {
    it('should create pip install process with packages', async () => {
      const process = createPipInstallProcess('/path/to/uv', {
        packages: ['numpy', 'pandas'],
        indexUrl: 'https://pypi.org/simple',
        verbose: true,
      });

      expect(process).toBeInstanceOf(UVProcess);

      // Trigger execute to verify args
      const promise = process.execute();
      expect(spawn).toHaveBeenCalledWith(
        '/path/to/uv',
        expect.arrayContaining([
          '--verbose',
          'pip',
          'install',
          'numpy',
          'pandas',
          '--index-url',
          'https://pypi.org/simple',
        ]),
        expect.any(Object)
      );

      // Clean up properly
      mockChildProcess.emit('close', 0, null);
      await promise;
    });

    it('should create pip install process with requirements file', async () => {
      const process = createPipInstallProcess('/path/to/uv', {
        requirementsFile: '/path/to/requirements.txt',
        upgrade: true,
        prerelease: true,
      });

      const promise = process.execute();
      expect(spawn).toHaveBeenCalledWith(
        '/path/to/uv',
        expect.arrayContaining(['pip', 'install', '-U', '--pre', '-r', '/path/to/requirements.txt']),
        expect.any(Object)
      );

      // Clean up properly
      mockChildProcess.emit('close', 0, null);
      await promise;
    });
  });

  describe('createVenvProcess', () => {
    it('should create venv process', async () => {
      const process = createVenvProcess('/path/to/uv', {
        path: '/project/venv',
        python: '3.11',
        pythonPreference: 'only-managed',
      });

      const promise = process.execute();
      expect(spawn).toHaveBeenCalledWith(
        '/path/to/uv',
        ['venv', '--python', '3.11', '--python-preference', 'only-managed', '/project/venv'],
        expect.any(Object)
      );

      // Clean up properly
      mockChildProcess.emit('close', 0, null);
      await promise;
    });
  });

  describe('createCacheCleanProcess', () => {
    it('should create cache clean process', async () => {
      const process = createCacheCleanProcess('/path/to/uv', {
        verbose: true,
      });

      const promise = process.execute();
      expect(spawn).toHaveBeenCalledWith('/path/to/uv', ['--verbose', 'cache', 'clean'], expect.any(Object));

      // Clean up properly
      mockChildProcess.emit('close', 0, null);
      await promise;
    });
  });
});
