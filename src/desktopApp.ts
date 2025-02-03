import { app, dialog, ipcMain, shell } from 'electron';
import log from 'electron-log/main';

import { DEFAULT_SERVER_ARGS, ProgressStatus } from './constants';
import { IPC_CHANNELS } from './constants';
import { registerAppHandlers } from './handlers/AppHandlers';
import { registerAppInfoHandlers } from './handlers/appInfoHandlers';
import { registerNetworkHandlers } from './handlers/networkHandlers';
import { registerPathHandlers } from './handlers/pathHandlers';
import { InstallationManager } from './install/installationManager';
import type { IAppState } from './main-process/appState';
import { AppWindow } from './main-process/appWindow';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import { DevOverrides } from './main-process/devOverrides';
import SentryLogging from './services/sentry';
import { type HasTelemetry, type ITelemetry, getTelemetry, promptMetricsConsent } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { findAvailablePort } from './utils';

interface FatalErrorOptions {
  /** The message to display to the user.  Also used for logging if {@link logMessage} is not set. */
  message: string;
  /** The {@link Error} to log. */
  error?: unknown;
  /** The title of the error message box. */
  title?: string;
  /** If set, this replaces the {@link message} for logging. */
  logMessage?: string;
  /** The exit code to use when the app is exited. Default: 2 */
  exitCode?: number;
}

export class DesktopApp implements HasTelemetry {
  readonly telemetry: ITelemetry = getTelemetry();

  constructor(
    private readonly appState: IAppState,
    private readonly overrides: DevOverrides
  ) {}

  async start(): Promise<void> {
    const { appState, overrides, telemetry } = this;

    // Load config or exit
    let store: DesktopConfig | undefined;
    try {
      store = await DesktopConfig.load(shell);
      if (!store) throw new Error('Unknown error loading app config on startup.');
    } catch (error) {
      log.error('Unhandled exception during config load', error);
      dialog.showErrorBox('User Data', `Unknown error whilst writing to user data folder:\n\n${error}`);
      app.exit(20);
      return;
    }

    // Create native window
    const appWindow = new AppWindow();

    // Load start screen - basic spinner
    try {
      await appWindow.loadPage('desktop-start');
    } catch (error) {
      dialog.showErrorBox('Startup failed', `Unknown error whilst loading start screen.\n\n${error}`);
      return app.quit();
    }

    try {
      // Register basic handlers that are necessary during app's installation.
      registerPathHandlers();
      registerNetworkHandlers();
      registerAppInfoHandlers(appWindow);
      registerAppHandlers();
      ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
        log.debug('Open dialog');
        return dialog.showOpenDialogSync({
          ...options,
        });
      });
    } catch (error) {
      log.error('Fatal error occurred during app pre-startup.', error);
      app.exit(2024);
    }

    try {
      // Install / validate installation is complete
      const installManager = new InstallationManager(appWindow, telemetry);
      const installation = await installManager.ensureInstalled();

      // Initialize app
      const comfyDesktopApp = new ComfyDesktopApp(installation, appWindow, telemetry);
      await comfyDesktopApp.initialize();

      // At this point, user has gone through the onboarding flow.
      SentryLogging.comfyDesktopApp = comfyDesktopApp;
      const allowMetrics = await promptMetricsConsent(store, appWindow, comfyDesktopApp);
      telemetry.hasConsent = allowMetrics;
      if (allowMetrics) telemetry.flush();

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
      if (!appState.isQuitting) {
        dialog.showErrorBox(
          'Unhandled exception',
          `An unexpected error occurred whilst starting the app, and it needs to be closed.\n\nError message:\n\n${error}`
        );
        app.quit();
      }
    }
  }

  /**
   * Log and show an error message to the user. Quits gracefully, or exits immediately if a code is provided.
   * @param options - The options for the error.
   */
  static fatalError({ message, error, title, logMessage, exitCode }: FatalErrorOptions): never {
    const err = error ?? new Error(message);
    log.error(logMessage ?? message, err);
    if (title && message) dialog.showErrorBox(title, message);

    if (exitCode) app.exit(exitCode);
    else app.quit();
    // Unreachable - library type is void instead of never.
    throw new Error(message, { cause: err });
  }
}
