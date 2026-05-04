import { DownloadItem, session } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { DownloadStatus, IPC_CHANNELS } from '../constants';
import type { AppWindow } from '../main-process/appWindow';

export interface Download {
  downloadId: string;
  url: string;
  filename: string;
  tempPath: string; // Temporary filename until the download is complete.
  directoryPath: string;
  savePath: string;
  item: DownloadItem | null;
  progress: number;
  status: DownloadStatus;
  message?: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadState {
  downloadId: string;
  url: string;
  filename: string;
  savePath: string;
  progress: number;
  status: DownloadStatus;
  message?: string;
  /** @deprecated Use `status` instead. */
  state: DownloadStatus;
  /** @deprecated Use `progress` instead. */
  receivedBytes: number;
  /** @deprecated Use `progress` instead. */
  totalBytes: number;
  /** @deprecated Use `status === DownloadStatus.PAUSED` instead. */
  isPaused: boolean;
}

export type StartDownloadResult =
  | { ok: true; download: DownloadState }
  | { ok: false; error: string; download: DownloadState };

/**
 * Singleton class that manages downloading model checkpoints for ComfyUI.
 */
export class DownloadManager {
  private static instance: DownloadManager;
  private readonly downloads: Map<string, Download>;
  private readonly pendingDownloadIdsByUrl: Map<string, string[]>;

  private constructor(
    private readonly mainWindow: AppWindow,
    private readonly modelsDirectory: string
  ) {
    this.downloads = new Map();
    this.pendingDownloadIdsByUrl = new Map();

    session.defaultSession.on('will-download', (event, item) => {
      const url = item.getURLChain()[0]; // Get the original URL in case of redirects.
      log.info('Will-download event', url);
      const download = this.takePendingDownload(url);
      if (!download) return;

      item.setSavePath(download.tempPath);
      download.item = item;
      download.totalBytes = item.getTotalBytes();
      log.info(`Setting save path to ${item.getSavePath()}`);

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          log.info('Download is interrupted but can be resumed');
        } else if (state === 'progressing') {
          const receivedBytes = item.getReceivedBytes();
          const totalBytes = item.getTotalBytes();
          const progress = this.calculateProgress(receivedBytes, totalBytes);
          if (item.isPaused()) {
            log.info('Download is paused');
            download.progress = progress;
            download.status = DownloadStatus.PAUSED;
            download.message = undefined;
            download.receivedBytes = receivedBytes;
            download.totalBytes = totalBytes;
            this.reportProgress(this.toDownloadState(download));
          } else {
            download.progress = progress;
            download.status = DownloadStatus.IN_PROGRESS;
            download.message = undefined;
            download.receivedBytes = receivedBytes;
            download.totalBytes = totalBytes;
            this.reportProgress(this.toDownloadState(download));
          }
        }
      });

      item.once('done', (event, state) => {
        const receivedBytes = item.getReceivedBytes();
        const totalBytes = item.getTotalBytes();
        download.receivedBytes = receivedBytes;
        download.totalBytes = totalBytes;

        if (state === 'completed') {
          try {
            fs.renameSync(download.tempPath, download.savePath);
            log.info(`Successfully renamed ${download.tempPath} to ${download.savePath}`);
          } catch (error) {
            log.error('Failed to rename downloaded file. Deleting temp file.', error);
            this.deleteTempFile(download.tempPath);
            download.item = null;
            download.progress = this.calculateProgress(receivedBytes, totalBytes);
            download.status = DownloadStatus.ERROR;
            download.message = `Failed to finalize downloaded file: ${this.getErrorMessage(error)}`;
            this.reportProgress(this.toDownloadState(download));
            return;
          }
          download.item = null;
          download.progress = 1;
          download.status = DownloadStatus.COMPLETED;
          download.message = undefined;
          this.reportProgress(this.toDownloadState(download));
        } else if (state === 'cancelled') {
          log.info('Download cancelled');
          download.item = null;
          download.progress = this.calculateProgress(receivedBytes, totalBytes);
          download.status = DownloadStatus.CANCELLED;
          download.message = undefined;
          this.reportProgress(this.toDownloadState(download));
        } else {
          log.info(`Download failed: ${state}`);
          download.item = null;
          download.progress = this.calculateProgress(receivedBytes, totalBytes);
          download.status = DownloadStatus.ERROR;
          download.message = 'Download interrupted';
          this.reportProgress(this.toDownloadState(download));
        }
      });
    });
  }

  startDownload(url: string, directoryPath: string, filename: string): StartDownloadResult {
    const normalizedDirectoryPath = this.normalizeDirectoryPath(directoryPath);
    const localSavePath = this.getLocalSavePath(filename, normalizedDirectoryPath);
    const downloadId = this.createDownloadId(localSavePath);
    if (!this.ensureDownloadTargetDirectory(localSavePath)) {
      log.error(`Save path ${localSavePath} is not in models directory ${this.modelsDirectory}`);
      const downloadState: DownloadState = {
        downloadId,
        url,
        savePath: localSavePath,
        filename,
        progress: 0,
        status: DownloadStatus.ERROR,
        message: 'Save path is not in models directory',
        state: DownloadStatus.ERROR,
        receivedBytes: 0,
        totalBytes: 0,
        isPaused: false,
      };
      this.reportProgress(downloadState);
      return {
        ok: false,
        error: 'Save path is not in models directory',
        download: downloadState,
      };
    }

    const validationResult = this.validateSafetensorsFile(url, filename);
    if (!validationResult.isValid) {
      log.error(validationResult.error);
      const errorMessage = validationResult.error ?? 'Invalid download';
      const downloadState: DownloadState = {
        downloadId,
        url,
        savePath: localSavePath,
        filename,
        progress: 0,
        status: DownloadStatus.ERROR,
        message: errorMessage,
        state: DownloadStatus.ERROR,
        receivedBytes: 0,
        totalBytes: 0,
        isPaused: false,
      };
      this.reportProgress(downloadState);
      return {
        ok: false,
        error: errorMessage,
        download: downloadState,
      };
    }

    if (fs.existsSync(localSavePath)) {
      log.info(`File ${filename} already exists, skipping download`);
      const existingCompletedDownload = this.downloads.get(downloadId) ?? {
        downloadId,
        url,
        directoryPath: normalizedDirectoryPath,
        savePath: localSavePath,
        tempPath: this.getTempPath(filename, normalizedDirectoryPath),
        filename,
        item: null,
        progress: 1,
        status: DownloadStatus.COMPLETED,
        message: undefined,
        receivedBytes: 0,
        totalBytes: 0,
      };
      existingCompletedDownload.url = url;
      existingCompletedDownload.directoryPath = normalizedDirectoryPath;
      existingCompletedDownload.savePath = localSavePath;
      existingCompletedDownload.tempPath = this.getTempPath(filename, normalizedDirectoryPath);
      existingCompletedDownload.filename = filename;
      existingCompletedDownload.progress = 1;
      existingCompletedDownload.status = DownloadStatus.COMPLETED;
      existingCompletedDownload.message = undefined;
      existingCompletedDownload.item = null;
      existingCompletedDownload.receivedBytes = 0;
      existingCompletedDownload.totalBytes = 0;
      this.downloads.set(downloadId, existingCompletedDownload);
      const downloadState = this.toDownloadState(existingCompletedDownload);
      this.reportProgress(downloadState);
      return { ok: true, download: downloadState };
    }

    const existingDownload = this.downloads.get(downloadId);
    if (existingDownload) {
      log.info('Download already exists');
      if (existingDownload.status === DownloadStatus.PAUSED) {
        const resumedDownload = this.resumeDownloadWithState(downloadId);
        if (resumedDownload) return resumedDownload;
        this.deleteTempFile(existingDownload.tempPath);
        this.downloads.delete(downloadId);
      } else if (
        existingDownload.status === DownloadStatus.CANCELLED ||
        existingDownload.status === DownloadStatus.COMPLETED ||
        existingDownload.status === DownloadStatus.ERROR
      ) {
        this.deleteTempFile(existingDownload.tempPath);
        this.downloads.delete(downloadId);
      } else {
        return { ok: true, download: this.toDownloadState(existingDownload) };
      }
    }

    log.info(`Starting download ${url} to ${localSavePath}`);
    const download: Download = {
      downloadId,
      url,
      directoryPath: normalizedDirectoryPath,
      savePath: localSavePath,
      tempPath: this.getTempPath(filename, normalizedDirectoryPath),
      filename,
      item: null,
      progress: 0,
      status: DownloadStatus.PENDING,
      message: undefined,
      receivedBytes: 0,
      totalBytes: 0,
    };
    this.downloads.set(downloadId, download);
    const downloadState = this.toDownloadState(download);
    this.reportProgress(downloadState);

    // TODO(robinhuang): Add offset support for resuming downloads.
    // Can use https://www.electronjs.org/docs/latest/api/session#sescreateinterrupteddownloadoptions
    this.enqueuePendingDownload(url, downloadId);
    session.defaultSession.downloadURL(url);
    return { ok: true, download: downloadState };
  }

  cancelDownload(downloadIdOrUrl: string): void {
    const download = this.findDownload(downloadIdOrUrl);
    if (!download) return;

    log.info('Cancelling download');
    if (download.item) {
      download.item.cancel();
      return;
    }

    download.status = DownloadStatus.CANCELLED;
    download.message = undefined;
    this.reportProgress(this.toDownloadState(download));
  }

  pauseDownload(downloadIdOrUrl: string): void {
    const download = this.findDownload(downloadIdOrUrl);
    if (!download?.item) return;

    log.info('Pausing download');
    download.item.pause();
  }

  resumeDownload(downloadIdOrUrl: string): void {
    this.resumeDownloadWithState(downloadIdOrUrl);
  }

  private resumeDownloadWithState(downloadIdOrUrl: string): StartDownloadResult | undefined {
    const download = this.findDownload(downloadIdOrUrl);
    if (!download) return undefined;

    if (!download.item) {
      this.deleteTempFile(download.tempPath);
      this.downloads.delete(download.downloadId);
      return this.startDownload(download.url, download.directoryPath, download.filename);
    }

    if (download.item.canResume()) {
      log.info('Resuming download');
      download.item.resume();
      download.status = DownloadStatus.IN_PROGRESS;
      download.message = undefined;
      const downloadState = this.toDownloadState(download);
      this.reportProgress(downloadState);
      return { ok: true, download: downloadState };
    } else {
      this.deleteTempFile(download.tempPath);
      this.downloads.delete(download.downloadId);
      return this.startDownload(download.url, download.directoryPath, download.filename);
    }
  }

  deleteModel(filename: string, savePath: string): boolean {
    const localSavePath = this.getLocalSavePath(filename, savePath);
    if (!this.isPathInModelsDirectory(localSavePath)) {
      log.error(`Save path ${localSavePath} is not in models directory ${this.modelsDirectory}`);
      return false;
    }
    const tempPath = this.getTempPath(filename, savePath);
    try {
      if (fs.existsSync(localSavePath)) {
        log.info(`Deleting local file ${localSavePath}`);
        fs.unlinkSync(localSavePath);
      }
    } catch (error) {
      log.error(`Failed to delete file ${localSavePath}:`, error);
    }

    try {
      if (fs.existsSync(tempPath)) {
        log.info(`Deleting temp file ${tempPath}`);
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      log.error(`Failed to delete file ${tempPath}:`, error);
    }
    this.downloads.delete(this.createDownloadId(localSavePath));
    return true;
  }

  getAllDownloads(): DownloadState[] {
    return [...this.downloads.values()].map((download) => this.toDownloadState(download));
  }

  private getTempPath(filename: string, directoryPath: string): string {
    return path.join(directoryPath, `Unconfirmed ${filename}.tmp`);
  }

  private calculateProgress(receivedBytes: number, totalBytes: number): number {
    if (totalBytes <= 0) return 0;
    return receivedBytes / totalBytes;
  }

  private toDownloadState(download: Download): DownloadState {
    const isPaused = download.status === DownloadStatus.PAUSED || download.item?.isPaused() || false;

    return {
      downloadId: download.downloadId,
      url: download.url,
      filename: download.filename,
      savePath: download.savePath,
      progress: download.progress,
      status: download.status,
      message: download.message,
      state: download.status,
      receivedBytes: download.receivedBytes,
      totalBytes: download.totalBytes,
      isPaused,
    };
  }

  private createDownloadId(savePath: string): string {
    return path.resolve(savePath);
  }

  private enqueuePendingDownload(url: string, downloadId: string): void {
    const pendingDownloadIds = this.pendingDownloadIdsByUrl.get(url) ?? [];
    pendingDownloadIds.push(downloadId);
    this.pendingDownloadIdsByUrl.set(url, pendingDownloadIds);
  }

  private takePendingDownload(url: string): Download | undefined {
    const pendingDownloadIds = this.pendingDownloadIdsByUrl.get(url);
    while (pendingDownloadIds?.length) {
      const downloadId = pendingDownloadIds.shift();
      const pendingDownload = downloadId ? this.downloads.get(downloadId) : undefined;
      if (pendingDownload?.status === DownloadStatus.PENDING && pendingDownload.item === null) {
        if (pendingDownloadIds.length === 0) {
          this.pendingDownloadIdsByUrl.delete(url);
        }
        return pendingDownload;
      }
    }
    if (pendingDownloadIds?.length === 0) {
      this.pendingDownloadIdsByUrl.delete(url);
    }
    return [...this.downloads.values()].find(
      (download) => download.url === url && download.status === DownloadStatus.PENDING && download.item === null
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private findDownload(downloadIdOrUrl: string): Download | undefined {
    return (
      this.downloads.get(downloadIdOrUrl) ??
      [...this.downloads.values()].find((download) => download.url === downloadIdOrUrl)
    );
  }

  private deleteTempFile(tempPath: string): void {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      log.error(`Failed to delete temp file ${tempPath}:`, error);
    }
  }

  // Only allow .safetensors files to be downloaded.
  private validateSafetensorsFile(url: string, filename: string): { isValid: boolean; error?: string } {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      if (!pathname.endsWith('.safetensors') && !filename.toLowerCase().endsWith('.safetensors')) {
        return {
          isValid: false,
          error: 'Invalid file type: must be a .safetensors file',
        };
      }
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: `Invalid URL format: ${error}`,
      };
    }
  }

  private getLocalSavePath(filename: string, directoryPath: string): string {
    return path.join(directoryPath, filename);
  }

  private normalizeDirectoryPath(directoryPath: string): string {
    return path.isAbsolute(directoryPath)
      ? path.resolve(directoryPath)
      : path.resolve(this.modelsDirectory, directoryPath);
  }

  /**
   * Ensure the target download directory exists without allowing symlink escapes
   * outside the models directory.
   * @param filePath The final file path to be downloaded.
   * @return `true` when the target directory exists and remains inside the models directory.
   */
  private ensureDownloadTargetDirectory(filePath: string): boolean {
    try {
      const targetDir = path.dirname(filePath);
      const nearestExistingAncestor = this.findNearestExistingAncestor(targetDir);
      if (!nearestExistingAncestor) {
        return false;
      }

      const realModelsDir = this.getPathForComparison(fs.realpathSync.native(this.modelsDirectory));
      const realAncestorDir = this.getPathForComparison(fs.realpathSync.native(nearestExistingAncestor));
      if (!this.isPathWithinDirectory(realModelsDir, realAncestorDir)) {
        return false;
      }

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      return this.isPathInModelsDirectory(filePath);
    } catch (error) {
      log.error(`Failed to prepare download target directory for ${filePath}`, error);
      return false;
    }
  }

  /**
   * Find the closest existing directory in the target path chain.
   * @param targetPath The path whose nearest existing ancestor should be resolved.
   * @return The nearest existing ancestor, or `null` when none can be found.
   */
  private findNearestExistingAncestor(targetPath: string): string | null {
    let currentPath = path.resolve(targetPath);

    while (!fs.existsSync(currentPath)) {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return null;
      }
      currentPath = parentPath;
    }

    return currentPath;
  }

  private isPathInModelsDirectory(filePath: string): boolean {
    try {
      const realModelsDir = this.getPathForComparison(fs.realpathSync.native(this.modelsDirectory));
      const realTargetDir = this.getPathForComparison(fs.realpathSync.native(path.dirname(filePath)));
      return this.isPathWithinDirectory(realModelsDir, realTargetDir);
    } catch (error) {
      log.error(`Failed to validate models directory containment for ${filePath}`, error);
      return false;
    }
  }

  /**
   * Check whether `candidatePath` is contained within `parentPath`.
   * @param parentPath The parent path.
   * @param candidatePath The path to check.
   * @return `true` if the candidate is the parent or a descendant of it.
   */
  private isPathWithinDirectory(parentPath: string, candidatePath: string): boolean {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private getPathForComparison(targetPath: string): string {
    return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  }

  private reportProgress(report: DownloadState): void {
    log.info(
      `Download progress [${report.filename}]: ${report.progress}, status: ${report.status}, message: ${report.message}`
    );
    this.mainWindow.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, { ...report });
  }

  public static getInstance(mainWindow: AppWindow, modelsDirectory: string): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager(mainWindow, modelsDirectory);
      DownloadManager.instance.registerIpcHandlers();
    }
    return DownloadManager.instance;
  }

  private registerIpcHandlers() {
    interface FileAndPath {
      filename: string;
      path: string;
    }
    interface DownloadDetails extends FileAndPath {
      url: string;
    }

    ipcMain.handle(IPC_CHANNELS.START_DOWNLOAD, (event, { url, path, filename }: DownloadDetails) =>
      this.startDownload(url, path, filename)
    );
    ipcMain.handle(IPC_CHANNELS.PAUSE_DOWNLOAD, (event, downloadId: string) => this.pauseDownload(downloadId));
    ipcMain.handle(IPC_CHANNELS.RESUME_DOWNLOAD, (event, downloadId: string) => this.resumeDownload(downloadId));
    ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, (event, downloadId: string) => this.cancelDownload(downloadId));
    ipcMain.handle(IPC_CHANNELS.GET_ALL_DOWNLOADS, () => this.getAllDownloads());

    ipcMain.handle(IPC_CHANNELS.DELETE_MODEL, (event, { filename, path }: FileAndPath) =>
      this.deleteModel(filename, path)
    );
  }
}
