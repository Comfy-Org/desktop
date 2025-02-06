import {
  BrowserWindow,
  Menu,
  MenuItem,
  type TitleBarOverlayOptions,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell,
} from 'electron';
import log from 'electron-log/main';
import Store from 'electron-store';
import path from 'node:path';
import { URL } from 'node:url';

import { ElectronError } from '@/infrastructure/electronError';
import type { Page } from '@/infrastructure/interfaces';
import type { IAppState } from '@/main-process/appState';

import { IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';
import type { ElectronContextMenuOptions } from '../preload';
import { AppWindowSettings } from '../store/AppWindowSettings';
import { useDesktopConfig } from '../store/desktopConfig';

/**
 * Creates a single application window that displays the renderer and encapsulates all the logic for sending messages to the renderer.
 * Closes the application when the window is closed.
 */
export class AppWindow {
  private readonly window: BrowserWindow;
  /** Volatile store containing window config - saves window state between launches. */
  private readonly store: Store<AppWindowSettings>;
  private readonly messageQueue: Array<{ channel: string; data: unknown }> = [];
  private rendererReady: boolean = false;
  /** Default dark mode config for system window overlay (min/max/close window). */
  private readonly darkOverlay = { color: '#00000000', symbolColor: '#ddd' };
  /** Default light mode config for system window overlay (min/max/close window). */
  private readonly lightOverlay = { ...this.darkOverlay, symbolColor: '#333' };
  /** The application menu. */
  private readonly menu: Electron.Menu | null;
  /** The "edit" menu - cut/copy/paste etc. */
  private editMenu?: Menu;
  /** Whether this window was created with title bar overlay enabled. When `false`, Electron throws when calling {@link BrowserWindow.setTitleBarOverlay}. */
  public readonly customWindowEnabled: boolean =
    process.platform !== 'darwin' && useDesktopConfig().get('windowStyle') === 'custom';

  /** Always returns `undefined` in production. When running unpackaged, returns `DEV_SERVER_URL` if set, otherwise `undefined`. */
  private get devUrlOverride() {
    if (!app.isPackaged) return process.env.DEV_SERVER_URL;
  }

  public constructor(private readonly appState: IAppState) {
    const installed = useDesktopConfig().get('installState') === 'installed';
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = installed ? primaryDisplay.workAreaSize : { width: 1024, height: 768 };
    const store = this.loadWindowStore();
    this.store = store;

    const storedWidth = store.get('windowWidth');
    const storedHeight = store.get('windowHeight');
    const storedX = store.get('windowX');
    const storedY = store.get('windowY');

    // macOS requires different handling to linux / win32
    const customChrome: Electron.BrowserWindowConstructorOptions = this.customWindowEnabled
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: nativeTheme.shouldUseDarkColors ? this.darkOverlay : this.lightOverlay,
        }
      : {};

    this.window = new BrowserWindow({
      title: 'ComfyUI',
      width: Math.max(storedWidth, 100),
      height: Math.max(storedHeight, 100),
      minWidth: 640,
      minHeight: 640,
      x: Math.max(storedX ?? 0, 0),
      y: Math.max(storedY ?? 0, 0),
      webPreferences: {
        // eslint-disable-next-line unicorn/prefer-module
        preload: path.join(__dirname, '../build/preload.cjs'),
        nodeIntegration: true,
        contextIsolation: true,
        webviewTag: true,
        devTools: true,
      },
      show: false,
      autoHideMenuBar: true,
      ...customChrome,
    });
    this.window.once('ready-to-show', () => this.window.show());

    if (!installed && storedX === undefined) this.window.center();
    if (store.get('windowMaximized')) this.window.maximize();

    this.setupWindowEvents();
    this.setupAppEvents();
    this.setupIpcEvents();
    this.sendQueuedEventsOnReady();
    this.setupTray();
    this.menu = this.buildMenu();
    this.buildTextMenu();
  }

  public isReady(): boolean {
    return this.rendererReady;
  }

  public send(channel: string, data: unknown): void {
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

  /**
   * Report progress of server start.
   * @param status - The status of the server start progress.
   */
  sendServerStartProgress(status: ProgressStatus): void {
    this.send(IPC_CHANNELS.LOADING_PROGRESS, { status });
  }

  public async loadComfyUI(serverArgs: ServerArgs) {
    const host = serverArgs.listen === '0.0.0.0' ? 'localhost' : serverArgs.listen;
    const url = this.devUrlOverride ?? `http://${host}:${serverArgs.port}`;
    await this.window.loadURL(url);
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

  public maximize(): void {
    this.window.maximize();
  }

  /**
   * Checks if the window is currently on the specified page by parsing the browser URL.
   * @param page The frontend route portion of the URL to match against
   * @returns `true` if the window is currently on the specified page, otherwise `false`
   */
  isOnPage(page: Page): boolean {
    const rawUrl = this.window.webContents.getURL();
    const url = new URL(rawUrl);
    if (!url) return page === '';

    const prefixedPage = url.protocol === 'file:' ? url.hash : url.pathname;
    return page === prefixedPage.slice(1);
  }

  /**
   * Loads a frontend page.
   *
   * In production, this is via the file:// protocol. Dev environments can utilise a dev server.
   * @param page The page to load; a valid entry in the frontend router.
   */
  public async loadPage(page: Page): Promise<void> {
    this.appState.currentPage = page;

    const { devUrlOverride } = this;
    if (devUrlOverride) {
      const url = `${devUrlOverride}/${page}`;
      /**
       * rendererReady should be set by the frontend via electronAPI. However,
       * for some reason, the event is not being received if we load the app
       * from the external server.
       * TODO: Look into why dev server ready event is not being received.
       */
      this.rendererReady = true;
      log.info(`Loading development server ${url}`);
      if (process.env.DEV_TOOLS_AUTO === 'true') this.window.webContents.openDevTools();
      await this.window.loadURL(url);
    } else {
      // TODO: Remove this temporary workaround when RENDERER_READY is reworked.
      if (page === 'maintenance') this.rendererReady = true;

      const appResourcesPath = getAppResourcesPath();
      const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');
      try {
        await this.window.loadFile(path.join(frontendPath, 'index.html'), { hash: page });
      } catch (error) {
        const electronError = ElectronError.fromCaught(error);

        // Ignore fallacious Chromium error
        if (electronError?.isGenericChromiumError()) {
          log.verbose('Ignoring Chromium page load error - occurs when requests are sent too fast.');
          return;
        }
        throw electronError ?? error;
      }
    }
  }

  /** Opens a modal file/folder picker. @inheritdoc {@link Electron.Dialog.showOpenDialog} */
  public async showOpenDialog(options: Electron.OpenDialogOptions) {
    return await dialog.showOpenDialog(this.window, options);
  }

  /** Opens a modal message box. @inheritdoc {@link Electron.Dialog.showMessageBox} */
  public async showMessageBox(options: Electron.MessageBoxOptions) {
    return await dialog.showMessageBox(this.window, options);
  }

  /**
   * Loads window state from `userData` via `electron-store`.  Overwrites invalid config with defaults.
   * @returns The electron store for non-critical window state (size/position etc)
   * @throws Rethrows errors received from `electron-store` and `app.getPath('userData')`.
   * There are edge cases where this might not be a catastrophic failure, but inability
   * to write to our own datastore may result in unexpected user data loss.
   */
  private loadWindowStore(): Store<AppWindowSettings> {
    try {
      // Separate file for non-critical convenience settings - just resets itself if invalid
      return new Store<AppWindowSettings>({
        clearInvalidConfig: true,
        name: 'window',
      });
    } catch (error) {
      // Crash: Unknown filesystem error, permission denied on user data folder, etc
      log.error(`Unknown error whilst loading window configuration.`, error);
      try {
        dialog.showErrorBox(
          'User Data',
          `Unknown error whilst writing to user data folder:\n\n${app.getPath('userData')}`
        );
      } catch (error) {
        // Crash: Can't even find the user userData folder
        log.error('Cannot find user data folder.', error);
        dialog.showErrorBox('Invalid Environment', 'Unknown error whilst attempting to determine user data folder.');
        throw error;
      }
      throw error;
    }
  }

  private setupWindowEvents(): void {
    const updateBounds = () => {
      if (!this.window) return;

      // If maximized, do not update position / size.
      const isMaximized = this.window.isMaximized();
      this.store.set('windowMaximized', isMaximized);
      if (isMaximized) return;

      const { width, height, x, y } = this.window.getBounds();
      this.store.set('windowWidth', width);
      this.store.set('windowHeight', height);
      this.store.set('windowX', x);
      this.store.set('windowY', y);
    };

    this.window.on('resize', updateBounds);
    this.window.on('move', updateBounds);
    this.window.on('close', () => log.info('App window closed.'));

    this.window.webContents.setWindowOpenHandler(({ url }) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  private setupAppEvents(): void {
    app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
      log.info('Received second instance message!');
      log.info(additionalData);

      if (this.isMinimized()) this.restore();
      this.focus();
    });
  }

  private setupIpcEvents() {
    ipcMain.on(IPC_CHANNELS.CHANGE_THEME, (_event, options: TitleBarOverlayOptions) => {
      this.changeTheme(options);
    });
    ipcMain.on(IPC_CHANNELS.SHOW_CONTEXT_MENU, (_event, options?: ElectronContextMenuOptions) => {
      this.showSystemContextMenu(options);
    });
    ipcMain.on(IPC_CHANNELS.OPEN_DEV_TOOLS, () => {
      this.openDevTools();
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

  changeTheme(options: TitleBarOverlayOptions): void {
    if (!this.customWindowEnabled) return;

    options.height &&= Math.round(options.height);
    if (!options.height) delete options.height;
    this.window.setTitleBarOverlay(options);
  }

  showSystemContextMenu(options?: ElectronContextMenuOptions): void {
    if (options?.type === 'text') {
      this.editMenu?.popup(options.pos);
    } else {
      this.menu?.popup(options?.pos);
    }
  }

  setupTray() {
    // Set icon for the tray
    // I think there is a way to packaged the icon in so you don't need to reference resourcesPath
    const trayImage = path.join(
      app.isPackaged ? process.resourcesPath : './assets',
      'UI',
      process.platform === 'darwin' ? 'Comfy_Logo_x16_BW.png' : 'Comfy_Logo_x32.png'
    );
    const tray = new Tray(trayImage);

    tray.setToolTip('ComfyUI');
    tray.on('double-click', () => this.show());

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
            app.dock.show().catch((error) => {
              log.error('Error showing dock', error);
            });
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

  buildTextMenu() {
    // Electron bug - strongly typed to the incorrect case.
    this.editMenu = Menu.getApplicationMenu()?.items.find((x) => x.role?.toLowerCase() === 'editmenu')?.submenu;
  }

  buildMenu() {
    const menu = Menu.getApplicationMenu();
    if (menu) {
      const aboutMenuItem = {
        label: 'About ComfyUI',
        click: () => {
          dialog
            .showMessageBox({
              title: 'About',
              message: `ComfyUI v${app.getVersion()}`,
              detail: 'Created by Comfy Org\nCopyright © 2024',
              buttons: ['OK'],
            })
            .catch((error) => {
              log.error('Error showing about dialog', error);
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
    return menu;
  }
}
