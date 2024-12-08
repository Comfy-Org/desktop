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
import { ProcessCallbacks, VirtualEnvironment } from '../virtualEnvironment';
import { InstallWizard } from '../install/installWizard';
import { Terminal } from '../terminal';
import { DesktopConfig } from '../store/desktopConfig';
import { InstallationValidator } from '../install/installationValidator';
import { restoreCustomNodes } from '../services/backup';
import { CmCli } from '../services/cmCli';
import ElectronStore from 'electron-store';
import { DesktopSettings } from '../store';

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
      log.error(validation.error);
    } else {
      await appWindow.loadRenderer('welcome');
    }

    return new Promise<string>((resolve) => {
      ipcMain.on(IPC_CHANNELS.INSTALL_COMFYUI, async (event, installOptions: InstallOptions) => {
        const installWizard = new InstallWizard(installOptions);
        const { store } = DesktopConfig;
        store.set('basePath', installWizard.basePath);

        await installWizard.install();
        store.set('installState', 'installed');
        if (installWizard.shouldMigrateCustomNodes) {
          store.set('migrateCustomNodes', installWizard.migrationSource);
        }
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

    const processCallbacks: ProcessCallbacks = {
      onStdout: (data) => {
        log.info(data);
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
      onStderr: (data) => {
        log.error(data);
        this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
    };
    await virtualEnvironment.create(processCallbacks);

    const { store } = DesktopConfig;
    const customNodeMigrationError = await this.migrateCustomNodes(store, virtualEnvironment, processCallbacks);

    if (!store.get('Comfy-Desktop.RestoredCustomNodes', false)) {
      try {
        await restoreCustomNodes(virtualEnvironment, this.appWindow);
        store.set('Comfy-Desktop.RestoredCustomNodes', true);
      } catch (error) {
        log.error('Failed to restore custom nodes:', error);
        store.set('Comfy-Desktop.RestoredCustomNodes', false);
      }
    }

    this.appWindow.sendServerStartProgress(ProgressStatus.STARTING_SERVER);
    this.comfyServer = new ComfyServer(this.basePath, serverArgs, virtualEnvironment, this.appWindow);
    await this.comfyServer.start();
    this.initializeTerminal(virtualEnvironment);

    return () => {
      if (customNodeMigrationError) {
        this.appWindow.showToast({
          summary: 'Failed to migrate custom nodes',
          detail: customNodeMigrationError,
          severity: 'error',
        });
      }
    };
  }

  async migrateCustomNodes(
    store: ElectronStore<DesktopSettings>,
    virtualEnvironment: VirtualEnvironment,
    callbacks: ProcessCallbacks
  ) {
    const customNodeMigrationPath = store.get('migrateCustomNodes');
    let customNodeMigrationError: string | null = null;
    if (customNodeMigrationPath) {
      log.info('Migrating custom nodes from: ', customNodeMigrationPath);
      try {
        const cmCli = new CmCli(virtualEnvironment);
        await cmCli.restoreCustomNodes(customNodeMigrationPath, callbacks);
      } catch (error) {
        log.error('Error migrating custom nodes', error);
        customNodeMigrationError =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'Error migrating custom nodes.';
      } finally {
        // Always remove the flag so the user doesnt get stuck here
        store.delete('migrateCustomNodes');
      }
    }
    return customNodeMigrationError;
  }

  static async create(appWindow: AppWindow): Promise<ComfyDesktopApp> {
    const { store } = DesktopConfig;
    // Migrate settings from old version if required
    const installState = store.get('installState') ?? (await ComfyDesktopApp.migrateInstallState());

    // Fresh install
    const loadedPath = installState === undefined ? undefined : await ComfyDesktopApp.loadBasePath();
    const basePath = loadedPath ?? (await ComfyDesktopApp.install(appWindow));

    return new ComfyDesktopApp(basePath, new ComfySettings(basePath), appWindow);
  }

  /**
   * Sets the ugpraded state if this is a version upgrade from <= 0.3.18
   * @returns 'upgraded' if this install has just been upgraded, or undefined for a fresh install
   */
  static async migrateInstallState(): Promise<string | undefined> {
    // Fresh install
    if (!ComfyServerConfig.exists()) return undefined;

    // Upgrade
    const basePath = await ComfyDesktopApp.loadBasePath();

    // Migrate config
    const { store } = DesktopConfig;
    const upgraded = 'upgraded';
    store.set('installState', upgraded);
    store.set('basePath', basePath);
    return upgraded;
  }

  /**
   * Loads the base_path value from the YAML config.
   *
   * Quits in the event of failure.
   * @returns The base path of the ComfyUI data directory, if available
   */
  static async loadBasePath(): Promise<string | null> {
    const basePath = await ComfyServerConfig.readBasePathFromConfig(ComfyServerConfig.configPath);
    switch (basePath.status) {
      case 'success':
        return basePath.path;
      case 'invalid':
        // TODO: File was there, and was valid YAML.  It just didn't have a valid base_path.
        // Show path edit screen instead of reinstall.
        return null;
      case 'notFound':
        return null;
      case 'error':
      default:
        // Explain and quit
        // TODO: Support link?  Something?
        await InstallationValidator.showInvalidFileAndQuit(ComfyServerConfig.configPath, {
          message: `Unable to read the YAML configuration file.  Please ensure this file is available and can be read:

${ComfyServerConfig.configPath}

If this problem persists, back up and delete the config file, then restart the app.`,
          buttons: ['Open ComfyUI &directory and quit', '&Quit'],
          defaultId: 0,
          cancelId: 1,
        });
        throw new Error(/* Unreachable. */);
    }
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
