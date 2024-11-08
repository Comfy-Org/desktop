import { BrowserWindow, screen, app, shell, ipcMain } from 'electron';
import path from 'node:path';
import Store from 'electron-store';
import { StoreType } from '../store';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '../constants';

export class AppWindow {
  private window: BrowserWindow;
  private store: Store<StoreType>;
  private messageQueue: Array<{ channel: string; data: any }> = [];
  private rendererReady: boolean = false;

  public constructor() {
    this.store = new Store<StoreType>();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    // Retrieve stored window size, or use default if not available
    const storedWidth = this.store?.get('windowWidth', width) ?? width;
    const storedHeight = this.store?.get('windowHeight', height) ?? height;
    const storedX = this.store?.get('windowX');
    const storedY = this.store?.get('windowY');

    this.window = new BrowserWindow({
      title: 'ComfyUI',
      width: storedWidth,
      height: storedHeight,
      x: storedX,
      y: storedY,
      webPreferences: {
        preload: path.join(__dirname, '../build/preload.js'),
        nodeIntegration: true,
        contextIsolation: true,
        webviewTag: true,
        devTools: true,
      },
      autoHideMenuBar: true,
    });

    this.setupWindowEvents();
    this.sendQueuedEventsOnReady();
    this.setupBeforeLoadEvents();
    this.loadRenderer();
  }

  public isReady(): boolean {
    return this.rendererReady;
  }

  public send(channel: string, data: any): void {
    if (!this.isReady()) {
      this.messageQueue.push({ channel, data });
      return;
    }

    // Send queued messages first
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.window) {
        this.window.webContents.send(message.channel, message.data);
      }
    }

    // Send current message
    this.window.webContents.send(channel, data);
  }

  public onClose(callback: () => void): void {
    if (!this.window) {
      log.error('Trying to set onClose callback but window is not ready');
      return;
    }
    this.window.on('close', callback);
  }

  public loadURL(url: string): void {
    if (!this.window) {
      log.error('Trying to load URL but window is not ready');
      return;
    }
    this.window.loadURL(url);
  }

  public openDevTools(): void {
    if (!this.window) {
      log.error('Trying to open dev tools but window is not ready');
      return;
    }
    this.window.webContents.openDevTools();
  }

  public show(): void {
    this.window.show();
  }

  public hide(): void {
    this.window.hide();
  }

  public isMinimized(): boolean {
    return this.window.isMinimized();
  }

  public restore(): void {
    this.window.restore();
  }

  public focus(): void {
    this.window.focus();
  }

  private async loadRenderer(): Promise<void> {
    if (process.env.VITE_DEV_SERVER_URL) {
      log.info('Loading Vite Dev Server');
      await this.window.loadURL(process.env.VITE_DEV_SERVER_URL);
      this.window.webContents.openDevTools();
    } else {
      this.window.loadFile(path.join(__dirname, `../renderer/index.html`));
    }
  }

  private setupWindowEvents(): void {
    const updateBounds = () => {
      if (!this.window) return;
      const { width, height, x, y } = this.window.getBounds();
      this.store.set('windowWidth', width);
      this.store.set('windowHeight', height);
      this.store.set('windowX', x);
      this.store.set('windowY', y);
    };

    this.window.on('resize', updateBounds);
    this.window.on('move', updateBounds);

    this.window.on('close', (e: Electron.Event) => {
      // Mac Only Behavior
      if (process.platform === 'darwin') {
        e.preventDefault();
        if (this.window) this.window.hide();
        app.dock.hide();
      }
    });

    this.window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  private setupBeforeLoadEvents(): void {
    this.window.webContents.on('did-finish-load', () => {
      this.send(IPC_CHANNELS.DEFAULT_INSTALL_LOCATION, app.getPath('documents'));
    });
  }

  private sendQueuedEventsOnReady(): void {
    ipcMain.on(IPC_CHANNELS.RENDERER_READY, () => {
      this.rendererReady = true;
      log.info('Received renderer-ready message!');
      // Send all queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          log.info('Sending queued message ', message.channel);
          this.send(message.channel, message.data);
        }
      }
    });
  }
}
