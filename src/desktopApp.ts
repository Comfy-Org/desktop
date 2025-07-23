import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { ProgressStatus } from './constants';
import { IPC_CHANNELS } from './constants';
import { registerAppHandlers } from './handlers/AppHandlers';
import { registerAppInfoHandlers } from './handlers/appInfoHandlers';
import { registerGpuHandlers } from './handlers/gpuHandlers';
import { registerNetworkHandlers } from './handlers/networkHandlers';
import { registerPathHandlers } from './handlers/pathHandlers';
import { FatalError } from './infrastructure/fatalError';
import type { FatalErrorOptions } from './infrastructure/interfaces';
import { InstallationManager } from './install/installationManager';
import { Troubleshooting } from './install/troubleshooting';
import type { IAppState } from './main-process/appState';
import { useAppState } from './main-process/appState';
import { AppWindow } from './main-process/appWindow';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import type { ComfyInstallation } from './main-process/comfyInstallation';
import { DevOverrides } from './main-process/devOverrides';
import type { ComfyProtocolAction } from './protocol/protocolParser';
import SentryLogging from './services/sentry';
import { type HasTelemetry, type ITelemetry, getTelemetry, promptMetricsConsent } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';

export class DesktopApp implements HasTelemetry {
  readonly telemetry: ITelemetry = getTelemetry();
  readonly appState: IAppState = useAppState();
  readonly appWindow: AppWindow = new AppWindow();

  comfyDesktopApp?: ComfyDesktopApp;
  installation?: ComfyInstallation;
  
  /** Queue of protocol actions to process when ComfyUI is ready */
  private readonly protocolActionQueue: ComfyProtocolAction[] = [];

  constructor(
    private readonly overrides: DevOverrides,
    private readonly config: DesktopConfig
  ) {}

  /** Load start screen - basic spinner */
  async showLoadingPage() {
    try {
      await this.appWindow.loadPage('desktop-start');
    } catch (error) {
      DesktopApp.fatalError({
        error,
        message: `Unknown error whilst loading start screen.\n\n${error}`,
        title: 'Startup failed',
      });
    }
  }

  private async initializeTelemetry(installation: ComfyInstallation): Promise<void> {
    await SentryLogging.setSentryGpuContext();
    SentryLogging.getBasePath = () => installation.basePath;

    const allowMetrics = await promptMetricsConsent(this.config, this.appWindow);
    this.telemetry.hasConsent = allowMetrics;
    if (allowMetrics) this.telemetry.flush();
  }

  /**
   * Install / validate installation is complete
   * @returns The installation if it is complete, otherwise `undefined` (error page).
   * @throws Rethrows any errors when the installation fails before the app has set the current page.
   */
  private async initializeInstallation(): Promise<ComfyInstallation | undefined> {
    const { appWindow } = this;
    try {
      const installManager = new InstallationManager(appWindow, this.telemetry);
      return await installManager.ensureInstalled();
    } catch (error) {
      // Don't force app quit if the error occurs after moving away from the start page.
      if (this.appState.currentPage !== 'desktop-start') {
        appWindow.sendServerStartProgress(ProgressStatus.ERROR);
        appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
      } else {
        throw error;
      }
    }
  }

  async start(): Promise<void> {
    const { appState, appWindow, overrides, telemetry } = this;

    if (!appState.ipcRegistered) this.registerIpcHandlers();

    const installation = await this.initializeInstallation();
    if (!installation) return;
    this.installation = installation;

    // At this point, user has gone through the onboarding flow.
    await this.initializeTelemetry(installation);

    try {
      // Initialize app
      this.comfyDesktopApp ??= new ComfyDesktopApp(installation, appWindow, telemetry);
      const { comfyDesktopApp } = this;

      // Construct core launch args
      const serverArgs = await comfyDesktopApp.buildServerArgs(overrides);

      // Start server
      if (!overrides.useExternalServer && !comfyDesktopApp.serverRunning) {
        try {
          await comfyDesktopApp.startComfyServer(serverArgs);
        } catch (error) {
          log.error('Unhandled exception during server start', error);
          appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
          appWindow.sendServerStartProgress(ProgressStatus.ERROR);
          return;
        }
      }
      appWindow.sendServerStartProgress(ProgressStatus.READY);
      await appWindow.loadComfyUI(serverArgs);

      // App start complete
      appState.emitLoaded();
      
      // Process any queued protocol actions now that ComfyUI is ready
      this.processQueuedProtocolActions();
    } catch (error) {
      log.error('Unhandled exception during app startup', error);
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
      if (!this.appState.isQuitting) {
        dialog.showErrorBox(
          'Unhandled exception',
          `An unexpected error occurred whilst starting the app, and it needs to be closed.\n\nError message:\n\n${error}`
        );
        app.quit();
      }
    }
  }

  private registerIpcHandlers() {
    this.appState.emitIpcRegistered();

    try {
      // Register basic handlers that are necessary during app's installation.
      registerPathHandlers();
      registerNetworkHandlers();
      registerAppInfoHandlers();
      registerAppHandlers();
      registerGpuHandlers();

      ipcMain.handle(IPC_CHANNELS.START_TROUBLESHOOTING, async () => await this.showTroubleshootingPage());
    } catch (error) {
      DesktopApp.fatalError({
        error,
        message: 'Fatal error occurred during app pre-startup.',
        title: 'Startup failed',
        exitCode: 2024,
      });
    }
  }

  async showTroubleshootingPage() {
    try {
      if (!this.installation) throw new Error('Cannot troubleshoot before installation is complete.');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using troubleshooting = new Troubleshooting(this.installation, this.appWindow);

      if (!this.appState.loaded) {
        await this.appWindow.loadPage('maintenance');
      }
      await new Promise((resolve) => ipcMain.handleOnce(IPC_CHANNELS.COMPLETE_VALIDATION, resolve));
    } catch (error) {
      DesktopApp.fatalError({
        error,
        message: `An error was detected, but the troubleshooting page could not be loaded. The app will close now. Please reinstall if this issue persists.`,
        title: 'Critical error',
        exitCode: 2001,
      });
    }

    await this.start();
  }

  /**
   * Quits the app gracefully after a fatal error.  Exits immediately if a code is provided.
   *
   * Logs the error and shows an error dialog to the user.
   * @param options - The options for the error.
   */
  static fatalError({ message, error, title, logMessage, exitCode }: FatalErrorOptions): never {
    const _error = FatalError.wrapIfGeneric(error);
    log.error(logMessage ?? message, _error);
    if (title && message) dialog.showErrorBox(title, message);

    if (exitCode) app.exit(exitCode);
    else app.quit();
    // Unreachable - library type is void instead of never.
    throw _error;
  }

  /**
   * Queue a protocol action to be processed when ComfyUI is ready
   * @param action The protocol action to queue
   */
  queueProtocolAction(action: ComfyProtocolAction): void {
    log.info('Queueing protocol action:', action);
    this.protocolActionQueue.push(action);
  }

  /**
   * Handle a protocol action immediately (if ComfyUI is ready) or queue it
   * @param action The protocol action to handle
   */
  handleProtocolAction(action: ComfyProtocolAction): void {
    log.info('Handling protocol action:', action);
    
    // If ComfyUI is not ready yet, queue the action
    if (!this.appState.loaded || !this.comfyDesktopApp?.serverRunning) {
      this.queueProtocolAction(action);
      return;
    }

    // Process the action immediately
    this.processProtocolAction(action);
  }

  /**
   * Process all queued protocol actions
   */
  private processQueuedProtocolActions(): void {
    if (this.protocolActionQueue.length === 0) return;

    log.info(`Processing ${this.protocolActionQueue.length} queued protocol actions`);
    
    while (this.protocolActionQueue.length > 0) {
      const action = this.protocolActionQueue.shift();
      if (action) {
        this.processProtocolAction(action);
      }
    }
  }

  /**
   * Process a single protocol action
   * @param action The action to process
   */
  private processProtocolAction(action: ComfyProtocolAction): void {
    log.info('Processing protocol action:', action);

    try {
      this.telemetry.track('desktop:protocol_action', {
        action: action.action,
        nodeId: action.params.nodeId,
      });

      // Send the action to the renderer for processing
      this.appWindow.send(IPC_CHANNELS.PROTOCOL_ACTION, action);
      
      // Show a notification to the user
      this.showProtocolActionNotification(action);
    } catch (error) {
      log.error('Error processing protocol action:', error);
      dialog.showErrorBox(
        'Protocol Action Error',
        `Failed to process protocol action: ${action.action}\n\nError: ${error}`
      );
    }
  }

  /**
   * Show a notification for the protocol action being processed
   * @param action The action being processed
   */
  private showProtocolActionNotification(action: ComfyProtocolAction): void {
    const messages = {
      'install-custom-node': `Installing custom node: ${action.params.nodeId}`,
      'import': `Importing: ${action.params.nodeId}`,
    };

    const message = messages[action.action] || `Processing action: ${action.action}`;
    
    // Focus the window to bring it to the front
    if (this.appWindow.isMinimized()) {
      this.appWindow.restore();
    }
    this.appWindow.focus();
    
    // Log the action for visibility
    this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `[Protocol] ${message}\n`);
  }
}
