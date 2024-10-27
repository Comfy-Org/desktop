import { BrowserWindow, session, DownloadItem, ipcMain } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from '../constants';
import log from 'electron-log/main';

interface Download {
  url: string;
  filename: string;
  savePath: string;
  item: DownloadItem | null;
}

export class DownloadManager {
  private static instance: DownloadManager;
  private downloads: Map<string, Download>;
  private mainWindow: BrowserWindow;
  constructor(mainWindow: BrowserWindow) {
    this.downloads = new Map();
    this.mainWindow = mainWindow;

    session.defaultSession.on('will-download', (event, item, webContents) => {
      const url = item.getURL();
      const download = this.downloads.get(url);

      if (download) {
        item.setSavePath(download.savePath);
        download.item = item;

        item.on('updated', (event, state) => {
          if (state === 'interrupted') {
            log.info('Download is interrupted but can be resumed');
          } else if (state === 'progressing') {
            if (item.isPaused()) {
              log.info('Download is paused');
            } else {
              const progress = item.getReceivedBytes() / item.getTotalBytes();
              this.reportProgress(url, progress);
            }
          }
        });

        item.once('done', (event, state) => {
          if (state === 'completed') {
            this.reportProgress(url, 1, true);
          } else {
            log.info(`Download failed: ${state}`);
            this.reportProgress(url, 0, false, true);
          }
          this.downloads.delete(url);
        });
      }
    });
  }

  startDownload(url: string, savePath: string): void {
    const existingDownload = this.downloads.get(url);
    if (existingDownload) {
      log.info('Download already exists');
      if (existingDownload.item && existingDownload.item.isPaused()) {
        this.resumeDownload(url);
      }
      return;
    }
    const filename = path.basename(savePath);
    this.downloads.set(url, { url, filename, savePath, item: null });
    session.defaultSession.downloadURL(url);
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
        this.startDownload(download.url, download.savePath);
      }
    }
  }

  getAllDownloads(): DownloadItem[] {
    return Array.from(this.downloads.values())
      .map((download) => download.item)
      .filter((item): item is DownloadItem => item !== null);
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

  public static getInstance(mainWindow: BrowserWindow): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager(mainWindow);
      DownloadManager.instance.registerIpcHandlers();
    }
    return DownloadManager.instance;
  }

  private registerIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.START_DOWNLOAD, (event, { url, path }) => this.startDownload(url, path));
    ipcMain.handle(IPC_CHANNELS.PAUSE_DOWNLOAD, (event, url: string) => this.pauseDownload(url));
    ipcMain.handle(IPC_CHANNELS.RESUME_DOWNLOAD, (event, url: string) => this.resumeDownload(url));
    ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, (event, url: string) => this.cancelDownload(url));
    ipcMain.handle(IPC_CHANNELS.GET_ALL_DOWNLOADS, (event) => this.getAllDownloads());
  }
}
