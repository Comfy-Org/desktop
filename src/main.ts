/* eslint-disable unicorn/prefer-top-level-await */
import dotenv from 'dotenv';
import { app, dialog, ipcMain, shell } from 'electron';
import { LevelOption } from 'electron-log';
import log from 'electron-log/main';

import { DEFAULT_SERVER_ARGS, IPC_CHANNELS, ProgressStatus } from './constants';
import { registerAppHandlers } from './handlers/AppHandlers';
import { registerAppInfoHandlers } from './handlers/appInfoHandlers';
import { registerNetworkHandlers } from './handlers/networkHandlers';
import { registerPathHandlers } from './handlers/pathHandlers';
import { InstallationManager } from './install/installationManager';
import { AppState } from './main-process/appState';
import { AppWindow } from './main-process/appWindow';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import { DevOverrides } from './main-process/devOverrides';
import SentryLogging from './services/sentry';
import { getTelemetry, promptMetricsConsent } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { findAvailablePort } from './utils';

// Synchronous pre-start configuration
dotenv.config();
initalizeLogging();

const telemetry = getTelemetry();
const appState = new AppState();
const overrides = new DevOverrides();

// Register the quit handlers regardless of single instance lock and before squirrel startup events.
quitWhenAllWindowsAreClosed();
trackAppQuitEvents();
initializeSentry();

// Async config & app start
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  startApp().catch((error) => {
    log.error('Unhandled exception in app startup', error);
    app.exit(2020);
  });
}

/** Wrapper for top-level await; the app is bundled to CommonJS. */
async function startApp() {
  // Wait for electron app ready event
  await new Promise<void>((resolve) => app.once('ready', () => resolve()));
  log.debug('App ready');

  telemetry.registerHandlers();
  telemetry.track('desktop:app_ready');

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

/** Must be called prior to any logging. Sets default log level and logs app version. */
function initalizeLogging() {
  log.initialize();
  log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';
  log.info(`Starting app v${app.getVersion()}`);
}

/** Quit when all windows are closed.*/
function quitWhenAllWindowsAreClosed() {
  app.on('window-all-closed', () => {
    log.info('Quitting ComfyUI because window all closed');
    app.quit();
  });
}

/** Add telemetry for the app quit event. */
function trackAppQuitEvents() {
  app.on('quit', (event, exitCode) => {
    telemetry.track('desktop:app_quit', {
      reason: event,
      exitCode,
    });
  });
}

/** Sentry needs to be initialized at the top level. */
function initializeSentry() {
  log.verbose('Initializing Sentry');
  SentryLogging.init();
}
