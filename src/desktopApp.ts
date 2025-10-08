import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { ProgressStatus, type ServerArgs } from './constants';
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
import { createProcessCallbacks } from './install/createProcessCallbacks';
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

export class DesktopApp implements HasTelemetry {
  readonly telemetry: ITelemetry = getTelemetry();
  readonly appState: IAppState = useAppState();
  readonly appWindow: AppWindow;

  comfyDesktopApp?: ComfyDesktopApp;
  installation?: ComfyInstallation;

  constructor(
    private readonly overrides: DevOverrides,
    private readonly config: DesktopConfig
  ) {
    this.appWindow = new AppWindow(
      overrides.DEV_SERVER_URL,
      overrides.DEV_FRONTEND_URL,
      overrides.DEV_TOOLS_AUTO === 'true'
    );
  }

  /** Load start screen - basic spinner */
  async showLoadingPage() {
    try {
      this.appState.setInstallStage(createInstallStageInfo(InstallStage.APP_INITIALIZING, { progress: 1 }));
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

    appState.setInstallStage(createInstallStageInfo(InstallStage.CHECKING_EXISTING_INSTALL, { progress: 2 }));
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

      // Short circuit if using external server or server is already running
      if (overrides.useExternalServer || comfyDesktopApp.serverRunning) {
        await loadFrontend(serverArgs);
        return;
      }

      // Start server
      try {
        await startComfyServer(comfyDesktopApp, serverArgs);
        await loadFrontend(serverArgs);
      } catch (error) {
        // If there is a module import error, offer to try and recreate the venv.
        const lastError = comfyDesktopApp.comfyServer?.parseLastError();
        if (lastError === 'ModuleNotFoundError') {
          const shouldReinstallVenv = await getUserApprovalToReinstallVenv();

          if (shouldReinstallVenv) {
            // User chose to reinstall - remove venv and retry
            log.info('User chose to reinstall venv after import verification failure');

            const { virtualEnvironment } = installation;
            const removed = await virtualEnvironment.removeVenvDirectory();
            if (!removed) throw new Error('Failed to remove .venv directory');

            try {
              await virtualEnvironment.create(createProcessCallbacks(appWindow, { logStderrAsInfo: true }));
              await startComfyServer(comfyDesktopApp, serverArgs);
              await loadFrontend(serverArgs);
              return;
            } catch (error) {
              showStartupErrorPage(error);
            }
          }
        }

        showStartupErrorPage(error);
      }
    } catch (error) {
      log.error('Unhandled exception during app startup', error);
      appState.setInstallStage(createInstallStageInfo(InstallStage.ERROR, { error: String(error) }));
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

    /**
     * Shows a dialog to the user asking if they want to reinstall the venv.
     * @returns The result of the dialog.
     */
    async function getUserApprovalToReinstallVenv(): Promise<boolean> {
      const { response } = await appWindow.showMessageBox({
        type: 'error',
        title: 'Python Environment Issue',
        message:
          'Missing Python Module\n\n' +
          'We were unable to import at least one required Python module.\n\n' +
          'Would you like to remove and reinstall the venv?',
        buttons: ['Reset Virtual Environment', 'Ignore'],
        defaultId: 0,
        cancelId: 1,
      });
      return response === 0;
    }

    /**
     * Shows the starting server page and starts the ComfyUI server.
     * @param comfyDesktopApp The comfy desktop app instance.
     * @param serverArgs The server args to use to start the server.
     */
    async function startComfyServer(comfyDesktopApp: ComfyDesktopApp, serverArgs: ServerArgs): Promise<void> {
      appState.setInstallStage(createInstallStageInfo(InstallStage.STARTING_SERVER));
      await comfyDesktopApp.startComfyServer(serverArgs);
    }

    /**
     * Loads the frontend and sets the app state to ready.
     * @param serverArgs The server args to use to load the frontend.
     */
    async function loadFrontend(serverArgs: ServerArgs): Promise<void> {
      appWindow.sendServerStartProgress(ProgressStatus.READY);
      await appWindow.loadComfyUI(serverArgs);

      appState.setInstallStage(createInstallStageInfo(InstallStage.READY, { progress: 100 }));
      appState.emitLoaded();
    }

    /**
     * Shows the startup error page and sets the app state to error.
     * @param error The error to show the startup error page for.
     */
    function showStartupErrorPage(error: unknown): void {
      log.error('Unhandled exception during server start', error);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appState.setInstallStage(createInstallStageInfo(InstallStage.ERROR, { progress: 0, error: String(error) }));
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
      // @ts-expect-error API says this should return false; always treated as falsy.
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
