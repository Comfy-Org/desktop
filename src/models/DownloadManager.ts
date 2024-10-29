import { BrowserWindow, session, DownloadItem, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../constants';
import log from 'electron-log/main';

interface Download {
  url: string;
  filename: string;
  tempPath: string; // Temporary filename until the download is complete.
  savePath: string;
  item: DownloadItem | null;
}

interface DownloadStatus {
  url: string;
  filename: string;
  state: string;
  receivedBytes: number;
  totalBytes: number;
  isPaused: boolean;
}

export class DownloadManager {
  private static instance: DownloadManager;
  private downloads: Map<string, Download>;
  private mainWindow: BrowserWindow;
  private modelsDirectory: string;
  constructor(mainWindow: BrowserWindow, modelsDirectory: string) {
    this.downloads = new Map();
    this.mainWindow = mainWindow;
    this.modelsDirectory = modelsDirectory;

    session.defaultSession.on('will-download', (event, item, webContents) => {
      const url = item.getURLChain()[0]; // Get the original URL in case of redirects.
      log.info('Will-download event ', url);
      const download = this.downloads.get(url);

      if (download) {
        item.setSavePath(download.tempPath);
        download.item = item;
        log.info(`Setting save path to ${item.getSavePath()}`);

        item.on('updated', (event, state) => {
          if (state === 'interrupted') {
            log.info('Download is interrupted but can be resumed');
          } else if (state === 'progressing') {
            if (item.isPaused()) {
              log.info('Download is paused');
            } else {
              const progress = item.getReceivedBytes() / item.getTotalBytes();
              log.info(`Download progress: ${progress}`);
              this.reportProgress(url, progress);
            }
          }
        });

        item.once('done', (event, state) => {
          if (state === 'completed') {
            try {
              fs.renameSync(download.tempPath, download.savePath);
              log.info(`Successfully renamed ${download.tempPath} to ${download.savePath}`);
            } catch (error) {
              fs.unlinkSync(download.tempPath);
              log.error(`Failed to rename downloaded file: ${error}`);
            }
            this.reportProgress(url, 1, true);
            this.downloads.delete(url);
          } else {
            log.info(`Download failed: ${state}`);
            const progress = item.getReceivedBytes() / item.getTotalBytes();
            this.reportProgress(url, progress, false, true);
          }
        });
      }
    });
  }

  startDownload(url: string, savePath: string, filename: string): boolean {
    const localSavePath = this.getLocalSavePath(filename, savePath);

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

  deleteDownload(url: string, filename: string, savePath: string): void {
    this.downloads.delete(url);
    const localSavePath = this.getLocalSavePath(filename, savePath);
    const tempPath = this.getTempPath(filename, savePath);
    try {
      if (fs.existsSync(localSavePath)) {
        fs.unlinkSync(localSavePath);
      }
    } catch (error) {
      log.error(`Failed to delete file ${localSavePath}: ${error}`);
    }

    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      log.error(`Failed to delete file ${tempPath}: ${error}`);
    }
  }

  getAllDownloads(): DownloadStatus[] {
    return Array.from(this.downloads.values())
      .filter((download) => download.item !== null)
      .map((download) => ({
        url: download.url,
        filename: download.filename,
        tempPath: download.tempPath,
        state: download.item?.getState() || 'interrupted',
        receivedBytes: download.item?.getReceivedBytes() || 0,
        totalBytes: download.item?.getTotalBytes() || 0,
        isPaused: download.item?.isPaused() || false,
      }));
  }

  private getTempPath(filename: string, savePath: string): string {
    return path.join(this.modelsDirectory, savePath, `Unconfirmed ${filename}.tmp`);
  }

  private getLocalSavePath(filename: string, savePath: string): string {
    return path.join(this.modelsDirectory, savePath, filename);
  }

  private reportProgress(
    url: string,
    progress: number,
    isComplete: boolean = false,
    isCancelled: boolean = false
  ): void {
    this.mainWindow.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      url,
      progress,
      isComplete,
      isCancelled,
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
    ipcMain.handle(IPC_CHANNELS.DELETE_DOWNLOAD, (event, { url, filename, path }) =>
      this.deleteDownload(url, filename, path)
    );
  }
}
