import dotenv from 'dotenv';
import { app, dialog, ipcMain, shell } from 'electron';
import { LevelOption } from 'electron-log';
import log from 'electron-log/main';

import { DEFAULT_SERVER_ARGS, IPC_CHANNELS, ProgressStatus } from './constants';
import { AppInfoHandlers } from './handlers/appInfoHandlers';
import { PathHandlers } from './handlers/pathHandlers';
import { InstallationManager } from './install/installationManager';
import { AppWindow } from './main-process/appWindow';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import SentryLogging from './services/sentry';
import { getTelemetry } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { findAvailablePort } from './utils';

dotenv.config();
log.initialize();
log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';
log.info(`Starting app v${app.getVersion()}`);

const allowDevVars = app.commandLine.hasSwitch('dev-mode');

const telemetry = getTelemetry();
// Register the quit handlers regardless of single instance lock and before squirrel startup events.
// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  log.info('Window all closed');
  if (process.platform !== 'darwin') {
    log.info('Quitting ComfyUI because window all closed');
    app.quit();
  }
});

// Suppress unhandled exception dialog when already quitting.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

// Sentry needs to be initialized at the top level.
log.verbose('Initializing Sentry');
SentryLogging.init();

// Synchronous app start
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  app.on('ready', () => {
    log.debug('App ready');
    telemetry.registerHandlers();
    telemetry.track('desktop:app_ready');
    startApp().catch((error) => {
      log.error('Unhandled exception in app startup', error);
      app.exit(2020);
    });
  });
}

// Async app start
async function startApp() {
  // Load config or exit
  try {
    const store = await DesktopConfig.load(shell);
    if (!store) throw new Error('Unknown error loading app config on startup.');
  } catch (error) {
    log.error('Unhandled exception during config load', error);
    dialog.showErrorBox('User Data', `Unknown error whilst writing to user data folder:\n\n${error}`);
    app.exit(20);
    return;
  }

  try {
    // Create native window
    const appWindow = new AppWindow();
    appWindow.onClose(() => {
      if (quitting) return;
      log.info('App window closed. Quitting application.');
      app.quit();
    });

    // Register basic handlers that are necessary during app's installation.
    new PathHandlers().registerHandlers();
    new AppInfoHandlers().registerHandlers(appWindow);
    ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
      log.debug('Open dialog');
      return dialog.showOpenDialogSync({
        ...options,
      });
    });

    try {
      // Install / validate installation is complete
      const installManager = new InstallationManager(appWindow, telemetry);
      const installation = await installManager.ensureInstalled();
      if (!installation.isValid)
        throw new Error(`Fatal: Could not validate installation: [${installation.state}/${installation.issues.size}]`);

      // Initialize app
      const comfyDesktopApp = new ComfyDesktopApp(installation, appWindow, telemetry);
      await comfyDesktopApp.initialize();

      // At this point, user has gone through the onboarding flow.
      SentryLogging.comfyDesktopApp = comfyDesktopApp;
      if (comfyDesktopApp.comfySettings.get('Comfy-Desktop.SendStatistics')) {
        telemetry.hasConsent = true;
        telemetry.flush();
      }
      // Construct core launch args
      const useExternalServer = devOverride('USE_EXTERNAL_SERVER') === 'true';
      // Shallow-clone the setting launch args to avoid mutation.
      const extraServerArgs: Record<string, string> = Object.assign(
        {},
        comfyDesktopApp.comfySettings.get('Comfy.Server.LaunchArgs')
      );
      const host = devOverride('COMFY_HOST') ?? extraServerArgs.listen ?? DEFAULT_SERVER_ARGS.host;
      const targetPort = Number(devOverride('COMFY_PORT') ?? extraServerArgs.port ?? DEFAULT_SERVER_ARGS.port);
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
      if (!quitting) {
        dialog.showErrorBox(
          'Unhandled exception',
          `An unexpected error occurred whilst starting the app, and it needs to be closed.\n\nError message:\n\n${error}`
        );
        app.quit();
      }
    }
  } catch (error) {
    log.error('Fatal error occurred during app pre-startup.', error);
    app.exit(2024);
  }
}

/**
 * Always returns `undefined` in production, unless the `--dev-mode` command line argument is present.
 *
 * When running unpackaged or if the `--dev-mode` argument is present,
 * the requested environment variable is returned, otherwise `undefined`.
 */
function devOverride(value: string) {
  if (allowDevVars || !app.isPackaged) return process.env[value];
}
