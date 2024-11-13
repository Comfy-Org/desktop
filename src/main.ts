import { spawn, ChildProcess } from 'node:child_process';
import fs from 'fs';
import axios from 'axios';
import path from 'node:path';
import { setupTray } from './tray';
import { IPC_CHANNELS, SENTRY_URL_ENDPOINT, ProgressStatus } from './constants';
import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import * as net from 'net';
import { graphics } from 'systeminformation';
import { createModelConfigFiles, getModelConfigPath } from './config/extra_model_config';
import todesktop from '@todesktop/runtime';
import { PythonEnvironment } from './pythonEnvironment';
import { DownloadManager } from './models/DownloadManager';
import { getModelsDirectory } from './utils';
import { ComfySettings } from './config/comfySettings';
import dotenv from 'dotenv';
import { buildMenu } from './menu/menu';
import { ComfyConfigManager } from './config/comfyConfigManager';
import { AppWindow } from './main-process/appWindow';
import { getAppResourcesPath, getBasePath, getPythonInstallPath } from './install/resourcePaths';
import { PathHandlers } from './handlers/pathHandlers';
import { AppInfoHandlers } from './handlers/appInfoHandlers';

dotenv.config();

let comfyServerProcess: ChildProcess | null = null;
let isRestarting: boolean = false; // Prevents double restarts TODO(robinhuang): Remove this once we have a better way to handle restarts. https://github.com/Comfy-Org/electron/issues/149

/** The host to use for the ComfyUI server. */
const host = process.env.COMFY_HOST || '127.0.0.1';
/** The port to use for the ComfyUI server. */
let port = parseInt(process.env.COMFY_PORT || '-1');
/**
 * Whether to use an external server instead of starting one locally.
 * Only effective if COMFY_PORT is set.
 * Note: currently used for testing only.
 */
const useExternalServer = process.env.USE_EXTERNAL_SERVER === 'true';

let appWindow: AppWindow;
let downloadManager: DownloadManager;

log.initialize();

const comfySettings = new ComfySettings(app.getPath('documents'));

todesktop.init({
  customLogger: log,
  updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
  autoUpdater: comfySettings.autoUpdate,
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

app.on('before-quit', async () => {
  try {
    log.info('Before-quit: Killing Python server');
    await killPythonServer();
  } catch (error) {
    // Server did NOT exit properly
    log.error('Python server did not exit properly');
    log.error(error);
  }

  app.exit();
});

app.on('quit', () => {
  log.info('Quitting ComfyUI');
  app.exit();
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
      if (event.extra?.comfyUIExecutionError || comfySettings.sendCrashStatistics) {
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
      createWindow();
      setupTray(appWindow);
      new PathHandlers().registerHandlers();
      new AppInfoHandlers().registerHandlers();

      ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
        log.info('Open dialog');
        return dialog.showOpenDialogSync({
          ...options,
        });
      });

      ipcMain.on(IPC_CHANNELS.OPEN_DEV_TOOLS, () => {
        appWindow.openDevTools();
      });
      ipcMain.handle(IPC_CHANNELS.IS_FIRST_TIME_SETUP, () => {
        return isFirstTimeSetup();
      });
      await handleFirstTimeSetup();
      const basePath = await getBasePath();
      const pythonInstallPath = await getPythonInstallPath();
      if (!basePath || !pythonInstallPath) {
        log.error('ERROR: Base path not found!');
        sendProgressUpdate(ProgressStatus.ERROR_INSTALL_PATH);
        return;
      }
      downloadManager = DownloadManager.getInstance(appWindow!, getModelsDirectory(basePath));

      port =
        port !== -1
          ? port
          : await findAvailablePort(8000, 9999).catch((err) => {
              log.error(`ERROR: Failed to find available port: ${err}`);
              throw err;
            });

      if (!useExternalServer) {
        sendProgressUpdate(ProgressStatus.PYTHON_SETUP);
        const appResourcesPath = await getAppResourcesPath();
        const pythonEnvironment = new PythonEnvironment(pythonInstallPath, appResourcesPath, spawnPythonAsync);
        await pythonEnvironment.setup();
        const modelConfigPath = getModelConfigPath();
        sendProgressUpdate(ProgressStatus.STARTING_SERVER);
        await launchPythonServer(pythonEnvironment.pythonInterpreterPath, appResourcesPath, modelConfigPath, basePath);
      } else {
        sendProgressUpdate(ProgressStatus.READY);
        loadComfyIntoMainWindow();
      }
    } catch (error) {
      log.error(error);
      sendProgressUpdate(ProgressStatus.ERROR);
    }

    ipcMain.on(
      IPC_CHANNELS.RESTART_APP,
      (event, { customMessage, delay }: { customMessage?: string; delay?: number }) => {
        log.info('Received restart app message!');
        if (customMessage) {
          restartApp({ customMessage, delay });
        } else {
          restartApp({ delay });
        }
      }
    );

    ipcMain.handle(IPC_CHANNELS.REINSTALL, async () => {
      log.info('Reinstalling...');
      const modelConfigPath = getModelConfigPath();
      fs.rmSync(modelConfigPath);
      restartApp();
    });

    ipcMain.handle(IPC_CHANNELS.SEND_ERROR_TO_SENTRY, async (_event, { error, extras }): Promise<string | null> => {
      try {
        return Sentry.captureMessage(error, {
          level: 'error',
          extra: { ...extras, comfyUIExecutionError: true },
        });
      } catch (err) {
        log.error('Failed to send error to Sentry:', err);
        return null;
      }
    });
  });
}

function loadComfyIntoMainWindow() {
  appWindow.loadURL(`http://${host}:${port}`);
}
function restartApp({ customMessage, delay }: { customMessage?: string; delay?: number } = {}): void {
  function relaunchApplication(delay?: number) {
    isRestarting = true;
    if (delay) {
      log.info('Relaunching application in ', delay, 'ms');
      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, delay);
    } else {
      app.relaunch();
      app.quit();
    }
  }

  log.info('Attempting to restart app with custom message: ', customMessage);
  if (isRestarting) {
    log.info('Already quitting, skipping restart');
    return;
  }

  if (!customMessage) {
    log.info('Skipping confirmation, restarting immediately');
    return relaunchApplication(delay);
  }

  dialog
    .showMessageBox({
      type: 'question',
      buttons: ['Yes', 'No'],
      defaultId: 0,
      title: 'Restart ComfyUI',
      message: customMessage || 'Are you sure you want to restart ComfyUI?',
      detail: 'The application will close and restart automatically.',
    })
    .then(({ response }) => {
      if (response === 0) {
        // "Yes" was clicked
        log.info('User confirmed restart');
        relaunchApplication(delay);
      } else {
        log.info('User cancelled restart');
      }
    });
}

/**
 * Creates the main application window.
 */
export const createWindow = (): void => {
  appWindow = new AppWindow();
  buildMenu();
};

const isComfyServerReady = async (host: string, port: number): Promise<boolean> => {
  const url = `http://${host}:${port}/queue`;

  try {
    const response = await axios.get(url, {
      timeout: 5000, // 5 seconds timeout
    });

    if (response.status >= 200 && response.status < 300) {
      log.info(`Server responded with status ${response.status} at ${url}`);
      return true;
    } else {
      log.warn(`Server responded with status ${response.status} at ${url}`);
      return false;
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      log.error(`Failed to connect to server at ${url}: ${error.message}`);
    } else {
      log.error(`Unexpected error when checking server at ${url}: ${error}`);
    }
    return false;
  }
};

// Launch Python Server Variables
const maxFailWait: number = 120 * 1000; // 120seconds
let currentWaitTime = 0;
let spawnServerTimeout: NodeJS.Timeout | null = null;

const launchPythonServer = async (
  pythonInterpreterPath: string,
  appResourcesPath: string,
  modelConfigPath: string,
  basePath: string
) => {
  const isServerRunning = await isComfyServerReady(host, port);
  if (isServerRunning) {
    log.info('Python server is already running. Attaching to it.');
    // Server has been started outside the app, so attach to it.
    return loadComfyIntoMainWindow();
  }

  log.info(
    `Launching Python server with port ${port}. python path: ${pythonInterpreterPath}, app resources path: ${appResourcesPath}, model config path: ${modelConfigPath}, base path: ${basePath}`
  );

  return new Promise<void>(async (resolve, reject) => {
    const scriptPath = path.join(appResourcesPath, 'ComfyUI', 'main.py');
    const userDirectoryPath = path.join(basePath, 'user');
    const inputDirectoryPath = path.join(basePath, 'input');
    const outputDirectoryPath = path.join(basePath, 'output');
    const comfyMainCmd = [
      scriptPath,
      '--user-directory',
      userDirectoryPath,
      '--input-directory',
      inputDirectoryPath,
      '--output-directory',
      outputDirectoryPath,
      ...(process.env.COMFYUI_CPU_ONLY === 'true' ? ['--cpu'] : []),
      '--front-end-root',
      path.join(appResourcesPath, 'ComfyUI', 'web_custom_versions', 'desktop_app'),
      '--extra-model-paths-config',
      modelConfigPath,
      '--port',
      port.toString(),
    ];

    log.info(`Starting ComfyUI using port ${port}.`);

    comfyServerProcess = spawnPython(pythonInterpreterPath, comfyMainCmd, path.dirname(scriptPath), {
      logFile: 'comfyui',
      stdx: true,
    });

    const checkInterval = 1000; // Check every 1 second

    const checkServerReady = async (): Promise<void> => {
      currentWaitTime += 1000;
      if (currentWaitTime > maxFailWait) {
        //Something has gone wrong and we need to backout.
        if (spawnServerTimeout) {
          clearTimeout(spawnServerTimeout);
        }
        reject('Python Server Failed To Start Within Timeout.');
      }
      const isReady = await isComfyServerReady(host, port);
      if (isReady) {
        sendProgressUpdate(ProgressStatus.READY);
        log.info('Python server is ready');

        //For now just replace the source of the main window to the python server
        setTimeout(() => loadComfyIntoMainWindow(), 1000);
        if (spawnServerTimeout) {
          clearTimeout(spawnServerTimeout);
        }
        return resolve();
      } else {
        log.info('Ping failed. Retrying...');
        spawnServerTimeout = setTimeout(checkServerReady, checkInterval);
      }
    };

    checkServerReady();
  });
};

function sendProgressUpdate(status: ProgressStatus): void {
  log.info('Sending progress update to renderer ' + status);
  appWindow.send(IPC_CHANNELS.LOADING_PROGRESS, {
    status,
  });
}

const killPythonServer = async (): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (!comfyServerProcess) {
      resolve();
      return;
    }

    log.info('Killing ComfyUI python server.');
    // Set up a timeout in case the process doesn't exit
    const timeout = setTimeout(() => {
      reject(new Error('Timeout: Python server did not exit within 10 seconds'));
    }, 10000);

    // Listen for the 'exit' event
    comfyServerProcess.once('exit', (code, signal) => {
      clearTimeout(timeout);
      log.info(`Python server exited with code ${code} and signal ${signal}`);
      comfyServerProcess = null;
      resolve();
    });

    // Attempt to kill the process
    const result = comfyServerProcess.kill();
    if (!result) {
      clearTimeout(timeout);
      reject(new Error('Failed to initiate kill signal for python server'));
    }
  });
};

const spawnPython = (
  pythonInterpreterPath: string,
  cmd: string[],
  cwd: string,
  options = { stdx: true, logFile: '' }
) => {
  log.info(`Spawning python process ${pythonInterpreterPath} with command: ${cmd.join(' ')} in directory: ${cwd}`);
  const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, {
    cwd,
  });

  if (options.stdx) {
    log.info('Setting up python process stdout/stderr listeners');

    let pythonLog = log;
    if (options.logFile) {
      log.info('Creating separate python log file: ', options.logFile);
      // Rotate log files so each log file is unique to a single python run.
      rotateLogFiles(app.getPath('logs'), options.logFile);
      pythonLog = log.create({ logId: options.logFile });
      pythonLog.transports.file.fileName = `${options.logFile}.log`;
      pythonLog.transports.file.resolvePathFn = (variables) => {
        return path.join(variables.electronDefaultDir ?? '', variables.fileName ?? '');
      };
    }

    pythonProcess.stderr?.on?.('data', (data) => {
      const message = data.toString().trim();
      pythonLog.error(`stderr: ${message}`);
      if (appWindow) {
        appWindow.send(IPC_CHANNELS.LOG_MESSAGE, message);
      }
    });
    pythonProcess.stdout?.on?.('data', (data) => {
      const message = data.toString().trim();
      pythonLog.info(`stdout: ${message}`);
      if (appWindow) {
        appWindow.send(IPC_CHANNELS.LOG_MESSAGE, message);
      }
    });
  }

  return pythonProcess;
};

const spawnPythonAsync = (
  pythonInterpreterPath: string,
  cmd: string[],
  cwd: string,
  options = { stdx: true }
): Promise<{ exitCode: number | null }> => {
  return new Promise((resolve, reject) => {
    log.info(`Spawning python process with command: ${pythonInterpreterPath} ${cmd.join(' ')} in directory: ${cwd}`);
    const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, { cwd });

    const cleanup = () => {
      pythonProcess.removeAllListeners();
    };

    if (options.stdx) {
      log.info('Setting up python process stdout/stderr listeners');
      pythonProcess.stderr?.on?.('data', (data) => {
        const message = data.toString();
        log.error(message);
        if (appWindow) {
          appWindow.send(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
      pythonProcess.stdout?.on?.('data', (data) => {
        const message = data.toString();
        log.info(message);
        if (appWindow) {
          appWindow.send(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
    }

    pythonProcess.on('close', (code) => {
      cleanup();
      log.info(`Python process exited with code ${code}`);
      resolve({ exitCode: code });
    });

    pythonProcess.on('error', (err) => {
      cleanup();
      log.error(`Failed to start Python process: ${err}`);
      reject(err);
    });
  });
};

function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > endPort) {
        reject(new Error('No available ports found'));
        return;
      }

      const server = net.createServer();
      server.listen(port, host, () => {
        server.once('close', () => {
          resolve(port);
        });
        server.close();
      });
      server.on('error', () => {
        tryPort(port + 1);
      });
    }

    tryPort(startPort);
  });
}
/**
 * Check if the user has completed the first time setup wizard.
 * This means the extra_models_config.yaml file exists in the user's data directory.
 */
function isFirstTimeSetup(): boolean {
  const extraModelsConfigPath = getModelConfigPath();
  log.info(`Checking if first time setup is complete. Extra models config path: ${extraModelsConfigPath}`);
  return !fs.existsSync(extraModelsConfigPath);
}

async function selectedInstallDirectory(): Promise<string> {
  return new Promise((resolve, reject) => {
    ipcMain.on(IPC_CHANNELS.SELECTED_DIRECTORY, (_event, value) => {
      log.info('User selected to install ComfyUI in:', value);
      resolve(value);
    });
  });
}

async function handleFirstTimeSetup() {
  const firstTimeSetup = isFirstTimeSetup();
  log.info('First time setup:', firstTimeSetup);
  if (firstTimeSetup) {
    appWindow.send(IPC_CHANNELS.SHOW_SELECT_DIRECTORY, null);
    const selectedDirectory = await selectedInstallDirectory();
    const actualComfyDirectory = ComfyConfigManager.setUpComfyUI(selectedDirectory);

    const modelConfigPath = getModelConfigPath();
    await createModelConfigFiles(modelConfigPath, actualComfyDirectory);
  } else {
    appWindow.send(IPC_CHANNELS.FIRST_TIME_SETUP_COMPLETE, null);
  }
}

/**
 * Rotate old log files by adding a timestamp to the end of the file.
 * @param logDir The directory to rotate the logs in.
 * @param baseName The base name of the log file.
 */
const rotateLogFiles = (logDir: string, baseName: string) => {
  const currentLogPath = path.join(logDir, `${baseName}.log`);
  if (fs.existsSync(currentLogPath)) {
    const stats = fs.statSync(currentLogPath);
    const timestamp = stats.birthtime.toISOString().replace(/[:.]/g, '-');
    const newLogPath = path.join(logDir, `${baseName}_${timestamp}.log`);
    fs.renameSync(currentLogPath, newLogPath);
  }
};
