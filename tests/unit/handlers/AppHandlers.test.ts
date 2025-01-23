import { ipcMain } from 'electron';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../src/constants';
import { AppHandlers } from '/src/handlers/AppHandlers';

vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
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

describe('AppHandlers', () => {
  let handler: AppHandlers;

  const testCases: TestCase[] = [{ channel: IPC_CHANNELS.QUIT, expected: undefined }];

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerHandlers', () => {
    beforeEach(() => {
      handler = new AppHandlers();
      handler.registerHandlers();
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
