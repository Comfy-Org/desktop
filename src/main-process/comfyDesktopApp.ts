import todesktop from '@todesktop/runtime';
import { app, ipcMain } from 'electron';
import log from 'electron-log/main';

import { comfySettings } from '@/config/comfySettings';

import { DEFAULT_SERVER_ARGS, IPC_CHANNELS, ProgressStatus, ServerArgs } from '../constants';
import { DownloadManager } from '../models/DownloadManager';
import { HasTelemetry, ITelemetry } from '../services/telemetry';
import { Terminal } from '../shell/terminal';
import { findAvailablePort, getModelsDirectory } from '../utils';
import { VirtualEnvironment } from '../virtualEnvironment';
import { AppWindow } from './appWindow';
import type { ComfyInstallation } from './comfyInstallation';
import { ComfyServer } from './comfyServer';
import type { DevOverrides } from './devOverrides';

export class ComfyDesktopApp implements HasTelemetry {
  public comfyServer: ComfyServer | null = null;
  private terminal: Terminal | null = null; // Only created after server starts.
  constructor(
    readonly installation: ComfyInstallation,
    readonly appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {}

  get basePath() {
    return this.installation.basePath;
  }

  public initialize(): void {
    this.registerIPCHandlers();
    this.initializeTodesktop();
  }

  /**
   * Build the server args to launch ComfyUI server.
   * @param useExternalServer Whether to use an external server instead of starting one locally.
   * @param COMFY_HOST Override the listen address (host) for the ComfyUI server.
   * @param COMFY_PORT Override the port for the ComfyUI server.
   * @returns The server args for the ComfyUI server.
   */
  async buildServerArgs({ useExternalServer, COMFY_HOST, COMFY_PORT }: DevOverrides): Promise<ServerArgs> {
    // Shallow-clone the setting launch args to avoid mutation.
    const serverArgs: ServerArgs = {
      listen: DEFAULT_SERVER_ARGS.listen,
      port: DEFAULT_SERVER_ARGS.port,
      ...comfySettings.get('Comfy.Server.LaunchArgs'),
    };

    if (COMFY_HOST) serverArgs.listen = COMFY_HOST;
    if (COMFY_PORT) serverArgs.port = COMFY_PORT;

    // Find first available port (unless using external server).
    if (!useExternalServer) {
      const targetPort = Number(serverArgs.port);
      const port = await findAvailablePort(serverArgs.listen, targetPort, targetPort + 1000);
      serverArgs.port = String(port);
    }

    return serverArgs;
  }

  initializeTodesktop(): void {
    log.debug('Initializing todesktop');
    todesktop.init({
      autoCheckInterval: 60 * 60 * 1000, // every hour
      customLogger: log,
      updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
      autoUpdater: comfySettings.get('Comfy-Desktop.AutoUpdate'),
    });
    todesktop.autoUpdater?.setFeedURL('https://updater.comfy.org');
  }

  registerIPCHandlers(): void {
    // Restart core
    ipcMain.handle(IPC_CHANNELS.RESTART_CORE, async (): Promise<boolean> => {
      if (!this.comfyServer) return false;

      await this.comfyServer.kill();
      await this.comfyServer.start();
      return true;
    });
  }

  async startComfyServer(serverArgs: ServerArgs) {
    app.on('before-quit', () => {
      if (!this.comfyServer) return;

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
}
