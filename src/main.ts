import { spawn, ChildProcess } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import fs from 'fs';
import axios from 'axios';
import path from 'node:path';
import { SetupTray } from './tray';
import {
  COMFY_ERROR_MESSAGE,
  COMFY_FINISHING_MESSAGE,
  IPC_CHANNELS,
  IPCChannel,
  SENTRY_URL_ENDPOINT,
} from './constants';
import { app, BrowserWindow, dialog, screen, ipcMain, Menu, MenuItem, globalShortcut, shell } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import Store from 'electron-store';
import * as net from 'net';
import { graphics } from 'systeminformation';
import { createModelConfigFiles, readBasePathFromConfig } from './config/extra_model_config';
import { WebSocketServer } from 'ws';
import { StoreType } from './store';
import { createReadStream, watchFile } from 'node:fs';
import todesktop from '@todesktop/runtime';
import { PythonEnvironment } from './pythonEnvironment';
import { DownloadManager } from './models/DownloadManager';
import { getModelsDirectory } from './utils';

let comfyServerProcess: ChildProcess | null = null;
const host = '127.0.0.1';
let port = 8188;
let mainWindow: BrowserWindow | null = null;
let wss: WebSocketServer | null;
let store: Store<StoreType> | null = null;
const messageQueue: Array<any> = []; // Stores mesaages before renderer is ready.
let downloadManager: DownloadManager;

log.initialize();

todesktop.init({
  customLogger: log,
  updateReadyAction: { showInstallAndRestartPrompt: 'always', showNotification: 'always' },
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

  closeWebSocketServer();
  globalShortcut.unregisterAll();

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
  store = new Store<StoreType>();
  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    log.info('Received second instance message!');
    log.info(additionalData);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.isPackaged &&
    Sentry.init({
      dsn: SENTRY_URL_ENDPOINT,
      autoSessionTracking: false,

      /* //WIP gather and send log from main 
    beforeSend(event, hint) {
      hint.attachments = [
        {
          filename: 'main.log',
          attachmentType: 'event.attachment',
          data: readLogMain(),
        },
      ];
      return event;
    }, */
      integrations: [
        Sentry.childProcessIntegration({
          breadcrumbs: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
          events: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
        }),
      ],
    });

  graphics()
    .then((graphicsInfo) => {
      log.info('GPU Info: ', graphicsInfo);

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
      log.info('GPU Info: ', allGpuInfo);
      // Set Sentry context with all GPU information
      Sentry.setContext('gpus', allGpuInfo);
    })
    .catch((e) => {
      log.error('Error getting GPU info: ', e);
    });

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  app.on('ready', async () => {
    log.info('App ready');

    app.on('activate', async () => {
      // On OS X it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        const { userResourcesPath } = await determineResourcesPaths();
        createWindow(userResourcesPath);
      }
    });

    try {
      await createWindow();
      if (!mainWindow) {
        log.error('ERROR: Main window not found!');
        return;
      }
      startWebSocketServer();
      mainWindow.on('close', () => {
        mainWindow = null;
        app.quit();
      });
      ipcMain.on(IPC_CHANNELS.RENDERER_READY, () => {
        log.info('Received renderer-ready message!');
        // Send all queued messages
        while (messageQueue.length > 0) {
          const message = messageQueue.shift();
          log.info('Sending queued message ', message.channel);
          if (mainWindow) {
            mainWindow.webContents.send(message.channel, message.data);
          }
        }
      });
      ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
        log.info('Open dialog');
        return dialog.showOpenDialogSync({
          ...options,
        });
      });
      ipcMain.on(IPC_CHANNELS.OPEN_LOGS_FOLDER, () => {
        shell.openPath(app.getPath('logs'));
      });
      ipcMain.handle(IPC_CHANNELS.IS_PACKAGED, () => {
        return app.isPackaged;
      });
      await handleFirstTimeSetup();
      const { appResourcesPath, pythonInstallPath, modelConfigPath, basePath } = await determineResourcesPaths();
      if (!basePath) {
        log.error('ERROR: Base path not found!');
        return;
      }
      downloadManager = DownloadManager.getInstance(mainWindow!, getModelsDirectory(basePath));
      port = await findAvailablePort(8000, 9999).catch((err) => {
        log.error(`ERROR: Failed to find available port: ${err}`);
        throw err;
      });

      sendProgressUpdate('Setting up Python Environment...');
      const pythonEnvironment = new PythonEnvironment(pythonInstallPath, appResourcesPath, spawnPythonAsync);
      await pythonEnvironment.setup();

      installElectronAdapter(appResourcesPath);
      SetupTray(
        mainWindow,
        basePath,
        modelConfigPath,
        () => {
          log.info('Resetting install location');
          fs.rmSync(modelConfigPath);
          restartApp();
        },
        pythonEnvironment
      );
      sendProgressUpdate('Starting Comfy Server...');
      await launchPythonServer(pythonEnvironment.pythonInterpreterPath, appResourcesPath, modelConfigPath, basePath);
    } catch (error) {
      log.error(error);
      sendProgressUpdate(COMFY_ERROR_MESSAGE);
    }

    ipcMain.on(IPC_CHANNELS.RESTART_APP, () => {
      log.info('Received restart app message!');
      restartApp();
    });

    ipcMain.handle(IPC_CHANNELS.GET_COMFYUI_URL, () => {
      return `http://${host}:${port}`;
    });
  });
}

async function readComfyUILogs(): Promise<string[]> {
  try {
    const logContent = await fsPromises.readFile(path.join(app.getPath('logs'), 'comfyui.log'), 'utf-8');
    const logs = logContent.split('\n');
    return logs;
  } catch (error) {
    console.error('Error reading log file:', error);
    return [];
  }
}

function loadComfyIntoMainWindow() {
  if (!mainWindow) {
    log.error('Trying to load ComfyUI into main window but it is not ready yet.');
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.COMFYUI_READY, port);
}

async function loadRendererIntoMainWindow(): Promise<void> {
  if (!mainWindow) {
    log.error('Trying to load renderer into main window but it is not ready yet.');
    return;
  }
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined') {
    log.info('Loading Vite Dev Server');
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    log.info('Opened Vite Dev Server');
    //mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/index.html`));
  }
}

function restartApp() {
  log.info('Restarting app');
  app.relaunch();
  app.quit();
}

function buildMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const aboutMenuItem = {
      label: 'About ComfyUI',
      click: () => {
        dialog.showMessageBox({
          title: 'About',
          message: `ComfyUI v${app.getVersion()}`,
          detail: 'Created by Comfy Org\nCopyright © 2024',
          buttons: ['OK'],
        });
      },
    };
    const helpMenuItem = menu.items.find((item) => item.role === 'help');
    if (helpMenuItem && helpMenuItem.submenu) {
      helpMenuItem.submenu.append(new MenuItem(aboutMenuItem));
      Menu.setApplicationMenu(menu);
    } else {
      // If there's no Help menu, add one
      menu.append(
        new MenuItem({
          label: 'Help',
          submenu: [aboutMenuItem],
        })
      );
      Menu.setApplicationMenu(menu);
    }
  }
}

/**
 * Creates the main window. If the window already exists, it will return the existing window.
 * @param userResourcesPath The path to the user's resources.
 * @returns The main window.
 */
export const createWindow = async (userResourcesPath?: string): Promise<BrowserWindow> => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Retrieve stored window size, or use default if not available
  const storedWidth = store?.get('windowWidth', width) ?? width;
  const storedHeight = store?.get('windowHeight', height) ?? height;
  const storedX = store?.get('windowX');
  const storedY = store?.get('windowY');

  if (mainWindow) {
    log.info('Main window already exists');
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    title: 'ComfyUI',
    width: storedWidth,
    height: storedHeight,
    x: storedX,
    y: storedY,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      webviewTag: true,
      devTools: true,
    },
    autoHideMenuBar: true,
  });
  log.info('Loading renderer into main window');
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.DEFAULT_INSTALL_LOCATION, app.getPath('documents'));
    }
  });
  ipcMain.handle(IPC_CHANNELS.GET_PRELOAD_SCRIPT, () => path.join(__dirname, 'preload.js'));
  await loadRendererIntoMainWindow();
  log.info('Renderer loaded into main window');

  const updateBounds = () => {
    if (!mainWindow || !store) return;

    const { width, height, x, y } = mainWindow.getBounds();
    store.set('windowWidth', width);
    store.set('windowHeight', height);
    store.set('windowX', x);
    store.set('windowY', y);
  };

  mainWindow.on('resize', updateBounds);
  mainWindow.on('move', updateBounds);

  mainWindow.on('close', (e: Electron.Event) => {
    // Mac Only Behavior
    if (process.platform === 'darwin') {
      e.preventDefault();
      if (mainWindow) mainWindow.hide();
      app.dock.hide();
    }
    mainWindow = null;
  });

  buildMenu();

  return mainWindow;
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
      '--front-end-version',
      'Comfy-Org/ComfyUI_frontend@latest',
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
        sendProgressUpdate(COMFY_FINISHING_MESSAGE);
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

function sendProgressUpdate(status: string): void {
  if (mainWindow) {
    log.info('Sending progress update to renderer ' + status);
    sendRendererMessage(IPC_CHANNELS.LOADING_PROGRESS, {
      status,
    });
  }
}

const sendRendererMessage = (channel: IPCChannel, data: any) => {
  const newMessage = {
    channel: channel,
    data: data,
  };

  if (!mainWindow?.webContents || mainWindow.webContents.isLoading()) {
    log.info('Queueing message since renderer is not ready yet.');
    messageQueue.push(newMessage);
    return;
  }

  if (messageQueue.length > 0) {
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      if (message) {
        log.info('Sending queued message ', message.channel, message.data);
        mainWindow.webContents.send(message.channel, message.data);
      }
    }
  }
  mainWindow.webContents.send(newMessage.channel, newMessage.data);
};

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
      if (mainWindow) {
        sendRendererMessage(IPC_CHANNELS.LOG_MESSAGE, message);
      }
    });
    pythonProcess.stdout?.on?.('data', (data) => {
      const message = data.toString().trim();
      pythonLog.info(`stdout: ${message}`);
      if (mainWindow) {
        sendRendererMessage(IPC_CHANNELS.LOG_MESSAGE, message);
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
        if (mainWindow) {
          sendRendererMessage(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
      pythonProcess.stdout?.on?.('data', (data) => {
        const message = data.toString();
        log.info(message);
        if (mainWindow) {
          sendRendererMessage(IPC_CHANNELS.LOG_MESSAGE, message);
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

function isComfyUIDirectory(directory: string): boolean {
  const requiredSubdirs = ['models', 'input', 'user', 'output', 'custom_nodes'];
  return requiredSubdirs.every((subdir) => fs.existsSync(path.join(directory, subdir)));
}

type DirectoryStructure = (string | DirectoryStructure)[];

function createComfyDirectories(localComfyDirectory: string): void {
  log.info(`Creating ComfyUI directories in ${localComfyDirectory}`);

  const directories: DirectoryStructure = [
    'custom_nodes',
    'input',
    'output',
    ['user', ['default']],
    [
      'models',
      [
        'checkpoints',
        'clip',
        'clip_vision',
        'configs',
        'controlnet',
        'diffusers',
        'diffusion_models',
        'embeddings',
        'gligen',
        'hypernetworks',
        'loras',
        'photomaker',
        'style_models',
        'unet',
        'upscale_models',
        'vae',
        'vae_approx',

        // TODO(robinhuang): Remove when we have a better way to specify base model paths.
        'animatediff_models',
        'animatediff_motion_lora',
        'animatediff_video_formats',
        'liveportrait',
        ['insightface', ['buffalo_1']],
        ['blip', ['checkpoints']],
        'CogVideo',
        ['xlabs', ['loras', 'controlnets']],
        'layerstyle',
        'LLM',
        'Joy_caption',
      ],
    ],
  ];
  try {
    createNestedDirectories(localComfyDirectory, directories);
  } catch (error) {
    log.error(`Failed to create ComfyUI directories: ${error}`);
  }

  const userSettingsPath = path.join(localComfyDirectory, 'user', 'default');
  createComfyConfigFile(userSettingsPath, true);
}

function createNestedDirectories(basePath: string, structure: DirectoryStructure): void {
  structure.forEach((item) => {
    if (typeof item === 'string') {
      const dirPath = path.join(basePath, item);
      createDirIfNotExists(dirPath);
    } else if (Array.isArray(item) && item.length === 2) {
      const [dirName, subDirs] = item;
      if (typeof dirName === 'string') {
        const newBasePath = path.join(basePath, dirName);
        createDirIfNotExists(newBasePath);
        if (Array.isArray(subDirs)) {
          createNestedDirectories(newBasePath, subDirs);
        }
      } else {
        log.warn(`Invalid directory structure item: ${JSON.stringify(item)}`);
      }
    } else {
      log.warn(`Invalid directory structure item: ${JSON.stringify(item)}`);
    }
  });
}

/**
 * Create a directory if not exists
 * @param dirPath
 */
function createDirIfNotExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log.info(`Created directory: ${dirPath}`);
  } else {
    log.info(`Directory already exists: ${dirPath}`);
  }
}

function createComfyConfigFile(userSettingsPath: string, overwrite: boolean = false): void {
  const configContent: any = {
    'Comfy.ColorPalette': 'dark',
    'Comfy.UseNewMenu': 'Top',
    'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
    'Comfy.Workflow.ShowMissingModelsWarning': true,
  };

  const configFilePath = path.join(userSettingsPath, 'comfy.settings.json');

  if (fs.existsSync(configFilePath) && overwrite) {
    const backupFilePath = path.join(userSettingsPath, 'old_comfy.settings.json');
    try {
      fs.renameSync(configFilePath, backupFilePath);
      log.info(`Renaming existing user settings file to: ${backupFilePath}`);
    } catch (error) {
      log.error(`Failed to backup existing user settings file: ${error}`);
      return;
    }
  }

  try {
    fs.writeFileSync(configFilePath, JSON.stringify(configContent, null, 2));
    log.info(`Created new ComfyUI config file at: ${configFilePath}`);
  } catch (error) {
    log.error(`Failed to create new ComfyUI config file: ${error}`);
  }
}

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
  const userDataPath = app.getPath('userData');
  const extraModelsConfigPath = path.join(userDataPath, 'extra_models_config.yaml');
  return !fs.existsSync(extraModelsConfigPath);
}

async function selectedInstallDirectory(): Promise<string> {
  return new Promise((resolve, reject) => {
    ipcMain.on(IPC_CHANNELS.SELECTED_DIRECTORY, (_event, value) => {
      log.info('Directory selected:', value);
      resolve(value);
    });
  });
}

async function handleFirstTimeSetup() {
  const firstTimeSetup = isFirstTimeSetup();
  log.info('First time setup:', firstTimeSetup);
  if (firstTimeSetup) {
    sendRendererMessage(IPC_CHANNELS.SHOW_SELECT_DIRECTORY, null);
    let selectedDirectory = await selectedInstallDirectory();
    if (!isComfyUIDirectory(selectedDirectory)) {
      log.info(
        `Selected directory ${selectedDirectory} is not a ComfyUI directory. Appending ComfyUI to install path.`
      );
      selectedDirectory = path.join(selectedDirectory, 'ComfyUI');
    }

    createComfyDirectories(selectedDirectory);

    const { modelConfigPath } = await determineResourcesPaths();
    await createModelConfigFiles(modelConfigPath, selectedDirectory);
  } else {
    sendRendererMessage(IPC_CHANNELS.FIRST_TIME_SETUP_COMPLETE, null);
  }
}

async function determineResourcesPaths(): Promise<{
  userResourcesPath: string;
  pythonInstallPath: string;
  appResourcesPath: string;
  modelConfigPath: string;
  basePath: string | null;
}> {
  const modelConfigPath = path.join(app.getPath('userData'), 'extra_models_config.yaml');
  const basePath = await readBasePathFromConfig(modelConfigPath);
  const appResourcePath = process.resourcesPath;
  const defaultUserResourcesPath = getDefaultUserResourcesPath();

  if (!app.isPackaged) {
    return {
      // development: install python to in-tree assets dir
      userResourcesPath: path.join(app.getAppPath(), 'assets'),
      pythonInstallPath: path.join(app.getAppPath(), 'assets'),
      appResourcesPath: path.join(app.getAppPath(), 'assets'),
      modelConfigPath,
      basePath,
    };
  }

  // TODO(robinhuang): Look for extra models yaml file and use that as the userResourcesPath if it exists.
  return {
    userResourcesPath: defaultUserResourcesPath,
    pythonInstallPath: basePath ?? defaultUserResourcesPath, // Provide fallback
    appResourcesPath: appResourcePath,
    modelConfigPath,
    basePath,
  };
}

function getDefaultUserResourcesPath(): string {
  return process.platform === 'win32' ? path.join(app.getPath('home'), 'comfyui-electron') : app.getPath('userData');
}

/**
 * For log watching.
 */
function startWebSocketServer() {
  wss = new WebSocketServer({ port: 7999 });

  wss.on('connection', (ws) => {
    const logPath = path.join(app.getPath('logs'), 'comfyui.log');

    // Send the initial content
    const initialStream = createReadStream(logPath, { encoding: 'utf-8' });
    initialStream.on('data', (chunk) => {
      ws.send(chunk);
    });

    let lastSize = 0;
    const watcher = watchFile(logPath, { interval: 1000 }, (curr, prev) => {
      if (curr.size > lastSize) {
        const stream = createReadStream(logPath, {
          start: lastSize,
          encoding: 'utf-8',
        });
        stream.on('data', (chunk) => {
          ws.send(chunk);
        });
        lastSize = curr.size;
      }
    });

    ws.on('close', () => {
      watcher.unref();
    });
  });
}

function closeWebSocketServer() {
  if (wss) {
    wss.close();
    wss = null;
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

/**
 * Install the Electron adapter into the ComfyUI custom_nodes directory.
 * @param appResourcesPath The path to the app resources.
 */
function installElectronAdapter(appResourcesPath: string) {
  const electronAdapterPath = path.join(appResourcesPath, 'ComfyUI_electron_adapter');
  const comfyUIPath = path.join(appResourcesPath, 'ComfyUI');
  const customNodesPath = path.join(comfyUIPath, 'custom_nodes');
  const adapterDestPath = path.join(customNodesPath, 'ComfyUI_electron_adapter');

  try {
    // Ensure the custom_nodes directory exists
    if (!fs.existsSync(customNodesPath)) {
      fs.mkdirSync(customNodesPath, { recursive: true });
    }

    // Remove existing adapter folder if it exists
    if (fs.existsSync(adapterDestPath)) {
      fs.rmSync(adapterDestPath, { recursive: true, force: true });
    }

    // Copy the adapter folder
    fs.cpSync(electronAdapterPath, adapterDestPath, { recursive: true });

    log.info('Electron adapter installed successfully');
  } catch (error) {
    log.error('Failed to install Electron adapter:', error);
  }
}
