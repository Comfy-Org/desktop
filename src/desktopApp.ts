import { app, dialog } from 'electron';
import log from 'electron-log/main';

import { DEFAULT_SERVER_ARGS, ProgressStatus } from './constants';
import { IPC_CHANNELS } from './constants';
import { registerAppHandlers } from './handlers/AppHandlers';
import { registerAppInfoHandlers } from './handlers/appInfoHandlers';
import { registerNetworkHandlers } from './handlers/networkHandlers';
import { registerPathHandlers } from './handlers/pathHandlers';
import type { FatalErrorOptions } from './infrastructure/interfaces';
import { InstallationManager } from './install/installationManager';
import type { IAppState } from './main-process/appState';
import { AppWindow } from './main-process/appWindow';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import type { ComfyInstallation } from './main-process/comfyInstallation';
import { DevOverrides } from './main-process/devOverrides';
import SentryLogging from './services/sentry';
import { type HasTelemetry, type ITelemetry, getTelemetry, promptMetricsConsent } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { findAvailablePort } from './utils';

export class DesktopApp implements HasTelemetry {
  readonly telemetry: ITelemetry = getTelemetry();
  readonly appWindow: AppWindow = new AppWindow();

  constructor(
    private readonly appState: IAppState,
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

  private async initializeTelemetry(installation: ComfyInstallation, comfyDesktopApp: ComfyDesktopApp): Promise<void> {
    SentryLogging.shouldSendStatistics = () => installation.comfySettings.get('Comfy-Desktop.SendStatistics');
    SentryLogging.getBasePath = () => installation.basePath;

    const allowMetrics = await promptMetricsConsent(this.config, this.appWindow, comfyDesktopApp);
    this.telemetry.hasConsent = allowMetrics;
    if (allowMetrics) this.telemetry.flush();
  }

  /** Install / validate installation is complete */
  private async initializeInstallation(): Promise<ComfyInstallation> {
    const { appWindow } = this;
    try {
      const installManager = new InstallationManager(appWindow, this.telemetry);
      return await installManager.ensureInstalled();
    } catch (error) {
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
    }
  }

  async start(): Promise<void> {
    const { appWindow, overrides, telemetry } = this;

    this.registerIpcHandlers();

    const installation = await this.initializeInstallation();

    try {
      // Initialize app
      const comfyDesktopApp = new ComfyDesktopApp(installation, appWindow, telemetry);
      await comfyDesktopApp.initialize();

      // At this point, user has gone through the onboarding flow.
      await this.initializeTelemetry(installation, comfyDesktopApp);

      // Construct core launch args
      const useExternalServer = overrides.USE_EXTERNAL_SERVER === 'true';
      // Shallow-clone the setting launch args to avoid mutation.
      const extraServerArgs: Record<string, string> = Object.assign(
        {},
        comfyDesktopApp.comfySettings.get('Comfy.Server.LaunchArgs')
      );
      const host = overrides.COMFY_HOST ?? extraServerArgs.listen ?? DEFAULT_SERVER_ARGS.host;
      const targetPort = Number(overrides.COMFY_PORT ?? extraServerArgs.port ?? DEFAULT_SERVER_ARGS.port);
      const port = useExternalServer ? targetPort : await findAvailablePort(host, targetPort, targetPort + 1000);

      // Remove listen and port from extraServerArgs so core launch args are used instead.
      delete extraServerArgs.listen;
      delete extraServerArgs.port;

      // Start server
      if (!useExternalServer) {
        try {
          await comfyDesktopApp.startComfyServer({ host, port, extraServerArgs });
        } catch (error) {
          log.error('Unhandled exception during server start', error);
          appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `${error}\n`);
          appWindow.sendServerStartProgress(ProgressStatus.ERROR);
          return;
        }
      }
      appWindow.sendServerStartProgress(ProgressStatus.READY);
      await appWindow.loadComfyUI({ host, port, extraServerArgs });
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

  registerIpcHandlers() {
    try {
      // Register basic handlers that are necessary during app's installation.
      registerPathHandlers();
      registerNetworkHandlers();
      registerAppInfoHandlers(this.appWindow);
      registerAppHandlers();
    } catch (error) {
      DesktopApp.fatalError({
        error,
        message: 'Fatal error occurred during app pre-startup.',
        title: 'Startup failed',
        exitCode: 2024,
      });
    }
  }

  /**
   * Quits the app gracefully after a fatal error.  Exits immediately if a code is provided.
   *
   * Logs the error and shows an error dialog to the user.
   * @param options - The options for the error.
   */
  static fatalError({ message, error, title, logMessage, exitCode }: FatalErrorOptions): never {
    const _error = error ?? new Error(message);
    log.error(logMessage ?? message, _error);
    if (title && message) dialog.showErrorBox(title, message);

    if (exitCode) app.exit(exitCode);
    else app.quit();
    // Unreachable - library type is void instead of never.
    throw new Error(message, { cause: _error });
  }
}
