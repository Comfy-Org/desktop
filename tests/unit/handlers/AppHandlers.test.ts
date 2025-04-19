import todesktop from '@todesktop/runtime';
import { app, ipcMain } from 'electron';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import { registerAppHandlers } from '@/handlers/AppHandlers';

import { quitMessage } from '../setup';

const getHandler = (channel: string) => {
  const [, handlerFn] = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel) || [];
  return handlerFn;
};
const getListener = (channel: string) => {
  const [, listener] = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === channel) || [];
  return listener;
};

describe('AppHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAppHandlers();
  });

  describe('registerHandlers', () => {
    const handleChannels = [IPC_CHANNELS.QUIT, IPC_CHANNELS.RESTART_APP, IPC_CHANNELS.CHECK_FOR_UPDATES];
    test.each(handleChannels)('should register handler for %s', (ch) => {
      expect(ipcMain.handle).toHaveBeenCalledWith(ch, expect.any(Function));
    });
    test('should register listener for RESTART_AND_INSTALL', () => {
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.RESTART_AND_INSTALL, expect.any(Function));
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

  describe('checkForUpdates handler', () => {
    let handler: any;
    beforeEach(() => {
      handler = getHandler(IPC_CHANNELS.CHECK_FOR_UPDATES);
    });

    test('returns false when updater is unavailable', async () => {
      todesktop.autoUpdater = undefined;
      await expect(handler()).resolves.toEqual({ isUpdateAvailable: false });
    });

    test('returns update info when available', async () => {
      const mockUpdater = {
        checkForUpdates: vi.fn().mockResolvedValue({
          updateInfo: { version: '1.2.3', releaseDate: '2020-01-01T00:00:00.000Z' },
        }),
      };
      todesktop.autoUpdater = mockUpdater as any;
      const result = await handler();
      expect(mockUpdater.checkForUpdates).toHaveBeenCalled();
      expect(result).toEqual({ isUpdateAvailable: true, version: '1.2.3' });
    });

    test('returns false when no update available', async () => {
      const mockUpdater = { checkForUpdates: vi.fn().mockResolvedValue({}) };
      todesktop.autoUpdater = mockUpdater as any;
      await expect(handler()).resolves.toEqual({ isUpdateAvailable: false, version: undefined });
    });
  });

  describe('restartAndInstall listener', () => {
    let listener: any;
    beforeEach(() => {
      listener = getListener(IPC_CHANNELS.RESTART_AND_INSTALL);
    });

    test('does not throw when updater is unavailable', () => {
      todesktop.autoUpdater = undefined;
      expect(() => listener()).not.toThrow();
    });

    test('calls restartAndInstall when updater is available', () => {
      const restartAndInstall = vi.fn();
      todesktop.autoUpdater = { restartAndInstall } as any;
      listener();
      expect(restartAndInstall).toHaveBeenCalled();
    });
  });
});
