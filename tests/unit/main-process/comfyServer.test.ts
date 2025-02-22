import type { MainLogger } from 'electron-log';
import log from 'electron-log/main';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test as baseTest, beforeEach, describe, expect, vi } from 'vitest';
import waitOn from 'wait-on';

import { ServerArgs } from '@/constants';
import type { AppWindow } from '@/main-process/appWindow';
import { ComfyServer } from '@/main-process/comfyServer';
import { type ITelemetry, getTelemetry } from '@/services/telemetry';
import type { VirtualEnvironment } from '@/virtualEnvironment';

const basePath = '/mock/base/path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => basePath) },
}));

vi.mock('@/install/resourcePaths', () => ({
  getAppResourcesPath: vi.fn(() => '/mocked/app_resources'),
}));

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock('wait-on');

vi.mock('@/utils');
vi.mock('@/config/comfyServerConfig');
vi.mock('@/main-process/appWindow');

interface TestContext {
  server: ComfyServer;
  runningServer: ComfyServer;
  mockServerArgs: ServerArgs;
  mockVirtualEnvironment: VirtualEnvironment;
  mockAppWindow: AppWindow;
  mockTelemetry: ITelemetry;
  mockProcess: ChildProcess;
}

const test = baseTest.extend<TestContext>({
  mockServerArgs: {
    listen: 'localhost',
    port: '8188',
  },
  mockVirtualEnvironment: async ({}, use) => {
    await use({ runPythonCommand: vi.fn() } as unknown as VirtualEnvironment);
  },
  mockAppWindow: async ({}, use) => {
    await use({ send: vi.fn() } as unknown as AppWindow);
  },
  mockTelemetry: async ({}, use) => {
    await use(getTelemetry());
  },
  mockProcess: async ({}, use) => {
    const mockProcess = new EventEmitter() as ChildProcess;
    await use(mockProcess);
    mockProcess.removeAllListeners();
  },
  server: async ({ mockServerArgs, mockVirtualEnvironment, mockAppWindow, mockTelemetry }, use) => {
    vi.mocked(log.create).mockReturnValue({
      transports: { file: { transforms: [] } },
    } as unknown as MainLogger & { default: MainLogger });

    const server = new ComfyServer(
      basePath,
      mockServerArgs,
      mockVirtualEnvironment as any,
      mockAppWindow as any,
      mockTelemetry as any
    );
    await use(server);
  },
  runningServer: async ({ server, mockProcess }, use) => {
    // @ts-expect-error - Setting private property for test
    server.comfyServerProcess = mockProcess;
    await use(server);
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildLaunchArgs', () => {
  test('should convert basic arguments correctly', () => {
    const args = {
      port: '8188',
      host: 'localhost',
    };

    const result = ComfyServer.buildLaunchArgs(args);

    expect(result).toEqual(['--port', '8188', '--host', 'localhost']);
  });

  test('should handle empty string values by only including the flag', () => {
    const args = {
      cpu: '',
      port: '8188',
    };

    const result = ComfyServer.buildLaunchArgs(args);

    expect(result).toEqual(['--cpu', '--port', '8188']);
  });

  test('should handle no arguments', () => {
    const args = {};

    const result = ComfyServer.buildLaunchArgs(args);

    expect(result).toEqual([]);
  });

  test('should preserve argument order', () => {
    const args = {
      z: '3',
      a: '1',
      b: '2',
    };

    const result = ComfyServer.buildLaunchArgs(args);

    expect(result).toEqual(['--z', '3', '--a', '1', '--b', '2']);
  });
});

describe('paths and directories', () => {
  test('should correctly set up directory paths', ({ server }) => {
    expect(server.userDirectoryPath).toBe(path.join(basePath, 'user'));
    expect(server.inputDirectoryPath).toBe(path.join(basePath, 'input'));
    expect(server.outputDirectoryPath).toBe(path.join(basePath, 'output'));
    expect(server.mainScriptPath).toBe(path.join('/mocked/app_resources', 'ComfyUI', 'main.py'));
    expect(server.webRootPath).toBe(
      path.join('/mocked/app_resources', 'ComfyUI', 'web_custom_versions', 'desktop_app')
    );
  });
});

describe('baseUrl', () => {
  test('should return the correct base URL', ({ server }) => {
    expect(server.baseUrl).toBe('http://localhost:8188');
  });
});

describe('coreLaunchArgs', () => {
  test('should return the correct core launch arguments', ({ server }) => {
    const args = server.coreLaunchArgs;
    expect(args).toEqual({
      'user-directory': server.userDirectoryPath,
      'input-directory': server.inputDirectoryPath,
      'output-directory': server.outputDirectoryPath,
      'front-end-root': server.webRootPath,
      'base-directory': basePath,
      'extra-model-paths-config': expect.any(String),
      'log-stdout': '',
    });
  });
});

describe('start', () => {
  test('should throw error if server is already running', async ({ runningServer }) => {
    await expect(runningServer.start()).rejects.toThrow('ComfyUI server is already running');
  });

  test('should start the server successfully', async ({ server, mockVirtualEnvironment, mockProcess }) => {
    mockProcess.kill = vi.fn().mockReturnValue(true);
    vi.mocked(mockVirtualEnvironment.runPythonCommand).mockReturnValue(mockProcess);
    vi.mocked(waitOn).mockResolvedValue();

    await expect(server.start()).resolves.toBeUndefined();
    expect(mockVirtualEnvironment.runPythonCommand).toHaveBeenCalledWith(
      expect.arrayContaining([server.mainScriptPath]),
      expect.any(Object)
    );
  });

  test('should handle server error', async ({ server, mockVirtualEnvironment, mockProcess }) => {
    mockProcess.kill = vi.fn().mockReturnValue(true);
    vi.mocked(mockVirtualEnvironment.runPythonCommand).mockReturnValue(mockProcess);
    // Make waitOn hang so we can test the error path
    vi.mocked(waitOn).mockImplementationOnce(() => new Promise(() => {}) as any);

    const startPromise = server.start();

    // Wait a tick to ensure promise is initialized
    await new Promise((resolve) => setTimeout(resolve, 0));

    mockProcess.emit('error', new Error('test error'));

    await expect(startPromise).rejects.toThrow('test error');
    expect(mockVirtualEnvironment.runPythonCommand).toHaveBeenCalledWith(
      expect.arrayContaining([server.mainScriptPath]),
      expect.any(Object)
    );
  });

  test('should handle server timeout', async ({ server, mockVirtualEnvironment, mockProcess }) => {
    vi.mocked(mockVirtualEnvironment.runPythonCommand).mockReturnValue(mockProcess);
    vi.mocked(waitOn).mockRejectedValue(new Error('timeout'));

    await expect(server.start()).rejects.toThrow('Python server failed to start within timeout');
    expect(server.timedOutWhilstStarting).toBe(true);
  });
});

describe('kill', () => {
  test('should resolve immediately if no server process exists', async ({ server }) => {
    await expect(server.kill()).resolves.toBeUndefined();
  });

  test('should kill the server process successfully', async ({ runningServer, mockProcess }) => {
    mockProcess.kill = vi.fn().mockReturnValue(true);

    const killPromise = runningServer.kill();
    mockProcess.emit('exit');

    await expect(killPromise).resolves.toBeUndefined();
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  test('should reject if kill signal fails', async ({ runningServer, mockProcess }) => {
    mockProcess.kill = vi.fn().mockReturnValue(false);

    await expect(runningServer.kill()).rejects.toThrow('Failed to initiate kill signal for python server');
  });
});
