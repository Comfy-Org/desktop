import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { ProgressStatus } from './constants';
import { IPC_CHANNELS } from './constants';
import { InstallStage } from './constants';
import { registerAppHandlers } from './handlers/AppHandlers';
import { registerAppInfoHandlers } from './handlers/appInfoHandlers';
import { registerGpuHandlers } from './handlers/gpuHandlers';
import { registerInstallStateHandlers } from './handlers/installStateHandlers';
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
import { createInstallStageInfo } from './main-process/installStages';
import SentryLogging from './services/sentry';
import { type HasTelemetry, type ITelemetry, getTelemetry, promptMetricsConsent } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { getStartupDebugLogger } from './utils/startupDebugLogger';

export class DesktopApp implements HasTelemetry {
  readonly telemetry: ITelemetry = getTelemetry();
  readonly appState: IAppState = useAppState();
  readonly appWindow: AppWindow = new AppWindow();

  comfyDesktopApp?: ComfyDesktopApp;
  installation?: ComfyInstallation;

  constructor(
    private readonly overrides: DevOverrides,
    private readonly config: DesktopConfig
  ) {}

  /** Load start screen - basic spinner */
  async showLoadingPage() {
    const debugLog = getStartupDebugLogger();
    debugLog.log('DesktopApp', 'showLoadingPage() called');

    try {
      this.appState.setInstallStage(createInstallStageInfo(InstallStage.APP_INITIALIZING, { progress: 1 }));
      debugLog.log('DesktopApp', 'Loading desktop-start page');
      await this.appWindow.loadPage('desktop-start');
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    } catch (error) {
      debugLog.log('DesktopApp', 'Failed to load start screen', { error: String(error) });
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
    const debugLog = getStartupDebugLogger();
    debugLog.log('DesktopApp', 'initializeInstallation() called');

    const { appWindow } = this;
    try {
      debugLog.log('DesktopApp', 'Creating InstallationManager');
      const installManager = new InstallationManager(appWindow, this.telemetry);

      debugLog.log('DesktopApp', 'Ensuring installation');
      const installation = await installManager.ensureInstalled();
      debugLog.log('DesktopApp', 'Installation ensured', {
        success: !!installation,
        basePath: installation?.basePath,
      });
      return installation;
    } catch (error) {
      debugLog.log('DesktopApp', 'Installation initialization failed', { error: String(error) });
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
    const debugLog = getStartupDebugLogger();
    debugLog.log('DesktopApp', 'start() called');
    const startTimer = debugLog.startTimer('DesktopApp:start');

    const { appState, appWindow, overrides, telemetry } = this;

    if (!appState.ipcRegistered) {
      debugLog.log('DesktopApp', 'Registering IPC handlers');
      this.registerIpcHandlers();
    }

    debugLog.log('DesktopApp', 'Checking existing installation');
    appState.setInstallStage(createInstallStageInfo(InstallStage.CHECKING_EXISTING_INSTALL, { progress: 3 }));

    const installTimer = debugLog.startTimer('DesktopApp:initializeInstallation');
    const installation = await this.initializeInstallation();
    installTimer();

    if (!installation) {
      debugLog.log('DesktopApp', 'No installation found, exiting');
      startTimer();
      return;
    }
    this.installation = installation;
    debugLog.log('DesktopApp', 'Installation initialized', { basePath: installation.basePath });

    // At this point, user has gone through the onboarding flow.
    debugLog.log('DesktopApp', 'Initializing telemetry');
    await this.initializeTelemetry(installation);

    try {
      // Initialize app
      if (!this.comfyDesktopApp) {
        debugLog.log('DesktopApp', 'Creating ComfyDesktopApp instance');
        this.comfyDesktopApp = new ComfyDesktopApp(installation, appWindow, telemetry);
      }
      const { comfyDesktopApp } = this;

      // Construct core launch args
      debugLog.log('DesktopApp', 'Building server args');
      const serverArgs = await comfyDesktopApp.buildServerArgs(overrides);
      debugLog.log('DesktopApp', 'Server args built', { serverArgs });

      // Start server
      if (!overrides.useExternalServer && !comfyDesktopApp.serverRunning) {
        try {
          debugLog.log('DesktopApp', 'Starting ComfyUI server');
          appState.setInstallStage(createInstallStageInfo(InstallStage.STARTING_SERVER, { progress: 95 }));

          const serverTimer = debugLog.startTimer('DesktopApp:startComfyServer');
          await comfyDesktopApp.startComfyServer(serverArgs);
          serverTimer();
          debugLog.log('DesktopApp', 'Server started successfully');
        } catch (error) {
          debugLog.log('DesktopApp', 'Server start failed', { error: String(error) });
          log.error('Unhandled exception during server start', error);
          appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
          appWindow.sendServerStartProgress(ProgressStatus.ERROR);
          appState.setInstallStage(createInstallStageInfo(InstallStage.ERROR, { progress: 0, error: String(error) }));
          startTimer();
          return;
        }
      } else {
        debugLog.log('DesktopApp', 'Skipping server start', {
          useExternalServer: overrides.useExternalServer,
          serverRunning: comfyDesktopApp.serverRunning,
        });
      }

      debugLog.log('DesktopApp', 'Sending READY progress');
      appWindow.sendServerStartProgress(ProgressStatus.READY);

      debugLog.log('DesktopApp', 'Loading ComfyUI interface');
      await appWindow.loadComfyUI(serverArgs);

      // App start complete
      debugLog.log('DesktopApp', 'Setting install stage to READY');
      appState.setInstallStage(createInstallStageInfo(InstallStage.READY, { progress: 100 }));
      appState.emitLoaded();

      startTimer();
      debugLog.log('DesktopApp', 'Application startup complete');
      log.info(`Startup debug log saved to: ${debugLog.getLogPath()}`);
    } catch (error) {
      startTimer();
      debugLog.log('DesktopApp', 'Fatal startup error', { error: String(error) });
      log.error('Unhandled exception during app startup', error);
      appState.setInstallStage(createInstallStageInfo(InstallStage.ERROR, { error: String(error) }));
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);

      log.info(`Startup debug log saved to: ${debugLog.getLogPath()}`);

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
      registerInstallStateHandlers();

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
}
