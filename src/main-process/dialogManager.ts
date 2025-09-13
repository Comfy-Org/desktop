import { BrowserWindow, app, ipcMain, shell } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

export interface DialogButton {
  label: string;
  action: 'close' | 'openUrl';
  /** Optional severity of the button (e.g. delete "danger"). Maps to PrimeVueSeverity enum. */
  severity?: 'info' | 'warn' | 'danger';
  url?: string;
  returnValue?: string;
}

export interface DialogOptions {
  title: string;
  message: string;
  buttons: DialogButton[];
  width?: number;
  height?: number;
}

export class DialogManager {
  private static instance: DialogManager;
  private activeDialog: BrowserWindow | null = null;

  private constructor() {}

  static getInstance(): DialogManager {
    if (!DialogManager.instance) {
      DialogManager.instance = new DialogManager();
    }
    return DialogManager.instance;
  }

  /**
   * Shows a custom dialog window with the specified options
   * @param parent The parent BrowserWindow
   * @param options Dialog configuration options
   * @returns Promise that resolves with the user's selection or null if closed
   */
  async showDialog(parent: BrowserWindow, options: DialogOptions): Promise<string | null> {
    // Close any existing dialog
    if (this.activeDialog && !this.activeDialog.isDestroyed()) {
      this.activeDialog.close();
    }

    const { width = 480, height = 280 } = options;

    // Create dialog window
    this.activeDialog = new BrowserWindow({
      parent,
      modal: true,
      width,
      height,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      transparent: true,
      frame: false,
      webPreferences: {
        // eslint-disable-next-line unicorn/prefer-module
        preload: path.join(__dirname, '../build/preload.cjs'),
        nodeIntegration: true,
        contextIsolation: true,
        webviewTag: true,
        devTools: true,
      },
      vibrancy: 'popover',
    });

    // Pass options as query parameters
    const query = {
      title: options.title,
      message: options.message,
      buttons: JSON.stringify(options.buttons),
    };
    const params = new URLSearchParams(query);

    // Check for dev server URL (same pattern as AppWindow)
    const devUrlOverride = !app.isPackaged ? process.env.DEV_SERVER_URL : undefined;

    if (devUrlOverride) {
      // Development: Load from dev server
      const url = `${devUrlOverride}/desktop-dialog?${params.toString()}`;
      await this.activeDialog.loadURL(url);
    } else {
      // Production: Load from file system
      const appResourcesPath = getAppResourcesPath();
      const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');
      await this.activeDialog.loadFile(path.join(frontendPath, 'index.html'), {
        hash: `desktop-dialog`,
        query,
      });
    }

    // Set up IPC handlers for this dialog
    return new Promise((resolve) => {
      const cleanup = () => {
        ipcMain.removeHandler(IPC_CHANNELS.DIALOG_CLICK_BUTTON);
        ipcMain.removeHandler(IPC_CHANNELS.DIALOG_OPEN_URL);
        if (this.activeDialog && !this.activeDialog.isDestroyed()) {
          this.activeDialog = null;
        }
      };

      // Handle button clicks
      ipcMain.handleOnce(IPC_CHANNELS.DIALOG_CLICK_BUTTON, (_event, returnValue: string) => {
        cleanup();
        if (this.activeDialog && !this.activeDialog.isDestroyed()) {
          this.activeDialog.close();
        }
        resolve(returnValue);
      });

      // Handle URL opening (keeps dialog open)
      ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_URL, async (_event, url: string) => {
        await shell.openExternal(url);
      });

      // Handle dialog close
      this.activeDialog?.on('closed', () => {
        cleanup();
        resolve(null);
      });
    });
  }

  /**
   * Closes the active dialog if one exists
   */
  closeActiveDialog(): void {
    if (this.activeDialog && !this.activeDialog.isDestroyed()) {
      this.activeDialog.close();
      this.activeDialog = null;
    }
  }
}
