import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadStatus, IPC_CHANNELS } from '@/constants';
import type { Download, StartDownloadResult } from '@/models/DownloadManager';

import { electronMock } from '../setup';

vi.mock('node:fs');

const originalPlatform = process.platform;
const mockExistingPaths = (...paths: string[]) => {
  const existingPaths = new Set(paths.map((targetPath) => path.resolve(targetPath)));
  existingPaths.add(path.parse(path.resolve('/')).root);

  vi.mocked(fs.existsSync).mockImplementation((targetPath) => existingPaths.has(path.resolve(String(targetPath))));
};

function expectStartOk(result: StartDownloadResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.download;
}

function expectStartFailed(result: StartDownloadResult) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected download start to fail');
  }
  return result;
}

function getDownloads(manager: unknown): Map<string, Download> {
  return (manager as { downloads: Map<string, Download> }).downloads;
}

interface MockDownloadItem {
  getURLChain: () => string[];
  getTotalBytes: () => number;
  getReceivedBytes: () => number;
  getSavePath: () => string;
  setSavePath: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

function getWillDownloadHandler(defaultSessionOn: ReturnType<typeof vi.fn>) {
  return defaultSessionOn.mock.calls[0][1] as (event: unknown, item: MockDownloadItem) => void;
}

function createMockDownloadItem(url: string, receivedBytes = 0, totalBytes = 10): MockDownloadItem {
  return {
    getURLChain: () => [url],
    getTotalBytes: () => totalBytes,
    getReceivedBytes: () => receivedBytes,
    getSavePath: () => '',
    setSavePath: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function getDoneHandler(item: MockDownloadItem) {
  const doneCall = item.once.mock.calls.find(([eventName]) => eventName === 'done');
  if (!doneCall) {
    throw new Error('Expected done handler to be registered');
  }
  return doneCall[1] as (event: unknown, state: string) => void;
}

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
    mockExistingPaths(modelsDirectory, savePath);

    const download = expectStartOk(manager.startDownload(url, savePath, 'model.safetensors'));
    expect(downloadURL).toHaveBeenCalledWith(url);

    const downloads = getDownloads(manager);
    expect(download.downloadId).toBe(path.join(savePath, 'model.safetensors'));
    expect(downloads.get(download.downloadId)?.savePath).toBe(path.join(savePath, 'model.safetensors'));
    expect(downloads.get(download.downloadId)?.tempPath).toBe(path.join(savePath, 'Unconfirmed model.safetensors.tmp'));
  });

  it('normalizes relative save paths from legacy callers under the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    mockExistingPaths(modelsDirectory, path.join(modelsDirectory, 'checkpoints'));

    const download = expectStartOk(manager.startDownload(url, 'checkpoints', 'model.safetensors'));
    expect(downloadURL).toHaveBeenCalledWith(url);

    const downloads = getDownloads(manager);
    expect(download.downloadId).toBe(path.join(modelsDirectory, 'checkpoints', 'model.safetensors'));
    expect(downloads.get(download.downloadId)?.savePath).toBe(
      path.join(modelsDirectory, 'checkpoints', 'model.safetensors')
    );
    expect(downloads.get(download.downloadId)?.tempPath).toBe(
      path.join(modelsDirectory, 'checkpoints', 'Unconfirmed model.safetensors.tmp')
    );
  });

  it('tracks same-source downloads separately by target save path', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const lorasDirectory = path.join(modelsDirectory, 'loras');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    mockExistingPaths(modelsDirectory, checkpointsDirectory, lorasDirectory);

    const checkpointDownload = expectStartOk(manager.startDownload(url, checkpointsDirectory, 'model.safetensors'));
    const loraDownload = expectStartOk(manager.startDownload(url, lorasDirectory, 'model.safetensors'));

    expect(checkpointDownload.downloadId).toBe(path.join(checkpointsDirectory, 'model.safetensors'));
    expect(loraDownload.downloadId).toBe(path.join(lorasDirectory, 'model.safetensors'));
    expect(downloadURL).toHaveBeenCalledTimes(2);
    expect([...getDownloads(manager).keys()]).toEqual([checkpointDownload.downloadId, loraDownload.downloadId]);

    const willDownload = getWillDownloadHandler(defaultSessionOn);
    const firstItem = createMockDownloadItem(url);
    const secondItem = createMockDownloadItem(url);

    willDownload({}, firstItem);
    willDownload({}, secondItem);

    expect(firstItem.setSavePath).toHaveBeenCalledWith(
      path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp')
    );
    expect(secondItem.setSavePath).toHaveBeenCalledWith(path.join(lorasDirectory, 'Unconfirmed model.safetensors.tmp'));
  });

  it('rejects relative save paths that escape the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory);

    expectStartFailed(manager.startDownload('https://example.com/model.safetensors', '../tmp', 'model.safetensors'));
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('rejects absolute save paths outside the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory, path.resolve('/tmp'));

    expectStartFailed(
      manager.startDownload('https://example.com/model.safetensors', path.resolve('/tmp'), 'model.safetensors')
    );
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('accepts differently cased absolute paths under the models directory on Windows', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    vi.mocked(fs.realpathSync.native).mockImplementation(String);

    const manager = DownloadManager.getInstance(mainWindow as never, path.resolve('/Mock/Models'));
    mockExistingPaths(path.resolve('/Mock/Models'), path.resolve('/mock/models/ipadapter'));

    expectStartOk(
      manager.startDownload(
        'https://example.com/model.safetensors',
        path.resolve('/mock/models/ipadapter'),
        'model.safetensors'
      )
    );
    expect(downloadURL).toHaveBeenCalledWith('https://example.com/model.safetensors');
  });

  it('creates missing subdirectory inside models directory before downloading', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const newSubdir = path.join(modelsDirectory, 'latent_upscale_models');
    mockExistingPaths(modelsDirectory);

    expectStartOk(manager.startDownload(url, newSubdir, 'model.safetensors'));
    expect(fs.mkdirSync).toHaveBeenCalledWith(newSubdir, { recursive: true });
    expect(downloadURL).toHaveBeenCalledWith(url);
  });

  it('emits a canonical pending snapshot as soon as a download starts', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    mockExistingPaths(modelsDirectory, checkpointsDirectory);

    const download = expectStartOk(manager.startDownload(url, checkpointsDirectory, 'model.safetensors'));

    expect(mainWindow.send).toHaveBeenCalledWith(
      IPC_CHANNELS.DOWNLOAD_PROGRESS,
      expect.objectContaining({
        downloadId: download.downloadId,
        url,
        filename: 'model.safetensors',
        savePath: path.join(checkpointsDirectory, 'model.safetensors'),
        progress: 0,
        status: DownloadStatus.PENDING,
        state: DownloadStatus.PENDING,
        receivedBytes: 0,
        totalBytes: 0,
        isPaused: false,
      })
    );
  });

  it('reports an error when a completed download cannot be finalized', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const tempPath = path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp');
    mockExistingPaths(modelsDirectory, checkpointsDirectory, tempPath);
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw new Error('rename failed');
    });

    const download = expectStartOk(manager.startDownload(url, checkpointsDirectory, 'model.safetensors'));
    const item = createMockDownloadItem(url, 5, 10);
    getWillDownloadHandler(defaultSessionOn)({}, item);

    getDoneHandler(item)({}, 'completed');

    expect(fs.unlinkSync).toHaveBeenCalledWith(tempPath);
    expect(mainWindow.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.DOWNLOAD_PROGRESS,
      expect.objectContaining({
        downloadId: download.downloadId,
        progress: 0.5,
        status: DownloadStatus.ERROR,
        state: DownloadStatus.ERROR,
        message: 'Failed to finalize downloaded file: rename failed',
      })
    );
  });

  it('refreshes completed snapshots when an existing file is requested again', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const filename = 'model.safetensors';
    const savePath = path.join(checkpointsDirectory, filename);
    const downloadId = savePath;
    mockExistingPaths(modelsDirectory, checkpointsDirectory, savePath);

    getDownloads(manager).set(downloadId, {
      downloadId,
      url: 'https://example.com/stale.safetensors',
      filename: 'stale.safetensors',
      directoryPath: path.join(modelsDirectory, 'loras'),
      savePath: path.join(modelsDirectory, 'loras', 'stale.safetensors'),
      tempPath: path.join(modelsDirectory, 'loras', 'Unconfirmed stale.safetensors.tmp'),
      progress: 0.4,
      status: DownloadStatus.COMPLETED,
      message: 'stale',
      receivedBytes: 4,
      totalBytes: 10,
      item: null,
    });

    const download = expectStartOk(manager.startDownload(url, checkpointsDirectory, filename));

    expect(download).toEqual(
      expect.objectContaining({
        downloadId,
        url,
        filename,
        savePath,
        progress: 1,
        status: DownloadStatus.COMPLETED,
        receivedBytes: 0,
        totalBytes: 0,
      })
    );
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('resumes paused downloads without starting a second download', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory, checkpointsDirectory);
    const downloads = getDownloads(manager);
    const resume = vi.fn();
    const url = 'https://example.com/model.safetensors';
    const downloadId = path.join(checkpointsDirectory, 'model.safetensors');

    downloads.set(downloadId, {
      downloadId,
      url,
      filename: 'model.safetensors',
      directoryPath: checkpointsDirectory,
      savePath: path.join(checkpointsDirectory, 'model.safetensors'),
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      progress: 0.5,
      status: DownloadStatus.PAUSED,
      message: undefined,
      receivedBytes: 5,
      totalBytes: 10,
      item: {
        canResume: () => true,
        isPaused: () => false,
        resume,
      } as unknown as Download['item'],
    });

    expectStartOk(manager.startDownload(url, checkpointsDirectory, 'model.safetensors'));

    expect(resume).toHaveBeenCalledOnce();
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('restarts completed downloads when the model file was deleted in the same session', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const filename = 'model.safetensors';
    const savePath = path.join(checkpointsDirectory, filename);
    const downloadId = savePath;
    mockExistingPaths(modelsDirectory, checkpointsDirectory);

    getDownloads(manager).set(downloadId, {
      downloadId,
      url,
      filename,
      directoryPath: checkpointsDirectory,
      savePath,
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      progress: 1,
      status: DownloadStatus.COMPLETED,
      message: undefined,
      receivedBytes: 10,
      totalBytes: 10,
      item: null,
    });

    const download = expectStartOk(manager.startDownload(url, checkpointsDirectory, filename));

    expect(download.status).toBe(DownloadStatus.PENDING);
    expect(downloadURL).toHaveBeenCalledWith(url);
  });

  it('does not create directories outside models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory, path.resolve('/tmp'));

    expectStartFailed(
      manager.startDownload('https://example.com/model.safetensors', path.resolve('/tmp/evil'), 'model.safetensors')
    );
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('rejects symlinked model directories that resolve outside the models directory', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const symlinkPath = path.join(modelsDirectory, 'link');
    const outsidePath = path.resolve('/outside/models-link');
    mockExistingPaths(modelsDirectory, symlinkPath);

    vi.mocked(fs.realpathSync.native).mockImplementation((targetPath) => {
      const resolvedPath = path.resolve(String(targetPath));
      if (resolvedPath === symlinkPath) {
        return outsidePath;
      }
      return resolvedPath;
    });
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);

    expectStartFailed(manager.startDownload('https://example.com/model.safetensors', symlinkPath, 'model.safetensors'));
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('does not create missing directories through symlinked parents that resolve outside models', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const symlinkPath = path.join(modelsDirectory, 'link');
    const outsidePath = path.resolve('/outside/models-link');
    const nestedPath = path.join(symlinkPath, 'latent_upscale_models');
    mockExistingPaths(modelsDirectory, symlinkPath);

    vi.mocked(fs.realpathSync.native).mockImplementation((targetPath) => {
      const resolvedPath = path.resolve(String(targetPath));
      if (resolvedPath === symlinkPath) {
        return outsidePath;
      }
      return resolvedPath;
    });
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);

    expectStartFailed(manager.startDownload('https://example.com/model.safetensors', nestedPath, 'model.safetensors'));
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(downloadURL).not.toHaveBeenCalled();
  });

  it('restarts interrupted downloads that cannot be resumed', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory, checkpointsDirectory);
    const downloads = getDownloads(manager);
    const resume = vi.fn();
    const url = 'https://example.com/model.safetensors';
    const downloadId = path.join(checkpointsDirectory, 'model.safetensors');

    downloads.set(downloadId, {
      downloadId,
      url,
      filename: 'model.safetensors',
      directoryPath: checkpointsDirectory,
      savePath: path.join(checkpointsDirectory, 'model.safetensors'),
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      progress: 0.5,
      status: DownloadStatus.PAUSED,
      message: undefined,
      receivedBytes: 5,
      totalBytes: 10,
      item: {
        canResume: () => false,
        resume,
      } as unknown as Download['item'],
    });

    manager.resumeDownload(downloadId);

    expect(resume).not.toHaveBeenCalled();
    expect(downloadURL).toHaveBeenCalledWith(url);
  });

  it('returns the restarted snapshot when startDownload sees a paused download that cannot resume', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    mockExistingPaths(modelsDirectory, checkpointsDirectory);
    const downloads = getDownloads(manager);
    const url = 'https://example.com/model.safetensors';
    const downloadId = path.join(checkpointsDirectory, 'model.safetensors');

    downloads.set(downloadId, {
      downloadId,
      url,
      filename: 'model.safetensors',
      directoryPath: checkpointsDirectory,
      savePath: path.join(checkpointsDirectory, 'model.safetensors'),
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      progress: 0.5,
      status: DownloadStatus.PAUSED,
      message: undefined,
      receivedBytes: 5,
      totalBytes: 10,
      item: {
        canResume: () => false,
        resume: vi.fn(),
      } as unknown as Download['item'],
    });

    const download = expectStartOk(manager.startDownload(url, checkpointsDirectory, 'model.safetensors'));

    expect(download.status).toBe(DownloadStatus.PENDING);
    expect(downloadURL).toHaveBeenCalledWith(url);
  });

  it('does not bind will-download events to terminal rows with matching URLs', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const checkpointsDirectory = path.join(modelsDirectory, 'checkpoints');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const item = createMockDownloadItem(url);

    getDownloads(manager).set(path.join(checkpointsDirectory, 'model.safetensors'), {
      downloadId: path.join(checkpointsDirectory, 'model.safetensors'),
      url,
      filename: 'model.safetensors',
      directoryPath: checkpointsDirectory,
      savePath: path.join(checkpointsDirectory, 'model.safetensors'),
      tempPath: path.join(checkpointsDirectory, 'Unconfirmed model.safetensors.tmp'),
      progress: 1,
      status: DownloadStatus.COMPLETED,
      message: undefined,
      receivedBytes: 10,
      totalBytes: 10,
      item: null,
    });

    getWillDownloadHandler(defaultSessionOn)({}, item);

    expect(item.setSavePath).not.toHaveBeenCalled();
  });

  it('returns canonical snapshots from getAllDownloads while preserving legacy fields', () => {
    const modelsDirectory = path.resolve('/mock/models');
    const manager = DownloadManager.getInstance(mainWindow as never, modelsDirectory);
    const url = 'https://example.com/model.safetensors';
    const savePath = path.join(modelsDirectory, 'checkpoints', 'model.safetensors');
    const downloads = getDownloads(manager);
    const downloadId = savePath;

    downloads.set(downloadId, {
      downloadId,
      url,
      filename: 'model.safetensors',
      directoryPath: path.dirname(savePath),
      savePath,
      tempPath: path.join(path.dirname(savePath), 'Unconfirmed model.safetensors.tmp'),
      progress: 0.5,
      status: DownloadStatus.IN_PROGRESS,
      message: undefined,
      receivedBytes: 5,
      totalBytes: 10,
      item: {
        getState: () => 'progressing',
        getReceivedBytes: () => 5,
        getTotalBytes: () => 10,
        isPaused: () => false,
      } as unknown as Download['item'],
    });

    expect(manager.getAllDownloads()).toEqual([
      {
        downloadId,
        url,
        filename: 'model.safetensors',
        savePath,
        progress: 0.5,
        status: DownloadStatus.IN_PROGRESS,
        message: undefined,
        state: DownloadStatus.IN_PROGRESS,
        receivedBytes: 5,
        totalBytes: 10,
        isPaused: false,
      },
    ]);
  });
});
