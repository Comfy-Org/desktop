import { BrowserWindow, screen, app, shell, ipcMain, Tray, Menu, dialog, MenuItem } from 'electron';
import path from 'node:path';
import Store from 'electron-store';
import { StoreType } from '../store';
import log from 'electron-log/main';
import { IPC_CHANNELS, ServerArgs } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

/**
 * Creates a single application window that displays the renderer and encapsulates all the logic for sending messages to the renderer.
 * Closes the application when the window is closed.
 */
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
    this.setupTray();
    this.buildMenu();
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
    this.window.on('close', () => {
      callback();
      // Currently, the application quits when the window is closed for all operating systems.
      app.quit();
    });
  }

  public loadComfyUI(serverArgs: ServerArgs) {
    this.window.loadURL(`http://${serverArgs.host}:${serverArgs.port}`);
  }

  public openDevTools(): void {
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

  public async loadRenderer(urlPath: string = ''): Promise<void> {
    if (process.env.DEV_SERVER_URL) {
      const url = `${process.env.DEV_SERVER_URL}/${urlPath}`;

      log.info(`Loading development server ${url}`);
      await this.window.loadURL(url);
      this.window.webContents.openDevTools();
    } else {
      const appResourcesPath = await getAppResourcesPath();
      const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');
      this.window.loadFile(path.join(frontendPath, 'index.html'), { hash: urlPath });
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

    this.window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
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
          log.info('Sending queued message ', message.channel, message.data);
          this.window.webContents.send(message.channel, message.data);
        }
      }
    });
  }

  setupTray() {
    // Set icon for the tray
    // I think there is a way to packaged the icon in so you don't need to reference resourcesPath
    const trayImage = path.join(
      app.isPackaged ? process.resourcesPath : './assets',
      'UI',
      process.platform === 'darwin' ? 'Comfy_Logo_x16_BW.png' : 'Comfy_Logo_x32.png'
    );
    let tray = new Tray(trayImage);

    tray.setToolTip('ComfyUI');

    // For Mac you can have a separate icon when you press.
    // The current design language for Mac Eco System is White or Black icon then when you click it is in color
    if (process.platform === 'darwin') {
      tray.setPressedImage(path.join(app.isPackaged ? process.resourcesPath : './assets', 'UI', 'Comfy_Logo_x16.png'));
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Comfy Window',
        click: () => {
          this.show();
          // Mac Only
          if (process.platform === 'darwin') {
            app.dock.show();
          }
        },
      },
      {
        label: 'Quit Comfy',
        click: () => {
          app.quit();
        },
      },
      {
        label: 'Hide',
        click: () => {
          this.hide();
          // Mac Only
          if (process.platform === 'darwin') {
            app.dock.hide();
          }
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    // If we want to make it more dynamic return tray so we can access it later
    return tray;
  }

  buildMenu() {
    const menu = Menu.getApplicationMenu();
    if (menu) {
      const aboutMenuItem = {
        label: 'About ComfyUI',
        click: () => {
          dialog.showMessageBox({
            title: 'About',
            message: `ComfyUI v${app.getVersion()}`,
            detail: 'Created by Comfy Org\nCopyright © 2024',
            buttons: ['OK'],
          });
        },
      };
      const helpMenuItem = menu.items.find((item) => item.role === 'help');
      if (helpMenuItem && helpMenuItem.submenu) {
        helpMenuItem.submenu.append(new MenuItem(aboutMenuItem));
        Menu.setApplicationMenu(menu);
      } else {
        // If there's no Help menu, add one
        menu.append(
          new MenuItem({
            label: 'Help',
            submenu: [aboutMenuItem],
          })
        );
        Menu.setApplicationMenu(menu);
      }
    }
  }
}
