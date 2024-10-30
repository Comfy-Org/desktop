import { BrowserWindow, session, DownloadItem, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../constants';
import log from 'electron-log/main';

interface Download {
  url: string;
  filename: string;
  tempPath: string; // Temporary filename until the download is complete.
  savePath: string;
  item: DownloadItem | null;
}

export enum DownloadStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}
interface DownloadState {
  url: string;
  filename: string;
  state: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  isPaused: boolean;
}

/**
 * Singleton class that manages downloading model checkpoints for ComfyUI.
 */
export class DownloadManager {
  private static instance: DownloadManager;
  private downloads: Map<string, Download>;
  private mainWindow: BrowserWindow;
  private modelsDirectory: string;
  private constructor(mainWindow: BrowserWindow, modelsDirectory: string) {
    this.downloads = new Map();
    this.mainWindow = mainWindow;
    this.modelsDirectory = modelsDirectory;

    session.defaultSession.on('will-download', (event, item, webContents) => {
      const url = item.getURLChain()[0]; // Get the original URL in case of redirects.
      log.info('Will-download event ', url);
      const download = this.downloads.get(url);

      if (download) {
        this.reportProgress(url, 0, DownloadStatus.PENDING);
        item.setSavePath(download.tempPath);
        download.item = item;
        log.info(`Setting save path to ${item.getSavePath()}`);

        item.on('updated', (event, state) => {
          if (state === 'interrupted') {
            log.info('Download is interrupted but can be resumed');
          } else if (state === 'progressing') {
            const progress = item.getReceivedBytes() / item.getTotalBytes();
            if (item.isPaused()) {
              log.info('Download is paused');
              this.reportProgress(url, progress, DownloadStatus.PAUSED);
            } else {
              this.reportProgress(url, progress, DownloadStatus.IN_PROGRESS);
            }
          }
        });

        item.once('done', (event, state) => {
          if (state === 'completed') {
            try {
              fs.renameSync(download.tempPath, download.savePath);
              log.info(`Successfully renamed ${download.tempPath} to ${download.savePath}`);
            } catch (error) {
              log.error(`Failed to rename downloaded file: ${error}. Deleting temp file.`);
              fs.unlinkSync(download.tempPath);
            }
            this.reportProgress(url, 1, DownloadStatus.COMPLETED);
            this.downloads.delete(url);
          } else {
            log.info(`Download failed: ${state}`);
            const progress = item.getReceivedBytes() / item.getTotalBytes();
            this.reportProgress(url, progress, DownloadStatus.ERROR);
          }
        });
      }
    });
  }

  startDownload(url: string, savePath: string, filename: string): boolean {
    const localSavePath = this.getLocalSavePath(filename, savePath);
    if (!this.isPathInModelsDirectory(localSavePath)) {
      log.error(`Save path ${localSavePath} is not in models directory ${this.modelsDirectory}`);
      this.reportProgress(url, 0, DownloadStatus.ERROR, 'Save path is not in models directory');
      return false;
    }

    const validationResult = this.validateSafetensorsFile(url, filename);
    if (!validationResult.isValid) {
      log.error(validationResult.error);
      this.reportProgress(url, 0, DownloadStatus.ERROR, validationResult.error);
      return false;
    }

    if (fs.existsSync(localSavePath)) {
      log.info(`File ${filename} already exists, skipping download`);
      return true;
    }

    const existingDownload = this.downloads.get(url);
    if (existingDownload) {
      log.info('Download already exists');
      if (existingDownload.item && existingDownload.item.isPaused()) {
        this.resumeDownload(url);
      }
      return true;
    }

    log.info(`Starting download ${url} to ${localSavePath}`);
    const tempPath = this.getTempPath(filename, savePath);
    this.downloads.set(url, { url, savePath: localSavePath, tempPath, filename, item: null });

    // TODO(robinhuang): Add offset support for resuming downloads.
    // Can use https://www.electronjs.org/docs/latest/api/session#sescreateinterrupteddownloadoptions
    session.defaultSession.downloadURL(url);
    return true;
  }

  cancelDownload(url: string): void {
    const download = this.downloads.get(url);
    if (download && download.item) {
      log.info('Cancelling download');
      download.item.cancel();
    }
  }

  pauseDownload(url: string): void {
    const download = this.downloads.get(url);
    if (download && download.item) {
      log.info('Pausing download');
      download.item.pause();
    }
  }

  resumeDownload(url: string): void {
    const download = this.downloads.get(url);
    if (download) {
      if (download.item && download.item.canResume()) {
        log.info('Resuming download');
        download.item.resume();
      } else {
        this.startDownload(download.url, download.savePath, download.filename);
      }
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
      log.error(`Failed to delete file ${localSavePath}: ${error}`);
    }

    try {
      if (fs.existsSync(tempPath)) {
        log.info(`Deleting temp file ${tempPath}`);
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      log.error(`Failed to delete file ${tempPath}: ${error}`);
    }
    return true;
  }

  getAllDownloads(): DownloadState[] {
    return Array.from(this.downloads.values())
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
        return DownloadStatus.ERROR;
      default:
        return DownloadStatus.ERROR;
    }
  }

  private getTempPath(filename: string, savePath: string): string {
    return path.join(this.modelsDirectory, savePath, `Unconfirmed ${filename}.tmp`);
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

  private getLocalSavePath(filename: string, savePath: string): string {
    return path.join(this.modelsDirectory, savePath, filename);
  }

  private isPathInModelsDirectory(filePath: string): boolean {
    const absoluteFilePath = path.resolve(filePath);
    const absoluteModelsDir = path.resolve(this.modelsDirectory);
    return absoluteFilePath.startsWith(absoluteModelsDir);
  }

  private reportProgress(url: string, progress: number, status: DownloadStatus, message: string = ''): void {
    log.info(`Download progress: ${progress}, status: ${status}, message: ${message}`);
    this.mainWindow.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      url,
      progress,
      status,
      message,
    });
  }

  public static getInstance(mainWindow: BrowserWindow, modelsDirectory: string): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager(mainWindow, modelsDirectory);
      DownloadManager.instance.registerIpcHandlers();
    }
    return DownloadManager.instance;
  }

  private registerIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.START_DOWNLOAD, (event, { url, path, filename }) =>
      this.startDownload(url, path, filename)
    );
    ipcMain.handle(IPC_CHANNELS.PAUSE_DOWNLOAD, (event, url: string) => this.pauseDownload(url));
    ipcMain.handle(IPC_CHANNELS.RESUME_DOWNLOAD, (event, url: string) => this.resumeDownload(url));
    ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, (event, url: string) => this.cancelDownload(url));
    ipcMain.handle(IPC_CHANNELS.GET_ALL_DOWNLOADS, (event) => this.getAllDownloads());
    ipcMain.handle(IPC_CHANNELS.DELETE_MODEL, (event, { filename, path }) => this.deleteModel(filename, path));
  }
}
