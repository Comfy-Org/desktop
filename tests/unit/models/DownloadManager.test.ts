import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { electronMock } from '../setup';

vi.mock('node:fs');

const originalPlatform = process.platform;

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
    Object.assign(fs.realpathSync, {
      native: vi.fn((targetPath: Parameters<typeof fs.realpathSync.native>[0]) => path.resolve(String(targetPath))),
    });
    const ipcMainHandle = electronMock.ipcMain.handle;
    if (!ipcMainHandle) {
      throw new Error('ipcMain.handle mock is not initialized');
    }
    vi.mocked(ipcMainHandle).mockImplementation(() => undefined);

    (DownloadManager as unknown as { instance?: unknown }).instance = undefined;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  it('uses absolute save paths directly instead of nesting them under the models directory again', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const savePath = path.join(modelsDirectory, 'ipadapter');

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

  it('normalizes relative save paths from legacy callers under the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';

    expect(manager.startDownload(url, 'checkpoints', 'model.safetensors')).toBe(true);
    expect(downloadURL).toHaveBeenCalledWith(url);

    const downloads = (
      manager as unknown as {
        downloads: Map<string, { savePath: string; tempPath: string }>;
      }
    ).downloads;
    expect(downloads.get(url)?.savePath).toBe(path.join(modelsDirectory, 'checkpoints', 'model.safetensors'));
    expect(downloads.get(url)?.tempPath).toBe(
      path.join(modelsDirectory, 'checkpoints', 'Unconfirmed model.safetensors.tmp')
    );
  });

  it('rejects relative save paths that escape the models directory', () => {
    const manager = DownloadManager.getInstance(mainWindow as never, path.resolve('/mock/models'));

    expect(manager.startDownload('https://example.com/model.safetensors', '../tmp', 'model.safetensors')).toBe(false);
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('rejects absolute save paths outside the models directory', () => {
    const manager = DownloadManager.getInstance(mainWindow as never, path.resolve('/mock/models'));

    expect(
      manager.startDownload('https://example.com/model.safetensors', path.resolve('/tmp'), 'model.safetensors')
    ).toBe(false);
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('accepts differently cased absolute paths under the models directory on Windows', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    vi.mocked(fs.realpathSync.native).mockImplementation(String);

    const manager = DownloadManager.getInstance(mainWindow as never, path.resolve('/Mock/Models'));

    expect(
      manager.startDownload(
        'https://example.com/model.safetensors',
        path.resolve('/mock/models/ipadapter'),
        'model.safetensors'
      )
    ).toBe(true);
    expect(downloadURL).toHaveBeenCalledWith('https://example.com/model.safetensors');
  });

  it('rejects symlinked model directories that resolve outside the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const symlinkPath = path.join(modelsDirectory, 'link');
    const outsidePath = path.resolve('/outside/models-link');

    vi.mocked(fs.realpathSync.native).mockImplementation((targetPath) => {
      const resolvedPath = path.resolve(String(targetPath));
      if (resolvedPath === symlinkPath) {
        return outsidePath;
      }
      return resolvedPath;
    });
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);

    expect(manager.startDownload('https://example.com/model.safetensors', symlinkPath, 'model.safetensors')).toBe(
      false
    );
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('restarts interrupted downloads that cannot be resumed', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const downloads = (
      manager as unknown as {
        downloads: Map<
          string,
          {
            url: string;
            filename: string;
            directoryPath: string;
            savePath: string;
            tempPath: string;
            item: { canResume: () => boolean; resume: () => void };
          }
        >;
      }
    ).downloads;
    const resume = vi.fn();
    const url = 'https://example.com/model.safetensors';

    downloads.set(url, {
      url,
      filename: 'model.safetensors',
      directoryPath: checkpointsDirectory,
      savePath: path.join(checkpointsDirectory, 'model.safetensors'),
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      item: {
        canResume: () => false,
        resume,
      },
    });

    manager.resumeDownload(url);

    expect(resume).not.toHaveBeenCalled();
    expect(downloadURL).toHaveBeenCalledWith(url);
  });
});
