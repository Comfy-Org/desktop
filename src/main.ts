import fs from 'fs';
import path from 'node:path';
import { IPC_CHANNELS, SENTRY_URL_ENDPOINT, ProgressStatus, ServerArgs, DEFAULT_SERVER_ARGS } from './constants';
import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import { graphics } from 'systeminformation';
import { ComfyServerConfig } from './config/comfyServerConfig';
import todesktop from '@todesktop/runtime';
import { DownloadManager } from './models/DownloadManager';
import { findAvailablePort, getModelsDirectory } from './utils';
import { ComfySettings } from './config/comfySettings';
import dotenv from 'dotenv';
import { ComfyConfigManager } from './config/comfyConfigManager';
import { AppWindow } from './main-process/appWindow';
import { getBasePath, getPythonInstallPath } from './install/resourcePaths';
import { PathHandlers } from './handlers/pathHandlers';
import { AppInfoHandlers } from './handlers/appInfoHandlers';
import { InstallOptions } from './preload';
import { VirtualEnvironment } from './virtualEnvironment';
import { ComfyServer } from './main-process/comfyServer';

dotenv.config();

let appWindow: AppWindow;
let comfyServer: ComfyServer | null = null;
let downloadManager: DownloadManager;

log.initialize();

// TODO: Load settings from user specified basePath.
// https://github.com/Comfy-Org/electron/issues/259
const comfySettings = new ComfySettings(app.getPath('documents'));
comfySettings.loadSettings();

todesktop.init({
  customLogger: log,
  updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
  autoUpdater: comfySettings.get('Comfy-Desktop.AutoUpdate'),
});

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

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    log.info('Received second instance message!');
    log.info(additionalData);

    if (appWindow) {
      if (appWindow.isMinimized()) appWindow.restore();
      appWindow.focus();
    }
  });

  Sentry.init({
    dsn: SENTRY_URL_ENDPOINT,
    autoSessionTracking: false,
    async beforeSend(event, hint) {
      if (event.extra?.comfyUIExecutionError || comfySettings.get('Comfy-Desktop.SendCrashStatistics')) {
        return event;
      }

      const { response } = await dialog.showMessageBox({
        title: 'Send Crash Statistics',
        message: `Would you like to send crash statistics to the team?`,
        buttons: ['Always send crash reports', 'Do not send crash report'],
      });

      return response === 0 ? event : null;
    },
    integrations: [
      Sentry.childProcessIntegration({
        breadcrumbs: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
        events: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
      }),
    ],
  });

  graphics()
    .then((graphicsInfo) => {
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
    })
    .catch((e) => {
      log.error('Error getting GPU info: ', e);
    });

  app.on('ready', async () => {
    log.info('App ready');

    try {
      appWindow = new AppWindow();
      new PathHandlers().registerHandlers();
      new AppInfoHandlers().registerHandlers();
      ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
        log.info('Open dialog');
        return dialog.showOpenDialogSync({
          ...options,
        });
      });

      ipcMain.on(IPC_CHANNELS.INSTALL_COMFYUI, async (event, installOptions: InstallOptions) => {
        // Non-blocking call. The renderer will navigate to /server-start and show install progress.
        handleInstall(installOptions).then(serverStart);
      });

      // Loading renderer when all handlers are registered to ensure all event listeners are set up.
      const firstTimeSetup = isFirstTimeSetup();
      const urlPath = firstTimeSetup ? 'welcome' : 'server-start';
      await appWindow.loadRenderer(urlPath);

      if (!firstTimeSetup) {
        await serverStart();
      }
    } catch (error) {
      log.error(error);
      sendProgressUpdate(ProgressStatus.ERROR);
    }
  });
}

function sendProgressUpdate(status: ProgressStatus): void {
  appWindow.send(IPC_CHANNELS.LOADING_PROGRESS, {
    status,
  });
}

/**
 * Check if the user has completed the first time setup wizard.
 * This means the extra_models_config.yaml file exists in the user's data directory.
 */
function isFirstTimeSetup(): boolean {
  const extraModelsConfigPath = ComfyServerConfig.configPath;
  log.info(`Checking if first time setup is complete. Extra models config path: ${extraModelsConfigPath}`);
  return !fs.existsSync(extraModelsConfigPath);
}

async function handleInstall(installOptions: InstallOptions) {
  const migrationSource = installOptions.migrationSourcePath;
  const migrationItemIds = new Set<string>(installOptions.migrationItemIds ?? []);

  const actualComfyDirectory = path.join(installOptions.installPath, 'ComfyUI');
  ComfyConfigManager.setUpComfyUI(actualComfyDirectory);

  const { comfyui: comfyuiConfig, ...extraConfigs } = await ComfyServerConfig.getMigrationConfig(
    migrationSource,
    migrationItemIds
  );
  comfyuiConfig['base_path'] = actualComfyDirectory;
  await ComfyServerConfig.createConfigFile(ComfyServerConfig.configPath, comfyuiConfig, extraConfigs);
}

async function serverStart() {
  log.info('Server start');
  const basePath = await getBasePath();
  const pythonInstallPath = await getPythonInstallPath();
  if (!basePath || !pythonInstallPath) {
    log.error('ERROR: Base path not found!');
    sendProgressUpdate(ProgressStatus.ERROR_INSTALL_PATH);
    return;
  }
  DownloadManager.getInstance(appWindow!, getModelsDirectory(basePath));

  const host = process.env.COMFY_HOST || DEFAULT_SERVER_ARGS.host;
  const targetPort = process.env.COMFY_PORT ? parseInt(process.env.COMFY_PORT) : DEFAULT_SERVER_ARGS.port;
  const port = await findAvailablePort(host, targetPort, targetPort + 1000);
  const useExternalServer = process.env.USE_EXTERNAL_SERVER === 'true';
  const extraServerArgs: Record<string, string> = process.env.COMFYUI_CPU_ONLY === 'true' ? { '--cpu': '' } : {};

  if (!useExternalServer) {
    sendProgressUpdate(ProgressStatus.PYTHON_SETUP);
    appWindow.send(IPC_CHANNELS.LOG_MESSAGE, `Creating Python environment...`);
    const virtualEnvironment = new VirtualEnvironment(basePath);
    await virtualEnvironment.create({
      onStdout: (data) => {
        log.info(data);
        appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
      onStderr: (data) => {
        log.error(data);
        appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
      },
    });
    sendProgressUpdate(ProgressStatus.STARTING_SERVER);
    const serverArgs: ServerArgs = { host, port, extraServerArgs };
    comfyServer = new ComfyServer(basePath, serverArgs, virtualEnvironment, appWindow);
    await comfyServer.start();
    sendProgressUpdate(ProgressStatus.READY);
    appWindow.loadComfyUI(serverArgs);
  } else {
    sendProgressUpdate(ProgressStatus.READY);
    // Use target port here because we are using an external server.
    appWindow.loadComfyUI({ host, port: targetPort, extraServerArgs });
  }
}

// TODO(huchenlei): Move all env var field that injected from caller.
/**
 * Whether to use an external server instead of starting one locally.
 * Only effective if COMFY_PORT is set.
 * Note: currently used for testing only.
 */
const useExternalServer = process.env.USE_EXTERNAL_SERVER === 'true';
