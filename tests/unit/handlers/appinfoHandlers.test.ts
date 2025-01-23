import { ipcMain } from 'electron';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../src/constants';
import { AppInfoHandlers } from '../../../src/handlers/appInfoHandlers';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
}));

const mockWindowStyle = 'light';
const mockGpuName = 'mock-gpu';
const mockBasePath = '/set/user/changed/base/path';

vi.mock('../../../src/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockImplementation((key) => {
      if (key === 'basePath') return mockBasePath;
    }),
    set: vi.fn().mockReturnValue(true),
    getAsync: vi.fn().mockImplementation((key) => {
      if (key === 'windowStyle') return Promise.resolve(mockWindowStyle);
      if (key === 'detectedGpu') return Promise.resolve(mockGpuName);
    }),
    setAsync: vi.fn().mockReturnValue(Promise.resolve(true)),
  }),
}));

vi.mock('../../../src/config/comfyServerConfig', () => ({
  ComfyServerConfig: {
    setBasePathInDefaultConfig: vi.fn().mockReturnValue(Promise.resolve(true)),
  },
}));

interface TestCase {
  channel: string;
  expected: any;
  args?: any[];
}

describe('AppInfoHandlers', () => {
  let handler: AppInfoHandlers;
  let appWindow: {
    loadRenderer: Mock;
    showOpenDialog: Mock;
  };

  const getHandler = (channel: string) => {
    const [, handlerFn] = (ipcMain.handle as Mock).mock.calls.find(([ch]) => ch === channel) || [];
    return handlerFn;
  };

  const testCases: TestCase[] = [
    { channel: IPC_CHANNELS.IS_PACKAGED, expected: false },
    { channel: IPC_CHANNELS.GET_ELECTRON_VERSION, expected: '1.0.0' },
    { channel: IPC_CHANNELS.GET_BASE_PATH, expected: mockBasePath },
    { channel: IPC_CHANNELS.SET_BASE_PATH, expected: true, args: [null, mockBasePath] },
    { channel: IPC_CHANNELS.GET_GPU, expected: mockGpuName },
    { channel: IPC_CHANNELS.SET_WINDOW_STYLE, expected: undefined, args: [null, mockWindowStyle] },
    { channel: IPC_CHANNELS.GET_WINDOW_STYLE, expected: mockWindowStyle },
  ];

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerHandlers', () => {
    beforeEach(() => {
      handler = new AppInfoHandlers();
      appWindow = {
        loadRenderer: vi.fn(),
        showOpenDialog: vi.fn().mockReturnValue({ canceled: false, filePaths: [mockBasePath] }),
      };
      handler.registerHandlers(appWindow as any);
    });

    it.each(testCases)('should register handler for $channel', ({ channel }) => {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });

    it.each(testCases)(
      '$channel handler should return mock value ($expected)',
      async ({ channel, expected, args = [] }) => {
        const handlerFn = getHandler(channel);
        const result = await handlerFn(...args);

        expect(result).toEqual(expected);
      }
    );
  });

  describe('set-base-path', () => {
    it('should return false when user cancels dialog', async () => {
      handler = new AppInfoHandlers();
      appWindow = {
        loadRenderer: vi.fn(),
        showOpenDialog: vi.fn().mockReturnValue({ canceled: true, filePaths: [] }),
      };
      handler.registerHandlers(appWindow as any);

      const result = await getHandler(IPC_CHANNELS.SET_BASE_PATH)(null, mockBasePath);

      expect(result).toBe(false);
    });
  });
});
