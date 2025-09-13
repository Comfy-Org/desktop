import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

export interface DialogButton {
  label: string;
  action: 'close' | 'openUrl';
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
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    // Load the dialog page from frontend
    const appResourcesPath = getAppResourcesPath();
    const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');

    // Pass options as query parameters
    const params = new URLSearchParams({
      title: options.title,
      message: options.message,
      buttons: JSON.stringify(options.buttons),
    });

    await this.activeDialog.loadFile(path.join(frontendPath, 'index.html'), {
      hash: `desktop-dialog?${params.toString()}`,
    });

    // Set up IPC handlers for this dialog
    return new Promise((resolve) => {
      const cleanup = () => {
        ipcMain.removeHandler(IPC_CHANNELS.DIALOG_BUTTON_CLICK);
        ipcMain.removeHandler(IPC_CHANNELS.DIALOG_OPEN_URL);
        if (this.activeDialog && !this.activeDialog.isDestroyed()) {
          this.activeDialog = null;
        }
      };

      // Handle button clicks
      ipcMain.handleOnce(IPC_CHANNELS.DIALOG_BUTTON_CLICK, (_event, returnValue: string | null) => {
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
