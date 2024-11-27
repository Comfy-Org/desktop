import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import { graphics } from 'systeminformation';
import todesktop from '@todesktop/runtime';
import { IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { ComfySettings } from '../config/comfySettings';
import { AppWindow } from './appWindow';
import { ComfyServer } from './comfyServer';
import { ComfyServerConfig } from '../config/comfyServerConfig';
import fs from 'fs';
import { InstallOptions } from '../preload';
import path from 'path';
import { getModelsDirectory, validateHardware } from '../utils';
import { DownloadManager } from '../models/DownloadManager';
import { VirtualEnvironment } from '../virtualEnvironment';
import { InstallWizard } from '../install/installWizard';
import { Terminal } from '../terminal';

export class ComfyDesktopApp {
  public comfyServer: ComfyServer | null = null;
  private terminal: Terminal | null = null; // Only created after server starts.

  constructor(
    public basePath: string,
    public comfySettings: ComfySettings,
    public appWindow: AppWindow
  ) {}

  get pythonInstallPath() {
    return app.isPackaged ? this.basePath : path.join(app.getAppPath(), 'assets');
  }

  public async initialize(): Promise<void> {
    this.comfySettings.loadSettings();
    this.registerIPCHandlers();
    this.initializeTodesktop();
    await this.setupGPUContext();
  }

  initializeTodesktop(): void {
    log.debug('Initializing todesktop');
    todesktop.init({
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

    ipcMain.handle(IPC_CHANNELS.TERMINAL_RESTORE, (_event) => {
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
      const allGpuInfo = Object.assign({}, ...gpuInfo);
      // Set Sentry context with all GPU information
      Sentry.setContext('gpus', allGpuInfo);
    } catch (e) {
      log.error('Error getting GPU info: ', e);
    }
  }

  registerIPCHandlers(): void {
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

    ipcMain.handle(IPC_CHANNELS.GET_BASE_PATH, async (): Promise<string> => {
      return this.basePath;
    });
    ipcMain.handle(IPC_CHANNELS.IS_FIRST_TIME_SETUP, () => {
      return !ComfyServerConfig.exists();
    });
    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => {
      log.info('Reinstalling...');
      this.reinstall();
    });
    ipcMain.handle(IPC_CHANNELS.SEND_ERROR_TO_SENTRY, async (_event, { error, extras }): Promise<string | null> => {
      try {
        return Sentry.captureMessage(error, {
          level: 'error',
          extra: { ...extras, comfyUIExecutionError: true },
          tags: {
            comfyorigin: 'core',
          },
        });
      } catch (err) {
        log.error('Failed to send error to Sentry:', err);
        return null;
      }
    });
  }

  /**
   * Install ComfyUI and return the base path.
   */
  static async install(appWindow: AppWindow): Promise<string> {
    const validation = await validateHardware();
    if (!validation.isValid) {
      await appWindow.loadRenderer('not-supported');
      throw new Error(validation.error);
    }

    await appWindow.loadRenderer('welcome');
    return new Promise<string>((resolve) => {
      ipcMain.on(IPC_CHANNELS.INSTALL_COMFYUI, async (event, installOptions: InstallOptions) => {
        const installWizard = new InstallWizard(installOptions);
        await installWizard.install();
        resolve(installWizard.basePath);
      });
    });
  }

  async startComfyServer(serverArgs: ServerArgs) {
    app.on('before-quit', async () => {
      if (!this.comfyServer) {
        return;
      }

      try {
        log.info('Before-quit: Killing Python server');
        await this.comfyServer.kill();
      } catch (error) {
        log.error('Python server did not exit properly');
        log.error(error);
      }
    });
    log.info('Server start');
    this.appWindow.loadRenderer('server-start');

    DownloadManager.getInstance(this.appWindow!, getModelsDirectory(this.basePath));

    this.appWindow.sendServerStartProgress(ProgressStatus.PYTHON_SETUP);
    const virtualEnvironment = new VirtualEnvironment(this.basePath);
    await virtualEnvironment.create({
      onStdout: (data) => {
        log.info(data);
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
      onStderr: (data) => {
        log.error(data);
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
    });

    this.appWindow.sendServerStartProgress(ProgressStatus.STARTING_SERVER);
    this.comfyServer = new ComfyServer(this.basePath, serverArgs, virtualEnvironment, this.appWindow);
    await this.comfyServer.start();
    this.initializeTerminal(virtualEnvironment);
  }

  static async create(appWindow: AppWindow): Promise<ComfyDesktopApp> {
    const basePath = ComfyServerConfig.exists()
      ? await ComfyServerConfig.readBasePathFromConfig(ComfyServerConfig.configPath)
      : await this.install(appWindow);

    if (!basePath) {
      throw new Error(`Base path not found! ${ComfyServerConfig.configPath} is probably corrupted.`);
    }
    return new ComfyDesktopApp(basePath, new ComfySettings(basePath), appWindow);
  }

  uninstall(): void {
    fs.rmSync(ComfyServerConfig.configPath);
  }

  reinstall(): void {
    this.uninstall();
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
