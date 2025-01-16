import { ComfyServerConfig } from '../config/comfyServerConfig';
import { ComfySettings } from '../config/comfySettings';
import { IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { DownloadManager } from '../models/DownloadManager';
import { type ElectronContextMenuOptions } from '../preload';
import { CmCli } from '../services/cmCli';
import { HasTelemetry, ITelemetry } from '../services/telemetry';
import { Terminal } from '../shell/terminal';
import { DesktopConfig, useDesktopConfig } from '../store/desktopConfig';
import { ansiCodes, getModelsDirectory } from '../utils';
import { ProcessCallbacks, VirtualEnvironment } from '../virtualEnvironment';
import { AppWindow } from './appWindow';
import { ComfyServer } from './comfyServer';
import * as Sentry from '@sentry/electron/main';
import todesktop from '@todesktop/runtime';
import { app, dialog, ipcMain, Notification, type TitleBarOverlayOptions } from 'electron';
import log from 'electron-log/main';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { graphics } from 'systeminformation';

export class ComfyDesktopApp implements HasTelemetry {
  public comfyServer: ComfyServer | null = null;
  private terminal: Terminal | null = null; // Only created after server starts.
  constructor(
    public basePath: string,
    public comfySettings: ComfySettings,
    public appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {}

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
    ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, (): string => {
      return this.basePath;
    });
    ipcMain.handle(IPC_CHANNELS.IS_FIRST_TIME_SETUP, () => {
      return !ComfyServerConfig.exists();
    });
    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => {
      log.info('Reinstalling...');
      await this.reinstall();
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
    await this.appWindow.loadRenderer('server-start');

    DownloadManager.getInstance(this.appWindow, getModelsDirectory(this.basePath));

    this.appWindow.sendServerStartProgress(ProgressStatus.PYTHON_SETUP);

    const config = useDesktopConfig();
    const selectedDevice = config.get('selectedDevice');
    const virtualEnvironment = new VirtualEnvironment(this.basePath, this.telemetry, selectedDevice);

    const processCallbacks: ProcessCallbacks = {
      onStdout: (data) => {
        log.info(data.replaceAll(ansiCodes, ''));
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
      onStderr: (data) => {
        log.error(data.replaceAll(ansiCodes, ''));
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
    };
    await virtualEnvironment.create(processCallbacks);

    const customNodeMigrationError = await this.migrateCustomNodes(config, virtualEnvironment, processCallbacks);

    this.appWindow.sendServerStartProgress(ProgressStatus.STARTING_SERVER);
    this.comfyServer = new ComfyServer(this.basePath, serverArgs, virtualEnvironment, this.appWindow, this.telemetry);
    await this.comfyServer.start();
    this.initializeTerminal(virtualEnvironment);

    if (customNodeMigrationError) {
      // TODO: Replace with IPC callback to handle i18n (SoC).
      new Notification({
        title: 'Failed to migrate custom nodes',
        body: customNodeMigrationError,
      }).show();
    }
  }

  /** @returns `undefined` if successful, or an error `string` on failure. */
  async migrateCustomNodes(config: DesktopConfig, virtualEnvironment: VirtualEnvironment, callbacks: ProcessCallbacks) {
    const fromPath = config.get('migrateCustomNodesFrom');
    if (!fromPath) return;

    log.info('Migrating custom nodes from:', fromPath);
    try {
      const cmCli = new CmCli(virtualEnvironment, virtualEnvironment.telemetry);
      await cmCli.restoreCustomNodes(fromPath, callbacks);
    } catch (error) {
      log.error('Error migrating custom nodes:', error);
      // TODO: Replace with IPC callback to handle i18n (SoC).
      return error?.toString?.() ?? 'Error migrating custom nodes.';
    } finally {
      // Always remove the flag so the user doesnt get stuck here
      config.delete('migrateCustomNodesFrom');
    }
  }

  static create(appWindow: AppWindow, basePath: string, telemetry: ITelemetry): ComfyDesktopApp {
    return new ComfyDesktopApp(basePath, new ComfySettings(basePath), appWindow, telemetry);
  }

  async uninstall(): Promise<void> {
    await rm(ComfyServerConfig.configPath);
    await useDesktopConfig().permanentlyDeleteConfigFile();
  }

  async reinstall(): Promise<void> {
    await this.uninstall();
    this.restart();
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

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
      });
  }
}
