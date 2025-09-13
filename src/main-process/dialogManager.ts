import { BrowserWindow, ipcMain, shell } from 'electron';

import { IPC_CHANNELS } from '../constants';

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

    const { title, message, buttons, width = 480, height = 280 } = options;

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
        nodeIntegration: false,
        contextIsolation: true,
        preload: undefined, // No preload needed for simple dialog
      },
    });

    // Generate HTML content
    const htmlContent = this.generateDialogHTML(title, message, buttons);
    await this.activeDialog.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

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

  private generateDialogHTML(title: string, message: string, buttons: DialogButton[]): string {
    const buttonHTML = buttons
      .map((button, index) => {
        if (button.action === 'openUrl' && button.url) {
          return `<button class="dialog-button" onclick="openUrl('${button.url}')">${button.label}</button>`;
        }
        return `<button class="dialog-button" onclick="handleClick('${button.returnValue || index}')">${button.label}</button>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      user-select: none;
    }

    .dialog-container {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 32px;
      width: 90%;
      max-width: 440px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .dialog-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a202c;
      margin-bottom: 12px;
    }

    .dialog-message {
      font-size: 14px;
      color: #4a5568;
      line-height: 1.6;
      margin-bottom: 24px;
    }

    .dialog-buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    .dialog-button {
      padding: 8px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      background: #e2e8f0;
      color: #2d3748;
    }

    .dialog-button:hover {
      background: #cbd5e0;
      transform: translateY(-1px);
    }

    .dialog-button:active {
      transform: translateY(0);
    }

    .dialog-button:first-child {
      background: #667eea;
      color: white;
    }

    .dialog-button:first-child:hover {
      background: #5a67d8;
    }
  </style>
</head>
<body>
  <div class="dialog-container">
    <div class="dialog-title">${title}</div>
    <div class="dialog-message">${message}</div>
    <div class="dialog-buttons">
      ${buttonHTML}
    </div>
  </div>

  <script>
    const { ipcRenderer } = require('electron');

    function handleClick(returnValue) {
      ipcRenderer.invoke('dialog:button-click', returnValue);
    }

    function openUrl(url) {
      ipcRenderer.invoke('dialog:open-url', url);
    }

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleClick(null);
      }
    });
  </script>
</body>
</html>`;
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
