import * as Sentry from '@sentry/electron/main';
import todesktop from '@todesktop/runtime';
import { type TitleBarOverlayOptions, app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';
import { graphics } from 'systeminformation';

import { ComfyServerConfig } from '../config/comfyServerConfig';
import { IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { InstallationManager } from '../install/installationManager';
import { DownloadManager } from '../models/DownloadManager';
import { type ElectronContextMenuOptions } from '../preload';
import { HasTelemetry, ITelemetry } from '../services/telemetry';
import { Terminal } from '../shell/terminal';
import { getModelsDirectory } from '../utils';
import { VirtualEnvironment } from '../virtualEnvironment';
import { AppWindow } from './appWindow';
import type { ComfyInstallation } from './comfyInstallation';
import { ComfyServer } from './comfyServer';

export class ComfyDesktopApp implements HasTelemetry {
  public comfyServer: ComfyServer | null = null;
  private terminal: Terminal | null = null; // Only created after server starts.
  constructor(
    public installation: ComfyInstallation,
    public appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {}

  get comfySettings() {
    return this.installation.comfySettings;
  }

  get basePath() {
    return this.installation.basePath;
  }

  get pythonInstallPath() {
    return app.isPackaged ? this.basePath : path.join(app.getAppPath(), 'assets');
  }

  public async initialize(): Promise<void> {
    await this.comfySettings.loadSettings();
    this.registerIPCHandlers();
    this.initializeTodesktop();
    await this.setupGPUContext();
  }

  initializeTodesktop(): void {
    log.debug('Initializing todesktop');
    todesktop.init({
      autoCheckInterval: 60 * 60 * 1000, // every hour
      customLogger: log,
      updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
      autoUpdater: this.comfySettings.get('Comfy-Desktop.AutoUpdate'),
    });
    todesktop.autoUpdater?.setFeedURL('https://updater.comfy.org');
  }

  private initializeTerminal(virtualEnvironment: VirtualEnvironment) {
    this.terminal = new Terminal(this.appWindow, this.basePath, virtualEnvironment.uvPath);
    this.terminal.write(virtualEnvironment.activateEnvironmentCommand());

    ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, command: string) => {
      this.terminal?.write(command);
    });

    ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
      this.terminal?.resize(cols, rows);
    });

    ipcMain.handle(IPC_CHANNELS.TERMINAL_RESTORE, () => {
      return this.terminal?.restore();
    });
  }

  async setupGPUContext(): Promise<void> {
    log.debug('Setting up GPU context');
    try {
      const graphicsInfo = await graphics();
      const gpuInfo = graphicsInfo.controllers.map((gpu, index) => ({
        [`gpu_${index}`]: {
          vendor: gpu.vendor,
          model: gpu.model,
          vram: gpu.vram,
          driver: gpu.driverVersion,
        },
      }));

      // Combine all GPU info into a single object
      const allGpuInfo = { ...gpuInfo };
      // Set Sentry context with all GPU information
      Sentry.setContext('gpus', allGpuInfo);
    } catch (error) {
      log.error('Error getting GPU info: ', error);
    }
  }

  registerIPCHandlers(): void {
    ipcMain.on(IPC_CHANNELS.CHANGE_THEME, (_event, options: TitleBarOverlayOptions) => {
      this.appWindow.changeTheme(options);
    });
    ipcMain.on(IPC_CHANNELS.SHOW_CONTEXT_MENU, (_event, options?: ElectronContextMenuOptions) => {
      this.appWindow.showSystemContextMenu(options);
    });
    ipcMain.on(IPC_CHANNELS.OPEN_DEV_TOOLS, () => {
      this.appWindow.openDevTools();
    });
    ipcMain.on(
      IPC_CHANNELS.RESTART_APP,
      (event, { customMessage, delay }: { customMessage?: string; delay?: number }) => {
        log.info('Received restart app message!');
        if (customMessage) {
          this.restart({ customMessage, delay });
        } else {
          this.restart({ delay });
        }
      }
    );
    ipcMain.handle(IPC_CHANNELS.IS_FIRST_TIME_SETUP, () => {
      return !ComfyServerConfig.exists();
    });

    // Replace the reinstall IPC handler.
    ipcMain.removeHandler(IPC_CHANNELS.REINSTALL);
    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => {
      log.info('Reinstalling...');
      await InstallationManager.reinstall(this.installation);
    });
    // Restart core
    ipcMain.handle(IPC_CHANNELS.RESTART_CORE, async (): Promise<boolean> => {
      if (!this.comfyServer) return false;
      await this.comfyServer?.kill();
      await this.comfyServer.start();
      return true;
    });
  }

  async startComfyServer(serverArgs: ServerArgs) {
    app.on('before-quit', () => {
      if (!this.comfyServer) {
        return;
      }

      log.info('Before-quit: Killing Python server');
      this.comfyServer.kill().catch((error) => {
        log.error('Python server did not exit properly');
        log.error(error);
      });
    });
    log.info('Server start');
    if (!this.appWindow.isOnPage('server-start')) {
      await this.appWindow.loadPage('server-start');
    }

    DownloadManager.getInstance(this.appWindow, getModelsDirectory(this.basePath));

    const { virtualEnvironment } = this.installation;

    this.appWindow.sendServerStartProgress(ProgressStatus.STARTING_SERVER);
    this.comfyServer = new ComfyServer(this.basePath, serverArgs, virtualEnvironment, this.appWindow, this.telemetry);
    await this.comfyServer.start();
    this.initializeTerminal(virtualEnvironment);
  }

  restart({ customMessage, delay }: { customMessage?: string; delay?: number } = {}): void {
    function relaunchApplication(delay?: number) {
      if (delay) {
        log.info('Relaunching application in ', delay, 'ms');
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, delay);
      } else {
        app.relaunch();
        app.quit();
      }
    }

    log.info('Attempting to restart app with custom message: ', customMessage);

    if (!customMessage) {
      log.info('Skipping confirmation, restarting immediately');
      return relaunchApplication(delay);
    }

    dialog
      .showMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        title: 'Restart ComfyUI',
        message: customMessage || 'Are you sure you want to restart ComfyUI?',
        detail: 'The application will close and restart automatically.',
      })
      .then(({ response }) => {
        if (response === 0) {
          // "Yes" was clicked
          log.info('User confirmed restart');
          relaunchApplication(delay);
        } else {
          log.info('User cancelled restart');
        }
      })
      .catch((error) => {
        log.error('Error showing restart confirmation dialog:', error);
      });
  }
}
