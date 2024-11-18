import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import { graphics } from 'systeminformation';
import todesktop from '@todesktop/runtime';
import { IPC_CHANNELS, SENTRY_URL_ENDPOINT } from '../constants';
import { ComfySettings } from '../config/comfySettings';
import { AppWindow } from './appWindow';
import { ComfyServer } from './comfyServer';
import { ComfyServerConfig } from '../config/comfyServerConfig';
import fs from 'fs';
import { InstallOptions } from '../preload';
import { ComfyConfigManager } from '../config/comfyConfigManager';
import path from 'path';

export class ComfyDesktopApp {
  public comfyServer: ComfyServer | null = null;

  constructor(
    public comfySettings: ComfySettings,
    public appWindow: AppWindow
  ) {}

  public async initialize(): Promise<void> {
    this.registerAppHandlers();
    this.registerIPCHandlers();
    this.initializeTodesktop();
    await this.initializeSentry();
    await this.setupGPUContext();
  }

  initializeTodesktop(): void {
    todesktop.init({
      customLogger: log,
      updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
      autoUpdater: this.comfySettings.get('Comfy-Desktop.AutoUpdate'),
    });
  }

  async initializeSentry(): Promise<void> {
    Sentry.init({
      dsn: SENTRY_URL_ENDPOINT,
      autoSessionTracking: false,
      beforeSend: async (event, hint) => {
        if (event.extra?.comfyUIExecutionError || this.comfySettings.get('Comfy-Desktop.SendCrashStatistics')) {
          return event;
        }

        const { response } = await dialog.showMessageBox({
          title: 'Send Crash Statistics',
          message: `Would you like to send crash statistics to the team?`,
          buttons: ['Always send crash reports', 'Do not send crash report'],
        });

        return response === 0 ? event : null;
      },
      integrations: [
        Sentry.childProcessIntegration({
          breadcrumbs: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
          events: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
        }),
      ],
    });
  }

  async setupGPUContext(): Promise<void> {
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

  registerAppHandlers(): void {
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
    await appWindow.loadRenderer('welcome');
    return new Promise<string>((resolve) => {
      ipcMain.on(IPC_CHANNELS.INSTALL_COMFYUI, async (event, installOptions: InstallOptions) => {
        const migrationSource = installOptions.migrationSourcePath;
        const migrationItemIds = new Set<string>(installOptions.migrationItemIds ?? []);

        const basePath = path.join(installOptions.installPath, 'ComfyUI');
        ComfyConfigManager.setUpComfyUI(basePath);

        const { comfyui: comfyuiConfig, ...extraConfigs } = await ComfyServerConfig.getMigrationConfig(
          migrationSource,
          migrationItemIds
        );
        comfyuiConfig['base_path'] = basePath;
        await ComfyServerConfig.createConfigFile(ComfyServerConfig.configPath, comfyuiConfig, extraConfigs);

        resolve(basePath);
      });
    });
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
