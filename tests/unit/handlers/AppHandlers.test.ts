import { app, ipcMain } from 'electron';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import { registerAppHandlers } from '@/handlers/AppHandlers';

import { quitMessage } from '../setup';

const getHandler = (channel: string) => {
  const [, handlerFn] = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel) || [];
  return handlerFn;
};

describe('AppHandlers', () => {
  beforeEach(() => {
    registerAppHandlers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerHandlers', () => {
    const channels = [IPC_CHANNELS.QUIT, IPC_CHANNELS.RESTART_APP];

    test.each(channels)('should register handler for $channel', (channel) => {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('restart handler should call app.relaunch', async () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.RESTART_APP, expect.any(Function));

    const handlerFn = getHandler(IPC_CHANNELS.RESTART_APP);
    await expect(handlerFn).rejects.toThrow(/^Cannot destructure property 'customMessage' of/);
    await expect(handlerFn?.(null!, [{}])).rejects.toThrow(quitMessage);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
  });

  test('quit handler should call app.quit', () => {
    const handlerFn = getHandler(IPC_CHANNELS.QUIT);
    expect(handlerFn).toThrow(quitMessage);
  });
});
