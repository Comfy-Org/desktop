import { IPC_CHANNELS, DEFAULT_SERVER_ARGS, ProgressStatus, SENTRY_URL_ENDPOINT } from './constants';
import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import { findAvailablePort } from './utils';
import dotenv from 'dotenv';
import { AppWindow } from './main-process/appWindow';
import { PathHandlers } from './handlers/pathHandlers';
import { AppInfoHandlers } from './handlers/appInfoHandlers';
import { ComfyDesktopApp } from './main-process/comfyDesktopApp';
import { LevelOption } from 'electron-log';
import SentryLogging from './services/sentry';
import { DesktopConfig } from './store/desktopConfig';

dotenv.config();
log.initialize();
log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';

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

/**
 * Sentry needs to be initialized at the top level.
 */
SentryLogging.init();

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  app.on('ready', async () => {
    log.debug('App ready');

    const store = await DesktopConfig.load();
    if (store) {
      startApp();
    } else {
      app.exit(20);
    }
  });
}

async function startApp() {
  try {
    const appWindow = new AppWindow();
    appWindow.onClose(() => {
      log.info('App window closed. Quitting application.');
      app.quit();
    });

    // Register basic handlers that are necessary during app's installation.
    new PathHandlers().registerHandlers();
    new AppInfoHandlers().registerHandlers();
    ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
      log.debug('Open dialog');
      return dialog.showOpenDialogSync({
        ...options,
      });
    });
    try {
      const comfyDesktopApp = await ComfyDesktopApp.create(appWindow);
      await comfyDesktopApp.initialize();
      SentryLogging.comfyDesktopApp = comfyDesktopApp;

      const useExternalServer = process.env.USE_EXTERNAL_SERVER === 'true';
      const host = process.env.COMFY_HOST || DEFAULT_SERVER_ARGS.host;
      const targetPort = process.env.COMFY_PORT ? parseInt(process.env.COMFY_PORT) : DEFAULT_SERVER_ARGS.port;
      const port = useExternalServer ? targetPort : await findAvailablePort(host, targetPort, targetPort + 1000);
      const cpuOnly: Record<string, string> = process.env.COMFYUI_CPU_ONLY === 'true' ? { '--cpu': '' } : {};
      const extraServerArgs: Record<string, string> = {
        ...comfyDesktopApp.comfySettings.get('Comfy.Server.LaunchArgs'),
        ...cpuOnly,
      };

      if (!useExternalServer) {
        await comfyDesktopApp.startComfyServer({ host, port, extraServerArgs });
      }
      appWindow.sendServerStartProgress(ProgressStatus.READY);
      appWindow.loadComfyUI({ host, port, extraServerArgs });
    } catch (error) {
      appWindow.sendServerStartProgress(ProgressStatus.ERROR);
      appWindow.send(IPC_CHANNELS.LOG_MESSAGE, error);
    }
  } catch (error) {
    log.error('Fatal error occurred during app startup.', error);
    app.exit(2024);
  }
}
