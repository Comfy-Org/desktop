import { BrowserWindow, app, ipcMain } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

/** Union type for all available dialog types */
export type DialogType = 'reinstall-venv';

/** Simplified dialog options that only specify type and optional dimensions */
export interface SimplifiedDialogOptions {
  type: DialogType;
  width?: number;
  height?: number;
}

/**
 * A type-safe dialog instance that handles a single dialog window
 */
class DialogInstance<T extends string> {
  private readonly dialogWindow: BrowserWindow;
  private readonly dialogType: DialogType;

  constructor(
    parent: BrowserWindow,
    private readonly options: SimplifiedDialogOptions
  ) {
    const { width = 488, height = 320, type } = options;
    this.dialogType = type;

    // Create dialog window
    this.dialogWindow = new BrowserWindow({
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
  }

  /**
   * Shows the dialog and returns a promise that resolves with the selected value
   */
  async show(): Promise<T | null> {
    // Build the URL path based on dialog type
    const dialogPath = `desktop-dialog/${this.dialogType}`;

    // Check for dev server URL (same pattern as AppWindow)
    const devUrlOverride = !app.isPackaged ? process.env.DEV_SERVER_URL : undefined;

    if (devUrlOverride) {
      // Development: Load from dev server
      const url = `${devUrlOverride}/${dialogPath}`;
      await this.dialogWindow.loadURL(url);
    } else {
      // Production: Load from file system
      const appResourcesPath = getAppResourcesPath();
      const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');
      await this.dialogWindow.loadFile(path.join(frontendPath, 'index.html'), {
        hash: dialogPath,
      });
    }

    // Set up IPC handlers for this dialog
    return this.waitForClick();
  }

  private waitForClick(): T | PromiseLike<T | null> | null {
    return new Promise<T | null>((resolve) => {
      ipcMain.handle(IPC_CHANNELS.DIALOG_CLICK_BUTTON, (_event, returnValue: T) => {
        // Frontend handles all button logic, we just close and return the value
        this.close();
        resolve(returnValue);
        return true;
      });

      // Handle dialog close
      this.dialogWindow.on('closed', () => {
        ipcMain.removeHandler(IPC_CHANNELS.DIALOG_CLICK_BUTTON);
        resolve(null);
      });
    });
  }

  /**
   * Closes the dialog window if it exists
   */
  close(): void {
    if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
      this.dialogWindow.close();
    }
  }
}

export class DialogManager {
  private static instance: DialogManager;
  private activeDialog?: DialogInstance<string>;

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
  async showDialog<T extends string>(parent: BrowserWindow, options: SimplifiedDialogOptions): Promise<T | null> {
    // Close any existing dialog
    if (this.activeDialog) {
      this.activeDialog.close();
      this.activeDialog = undefined;
    }

    // Create new dialog instance with type safety
    const dialogInstance = new DialogInstance<T>(parent, options);
    this.activeDialog = dialogInstance;

    // Show the dialog and return the typed result
    const result = await dialogInstance.show();

    // Clear the reference after dialog is closed
    this.activeDialog = undefined;

    return result;
  }
}
