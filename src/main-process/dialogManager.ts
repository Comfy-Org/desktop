import { BrowserWindow, app, ipcMain, shell } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

interface DialogButtonBase {
  label: string;
  /** Optional severity of the button (e.g. delete "danger"). Maps to PrimeVueSeverity enum. */
  severity?: 'info' | 'warn' | 'danger';
  returnValue?: string;
}

interface DialogCloseButton extends DialogButtonBase {
  action: 'close';
}

interface DialogUrlButton extends DialogButtonBase {
  action: 'openUrl';
  url: string;
}

export type DialogButton = DialogCloseButton | DialogUrlButton;

export interface DialogOptions {
  title: string;
  message: string;
  buttons: DialogButton[];
  width?: number;
  height?: number;
}

export class DialogManager {
  private static instance: DialogManager;
  private activeDialog?: BrowserWindow;
  private activeButtons?: DialogButton[];

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
  async showDialog(
    parent: BrowserWindow,
    { title, message, buttons, width = 480, height = 280 }: DialogOptions
  ): Promise<string | null> {
    // Close any existing dialog
    if (this.activeDialog && !this.activeDialog.isDestroyed()) {
      this.activeDialog.close();
      this.activeButtons = undefined;
    }

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

    this.activeButtons = structuredClone(buttons);

    // Pass options as query parameters
    const query = {
      title,
      message,
      buttons: JSON.stringify(buttons),
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
        if (this.activeDialog && !this.activeDialog.isDestroyed()) {
          this.activeDialog = undefined;
        }
      };

      // Handle button clicks
      ipcMain.handleOnce(IPC_CHANNELS.DIALOG_CLICK_BUTTON, async (_event, returnValue: string) => {
        const button = this.activeButtons?.find((button) => button.returnValue === returnValue);

        // Handle URL open - don't close the dialog
        if (button?.action === 'openUrl') {
          await shell.openExternal(button.url);
          return;
        }

        // Any other action should close the dialog
        cleanup();
        resolve(returnValue);
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
      this.activeDialog = undefined;
    }
  }
}
