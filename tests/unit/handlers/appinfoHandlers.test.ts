import { ipcMain } from 'electron';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import { registerAppInfoHandlers } from '@/handlers/appInfoHandlers';

const MOCK_WINDOW_STYLE = 'default';
const MOCK_GPU_NAME = 'mock-gpu';
const MOCK_BASE_PATH = '/set/user/changed/base/path';

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

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockImplementation((key) => {
      if (key === 'basePath') return MOCK_BASE_PATH;
    }),
    set: vi.fn().mockReturnValue(true),
    getAsync: vi.fn().mockImplementation((key) => {
      if (key === 'windowStyle') return Promise.resolve(MOCK_WINDOW_STYLE);
      if (key === 'detectedGpu') return Promise.resolve(MOCK_GPU_NAME);
    }),
    setAsync: vi.fn().mockReturnValue(Promise.resolve(true)),
  }),
}));

vi.mock('@/config/comfyServerConfig', () => ({
  ComfyServerConfig: {
    setBasePathInDefaultConfig: vi.fn().mockReturnValue(Promise.resolve(true)),
  },
}));

interface TestCase {
  channel: string;
  expected: any;
  args?: any[];
}

const getHandler = (channel: string) => {
  const [, handlerFn] = (ipcMain.handle as Mock).mock.calls.find(([ch]) => ch === channel) || [];
  return handlerFn;
};

describe('AppInfoHandlers', () => {
  const testCases: TestCase[] = [
    { channel: IPC_CHANNELS.IS_PACKAGED, expected: false },
    { channel: IPC_CHANNELS.GET_ELECTRON_VERSION, expected: '1.0.0' },
    { channel: IPC_CHANNELS.GET_BASE_PATH, expected: MOCK_BASE_PATH },
    { channel: IPC_CHANNELS.GET_GPU, expected: MOCK_GPU_NAME },
    { channel: IPC_CHANNELS.SET_WINDOW_STYLE, expected: undefined, args: [null, MOCK_WINDOW_STYLE] },
    { channel: IPC_CHANNELS.GET_WINDOW_STYLE, expected: MOCK_WINDOW_STYLE },
  ];

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerHandlers', () => {
    beforeEach(() => {
      registerAppInfoHandlers();
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
});
