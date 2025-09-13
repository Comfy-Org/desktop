import { BrowserWindow, app, ipcMain, shell } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';

interface DialogButtonBase {
  /** The text that will be displayed on the button */
  label: string;
  /** Optional tooltip for the button */
  tooltip?: string;
  /** Optional severity of the button (e.g. delete "danger"). Maps to PrimeVueSeverity enum. */
  severity?: 'info' | 'warn' | 'danger';
  /** The value that will be sent via IPC when this button is clicked */
  returnValue: string;
}

/** A button that closes the dialog when clicked */
interface DialogCloseButton extends DialogButtonBase {
  /** The type of action this button performs */
  action: 'close';
}

/** A button that opens a URL when clicked */
interface DialogUrlButton extends DialogButtonBase {
  /** The type of action this button performs */
  action: 'openUrl';
  /** The URL to open when the button is clicked */
  url: string;
}

export type DialogButton = DialogCloseButton | DialogUrlButton;

export interface DialogOptions<T extends string = string> {
  title: string;
  message: string;
  buttons: (DialogButton & { returnValue: T })[];
  width?: number;
  height?: number;
}

/**
 * A type-safe dialog instance that handles a single dialog window
 */
class DialogInstance<T extends string> {
  private readonly dialogWindow: BrowserWindow;
  private readonly buttons: (DialogButton & { returnValue: T })[];

  constructor(
    parent: BrowserWindow,
    private readonly options: DialogOptions<T>
  ) {
    const { width = 488, height = 320, buttons } = options;
    this.buttons = buttons;

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
    const { title, message, buttons } = this.options;

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
      await this.dialogWindow.loadURL(url);
    } else {
      // Production: Load from file system
      const appResourcesPath = getAppResourcesPath();
      const frontendPath = path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app');
      await this.dialogWindow.loadFile(path.join(frontendPath, 'index.html'), {
        hash: `desktop-dialog`,
        query,
      });
    }

    // Set up IPC handlers for this dialog
    return new Promise<T | null>((resolve) => {
      // Handle button clicks
      const clickHandler = async (_event: Electron.IpcMainInvokeEvent, returnValue: string) => {
        const button = this.buttons.find((button) => button.returnValue === returnValue);

        // Handle URL open - don't close the dialog
        if (button?.action === 'openUrl') {
          await shell.openExternal(button.url);
          return true;
        }

        // Any other action should close the dialog
        this.close();
        resolve(returnValue as T);
        return true;
      };

      ipcMain.handle(IPC_CHANNELS.DIALOG_CLICK_BUTTON, clickHandler);

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
  async showDialog<T extends string>(parent: BrowserWindow, options: DialogOptions<T>): Promise<T | null> {
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
