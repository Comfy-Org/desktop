import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { electronMock } from '../setup';

vi.mock('node:fs');

describe('DownloadManager', () => {
  let DownloadManager: typeof import('@/models/DownloadManager').DownloadManager;
  let defaultSessionOn: ReturnType<typeof vi.fn>;
  let downloadURL: ReturnType<typeof vi.fn>;
  let mainWindow: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();

    defaultSessionOn = vi.fn();
    downloadURL = vi.fn();
    mainWindow = { send: vi.fn() };

    Object.assign(electronMock, {
      session: {
        defaultSession: {
          on: defaultSessionOn,
          downloadURL,
        },
      },
    });

    ({ DownloadManager } = await import('@/models/DownloadManager'));

    vi.mocked(fs.existsSync).mockReturnValue(false);
    const ipcMainHandle = electronMock.ipcMain.handle;
    if (!ipcMainHandle) {
      throw new Error('ipcMain.handle mock is not initialized');
    }
    vi.mocked(ipcMainHandle).mockImplementation(() => undefined);

    (DownloadManager as unknown as { instance?: unknown }).instance = undefined;
  });

  it('uses absolute save paths directly instead of nesting them under the models directory again', () => {
    const manager = DownloadManager.getInstance(mainWindow as never, '/mock/models');
    const url = 'https://example.com/model.safetensors';
    const savePath = path.join('/mock/models', 'ipadapter');

    expect(manager.startDownload(url, savePath, 'model.safetensors')).toBe(true);
    expect(downloadURL).toHaveBeenCalledWith(url);

    const downloads = (
      manager as unknown as {
        downloads: Map<string, { savePath: string; tempPath: string }>;
      }
    ).downloads;
    expect(downloads.get(url)?.savePath).toBe(path.join(savePath, 'model.safetensors'));
    expect(downloads.get(url)?.tempPath).toBe(path.join(savePath, 'Unconfirmed model.safetensors.tmp'));
  });

  it('rejects relative save paths from outdated callers', () => {
    const manager = DownloadManager.getInstance(mainWindow as never, '/mock/models');

    expect(manager.startDownload('https://example.com/model.safetensors', 'checkpoints', 'model.safetensors')).toBe(
      false
    );
    expect(downloadURL).not.toHaveBeenCalled();
    expect(mainWindow.send).toHaveBeenCalledWith(
      'download-progress',
      expect.objectContaining({
        message: 'Save path must be an absolute directory path',
      })
    );
  });

  it('rejects absolute save paths outside the models directory', () => {
    const manager = DownloadManager.getInstance(mainWindow as never, '/mock/models');

    expect(manager.startDownload('https://example.com/model.safetensors', '/tmp', 'model.safetensors')).toBe(false);
    expect(downloadURL).not.toHaveBeenCalled();
  });
});
