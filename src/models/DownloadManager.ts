import { DownloadItem, session } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { strictIpcMain as ipcMain } from '@/infrastructure/ipcChannels';

import { DownloadStatus, IPC_CHANNELS } from '../constants';
import type { AppWindow } from '../main-process/appWindow';

const MAX_AUTO_RESUME_ATTEMPTS = 2;

export interface Download {
  url: string;
  filename: string;
  tempPath: string; // Temporary filename until the download is complete.
  savePath: string;
  item: DownloadItem | null;
  /** Number of times we have auto-resumed after an interrupt (stops interrupt→resume loops). */
  interruptResumeCount: number;
}

export interface DownloadState {
  url: string;
  filename: string;
  state: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  isPaused: boolean;
}

interface DownloadReport {
  url: string;
  progress: number;
  status: DownloadStatus;
  filename: string;
  savePath: string;
  message?: string;
}

/**
 * Singleton class that manages downloading model checkpoints for ComfyUI.
 */
export class DownloadManager {
  private static instance: DownloadManager;
  private readonly downloads: Map<string, Download>;

  private constructor(
    private readonly mainWindow: AppWindow,
    private readonly modelsDirectory: string
  ) {
    this.downloads = new Map();

    session.defaultSession.on('will-download', (event, item) => {
      const url = item.getURLChain()[0]; // Get the original URL in case of redirects.
      log.info('Will-download event', url);
      const download = this.downloads.get(url);
      if (!download) return;

      this.reportProgress({
        url,
        filename: download.filename,
        savePath: download.savePath,
        progress: 0,
        status: DownloadStatus.PENDING,
      });
      item.setSavePath(download.tempPath);
      download.item = item;
      log.info(`Setting save path to ${item.getSavePath()}`);

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          log.info('Download is interrupted but can be resumed');
          const totalBytes = item.getTotalBytes();
          const progress = totalBytes > 0 ? item.getReceivedBytes() / totalBytes : 0;
          const liveEntry = this.downloads.get(url);
          const autoResumesLeft = MAX_AUTO_RESUME_ATTEMPTS - (liveEntry?.interruptResumeCount ?? 0);
          const willAutoResume = item.canResume() && autoResumesLeft > 0;
          this.reportProgress({
            url,
            progress,
            filename: download.filename,
            savePath: download.savePath,
            status: DownloadStatus.PAUSED,
            message: willAutoResume ? 'Interrupted, resuming…' : 'Interrupted, can be resumed',
          });
          if (item.canResume() && autoResumesLeft > 0) {
            setTimeout(() => {
              const entry = this.downloads.get(url);
              if (entry?.item === item && item.getState() === 'interrupted') {
                entry.interruptResumeCount += 1;
                log.info('Auto-resuming interrupted download');
                item.resume();
              }
            }, 500);
          }
        } else if (state === 'progressing') {
          const progress = item.getReceivedBytes() / item.getTotalBytes();
          if (item.isPaused()) {
            log.info('Download is paused');
            this.reportProgress({
              url,
              progress,
              filename: download.filename,
              savePath: download.savePath,
              status: DownloadStatus.PAUSED,
            });
          } else {
            this.reportProgress({
              url,
              progress,
              filename: download.filename,
              savePath: download.savePath,
              status: DownloadStatus.IN_PROGRESS,
            });
          }
        }
      });

      item.once('done', (event, state) => {
        if (state === 'completed') {
          try {
            fs.renameSync(download.tempPath, download.savePath);
            log.info(`Successfully renamed ${download.tempPath} to ${download.savePath}`);
          } catch (error) {
            log.error('Failed to rename downloaded file. Deleting temp file.', error);
            fs.unlinkSync(download.tempPath);
          }
          this.reportProgress({
            url,
            filename: download.filename,
            savePath: download.savePath,
            progress: 1,
            status: DownloadStatus.COMPLETED,
          });
          this.downloads.delete(url);
        } else {
          log.info(`Download failed: ${state}`);
          const progress = item.getReceivedBytes() / item.getTotalBytes();
          this.reportProgress({
            url,
            filename: download.filename,
            progress,
            status: DownloadStatus.ERROR,
            savePath: download.savePath,
          });
          this.downloads.delete(url);
        }
      });
    });
  }

  startDownload(url: string, savePath: string, filename: string): boolean {
    const localSavePath = this.getLocalSavePath(filename, savePath);
    if (!this.isPathInModelsDirectory(localSavePath)) {
      log.error(`Save path ${localSavePath} is not in models directory ${this.modelsDirectory}`);
      this.reportProgress({
        url,
        savePath,
        filename,
        progress: 0,
        status: DownloadStatus.ERROR,
        message: 'Save path is not in models directory',
      });
      return false;
    }

    const validationResult = this.validateSafetensorsFile(url, filename);
    if (!validationResult.isValid) {
      log.error(validationResult.error);
      this.reportProgress({
        url,
        savePath,
        filename,
        progress: 0,
        status: DownloadStatus.ERROR,
        message: validationResult.error,
      });
      return false;
    }

    if (fs.existsSync(localSavePath)) {
      log.info(`File ${filename} already exists, skipping download`);
      return true;
    }

    const existingDownload = this.downloads.get(url);
    if (existingDownload) {
      log.info('Download already exists');
      if (existingDownload.item?.isPaused()) {
        this.resumeDownload(url);
      }
      return true;
    }

    log.info(`Starting download ${url} to ${localSavePath}`);
    const tempPath = this.getTempPath(filename, savePath);
    this.downloads.set(url, {
      url,
      savePath: localSavePath,
      tempPath,
      filename,
      item: null,
      interruptResumeCount: 0,
    });

    // TODO(robinhuang): Add offset support for resuming downloads.
    // Can use https://www.electronjs.org/docs/latest/api/session#sescreateinterrupteddownloadoptions
    session.defaultSession.downloadURL(url);
    return true;
  }

  cancelDownload(url: string): void {
    const download = this.downloads.get(url);
    if (!download?.item) return;

    log.info('Cancelling download');
    download.item.cancel();

    this.downloads.delete(url);
  }

  pauseDownload(url: string): void {
    const download = this.downloads.get(url);
    if (!download?.item) return;

    log.info('Pausing download');
    download.item.pause();
  }

  resumeDownload(url: string): void {
    const download = this.downloads.get(url);
    if (!download?.item) return;

    if (download.item.canResume()) {
      log.info('Resuming download');
      download.item.resume();
    } else {
      this.startDownload(download.url, download.savePath, download.filename);
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
    return true;
  }

  getAllDownloads(): DownloadState[] {
    return [...this.downloads.values()]
      .filter((download) => download.item !== null)
      .map((download) => ({
        url: download.url,
        filename: download.filename,
        tempPath: download.tempPath,
        state: this.convertDownloadState(download.item?.getState()),
        receivedBytes: download.item?.getReceivedBytes() || 0,
        totalBytes: download.item?.getTotalBytes() || 0,
        isPaused: download.item?.isPaused() || false,
      }));
  }

  private convertDownloadState(state?: 'progressing' | 'completed' | 'cancelled' | 'interrupted'): DownloadStatus {
    switch (state) {
      case 'progressing':
        return DownloadStatus.IN_PROGRESS;
      case 'completed':
        return DownloadStatus.COMPLETED;
      case 'cancelled':
        return DownloadStatus.CANCELLED;
      case 'interrupted':
        return DownloadStatus.PAUSED;
      default:
        return DownloadStatus.ERROR;
    }
  }

  private getTempPath(filename: string, savePath: string): string {
    const subPath = this.resolveSavePath(savePath, filename);
    return path.join(this.modelsDirectory, subPath, `Unconfirmed ${filename}.tmp`);
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

  /**
   * Resolve savePath to a path under modelsDirectory.
   * If the caller passes an absolute path that is under modelsDirectory (e.g. from the UI),
   * we use the relative part so path.join does not duplicate the base path.
   */
  private resolveSavePath(savePath: string, filename: string): string {
    const base = path.resolve(this.modelsDirectory);
    const resolved = path.resolve(savePath);
    if (resolved.startsWith(base)) {
      const rel = path.relative(base, resolved);
      return rel.endsWith(filename) ? path.dirname(rel) : rel;
    }
    return savePath;
  }

  private getLocalSavePath(filename: string, savePath: string): string {
    const subPath = this.resolveSavePath(savePath, filename);
    return path.join(this.modelsDirectory, subPath, filename);
  }

  private isPathInModelsDirectory(filePath: string): boolean {
    const absoluteFilePath = path.resolve(filePath);
    const absoluteModelsDir = path.resolve(this.modelsDirectory);
    return absoluteFilePath.startsWith(absoluteModelsDir);
  }

  private reportProgress(report: DownloadReport): void {
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
    ipcMain.handle(IPC_CHANNELS.PAUSE_DOWNLOAD, (event, url: string) => this.pauseDownload(url));
    ipcMain.handle(IPC_CHANNELS.RESUME_DOWNLOAD, (event, url: string) => this.resumeDownload(url));
    ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, (event, url: string) => this.cancelDownload(url));
    ipcMain.handle(IPC_CHANNELS.GET_ALL_DOWNLOADS, () => this.getAllDownloads());

    ipcMain.handle(IPC_CHANNELS.DELETE_MODEL, (event, { filename, path }: FileAndPath) =>
      this.deleteModel(filename, path)
    );
  }
}
