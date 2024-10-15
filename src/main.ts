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
import { app, BrowserWindow, dialog, screen, ipcMain, Menu, MenuItem } from 'electron';
import tar from 'tar';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import Store from 'electron-store';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import * as net from 'net';
import { graphics } from 'systeminformation';
import { createModelConfigFiles, readBasePathFromConfig } from './config/extra_model_config';

let comfyServerProcess: ChildProcess | null = null;
const host = '127.0.0.1';
let port = 8188;
let mainWindow: BrowserWindow | null;
let store: Store<StoreType> | null;
const messageQueue: Array<any> = []; // Stores mesaages before renderer is ready.

import { StoreType } from './store';
log.initialize();

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

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Run this as early in the main process as possible.
if (require('electron-squirrel-startup')) {
  log.info('App already being set up by squirrel. Exiting...');
  app.quit();
} else {
  log.info('Normal startup');
}

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
          mainWindow.webContents.send(message.channel, message.data);
        }
      });
      ipcMain.handle(IPC_CHANNELS.OPEN_DIALOG, (event, options: Electron.OpenDialogOptions) => {
        log.info('Open dialog');
        return dialog.showOpenDialogSync({
          ...options,
          defaultPath: getDefaultUserResourcesPath(),
        });
      });
      await handleFirstTimeSetup();
      const { userResourcesPath, appResourcesPath, pythonInstallPath, modelConfigPath, basePath } =
        await determineResourcesPaths();
      SetupTray(mainWindow, userResourcesPath);
      port = await findAvailablePort(8000, 9999).catch((err) => {
        log.error(`ERROR: Failed to find available port: ${err}`);
        throw err;
      });

      sendProgressUpdate('Setting up Python Environment...');
      const pythonInterpreterPath = await setupPythonEnvironment(appResourcesPath, pythonInstallPath);
      sendProgressUpdate('Starting Comfy Server...');
      await launchPythonServer(pythonInterpreterPath, appResourcesPath, modelConfigPath, basePath);
      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.StaticStorage,
          baseUrl: `https://updater.comfy.org/${process.platform}/${process.arch}`,
        },
        logger: log,
        updateInterval: '2 hours',
      });
    } catch (error) {
      log.error(error);
      sendProgressUpdate(COMFY_ERROR_MESSAGE);
    }

    ipcMain.on(IPC_CHANNELS.RESTART_APP, () => {
      log.info('Received restart app message!');
      restartApp();
    });
  });
}

function loadComfyIntoMainWindow() {
  if (!mainWindow) {
    log.error('Trying to load ComfyUI into main window but it is not ready yet.');
    return;
  }
  mainWindow.loadURL(`http://${host}:${port}`);
}

async function loadRendererIntoMainWindow(): Promise<void> {
  if (!mainWindow) {
    log.error('Trying to load renderer into main window but it is not ready yet.');
    return;
  }
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    log.info('Loading Vite Dev Server');
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    log.info('Opened Vite Dev Server');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

function restartApp() {
  log.info('Restarting app');
  app.relaunch();
  app.quit();
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const menu = new Menu();

  if (isMac) {
    menu.append(
      new MenuItem({
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      })
    );
  }

  if (!isMac) {
    menu.append(
      new MenuItem({
        label: 'File',
        submenu: [{ role: 'quit' }],
      })
    );
  }

  return menu;
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
  const storedWidth = store.get('windowWidth', width);
  const storedHeight = store.get('windowHeight', height);
  const storedX = store.get('windowX');
  const storedY = store.get('windowY');

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
    },
    autoHideMenuBar: true,
  });
  log.info('Loading renderer into main window');
  await loadRendererIntoMainWindow();
  log.info('Renderer loaded into main window');

  // Set up the System Tray Icon for all platforms
  // Returns a tray so you can set a global var to access.
  if (userResourcesPath) {
    SetupTray(mainWindow, userResourcesPath);
  }

  const updateBounds = () => {
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
      mainWindow.hide();
      app.dock.hide();
    }
    mainWindow = null;
  });

  const menu = buildMenu();
  Menu.setApplicationMenu(menu);

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
let spawnServerTimeout: NodeJS.Timeout = null;

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

  log.info('Launching Python server...');

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
        clearTimeout(spawnServerTimeout);
        reject('Python Server Failed To Start');
      }
      const isReady = await isComfyServerReady(host, port);
      if (isReady) {
        sendProgressUpdate(COMFY_FINISHING_MESSAGE);
        log.info('Python server is ready');

        //For now just replace the source of the main window to the python server
        setTimeout(() => loadComfyIntoMainWindow(), 1000);
        clearTimeout(spawnServerTimeout);
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
  if (!mainWindow.webContents || mainWindow.webContents.isLoading()) {
    log.info('Queueing message since renderer is not ready yet.');
    messageQueue.push(newMessage);
    return;
  }

  if (messageQueue.length > 0) {
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      log.info('Sending queued message ', message.channel, message.data);
      mainWindow.webContents.send(message.channel, message.data);
    }
  }
  mainWindow.webContents.send(newMessage.channel, newMessage.data);
};

const killPythonServer = async (): Promise<void> => {
  if (comfyServerProcess) {
    log.info('Killing ComfyUI python server.');

    return new Promise<void>((resolve, reject) => {
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
  }
};

const spawnPython = (
  pythonInterpreterPath: string,
  cmd: string[],
  cwd: string,
  options = { stdx: true, logFile: '' }
) => {
  log.info(`Spawning python process with command: ${cmd.join(' ')} in directory: ${cwd}`);
  const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, {
    cwd,
  });

  if (options.stdx) {
    log.info('Setting up python process stdout/stderr listeners');

    let pythonLog = log;
    if (options.logFile) {
      log.info('Creating separate python log file: ', options.logFile);
      pythonLog = log.create({ logId: options.logFile });
      pythonLog.transports.file.fileName = `${options.logFile}.log`;
      pythonLog.transports.file.resolvePathFn = (variables) => {
        return path.join(variables.electronDefaultDir, variables.fileName);
      };
    }

    pythonProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      pythonLog.error(`stderr: ${message}`);
      if (mainWindow) {
        log.info(`Sending log message to renderer: ${message}`);
        mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
      }
    });
    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      pythonLog.info(`stdout: ${message}`);
      if (mainWindow) {
        log.info(`Sending log message to renderer: ${message}`);
        mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
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
    log.info(`Spawning python process with command: ${cmd.join(' ')} in directory: ${cwd}`);
    const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, { cwd });

    const cleanup = () => {
      pythonProcess.removeAllListeners();
    };

    if (options.stdx) {
      log.info('Setting up python process stdout/stderr listeners');
      pythonProcess.stderr.on('data', (data) => {
        const message = data.toString();
        log.error(message);
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
      pythonProcess.stdout.on('data', (data) => {
        const message = data.toString();
        log.info(message);
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
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

async function setupPythonEnvironment(appResourcesPath: string, pythonResourcesPath: string) {
  const pythonRootPath = path.join(pythonResourcesPath, 'python');
  const pythonInterpreterPath =
    process.platform === 'win32' ? path.join(pythonRootPath, 'python.exe') : path.join(pythonRootPath, 'bin', 'python');
  const pythonRecordPath = path.join(pythonInterpreterPath, 'INSTALLER');
  try {
    // check for existence of both interpreter and INSTALLER record to ensure a correctly installed python env
    log.info(
      `Checking for existence of python interpreter at ${pythonInterpreterPath} and INSTALLER record at ${pythonRecordPath}`
    );
    await Promise.all([fsPromises.access(pythonInterpreterPath), fsPromises.access(pythonRecordPath)]);
  } catch {
    log.info(`Running one-time python installation on first startup at ${pythonResourcesPath} and ${pythonRootPath}`);

    try {
      // clean up any possible existing non-functional python env
      await fsPromises.rm(pythonRootPath, { recursive: true });
    } catch {
      null;
    }

    const pythonTarPath = path.join(appResourcesPath, 'python.tgz');
    log.info(`Extracting python bundle from ${pythonTarPath} to ${pythonResourcesPath}`);
    await tar.extract({
      file: pythonTarPath,
      cwd: pythonResourcesPath,
      strict: true,
    });

    // install python pkgs from wheels if packed in bundle, otherwise just use requirements.compiled
    const wheelsPath = path.join(pythonRootPath, 'wheels');
    let packWheels;
    try {
      await fsPromises.access(wheelsPath);
      packWheels = true;
    } catch {
      packWheels = false;
    }

    let rehydrateCmd;
    if (packWheels) {
      // TODO: report space bug to uv upstream, then revert below mac fix
      rehydrateCmd = [
        '-m',
        ...(process.platform !== 'darwin' ? ['uv'] : []),
        'pip',
        'install',
        '--no-index',
        '--no-deps',
        ...(await fsPromises.readdir(wheelsPath)).map((x) => path.join(wheelsPath, x)),
      ];
    } else {
      const reqPath = path.join(pythonRootPath, 'requirements.compiled');
      rehydrateCmd = ['-m', 'uv', 'pip', 'install', '-r', reqPath, '--index-strategy', 'unsafe-best-match'];
    }

    //TODO(robinhuang): remove this once uv is included in the python bundle.
    const { exitCode: uvExitCode } = await spawnPythonAsync(
      pythonInterpreterPath,
      ['-m', 'pip', 'install', '--upgrade', 'uv'],
      pythonRootPath,
      { stdx: true }
    );

    if (uvExitCode !== 0) {
      log.error('Failed to install uv');
      throw new Error('Failed to install uv');
    }

    const { exitCode } = await spawnPythonAsync(pythonInterpreterPath, rehydrateCmd, pythonRootPath, { stdx: true });

    if (exitCode === 0) {
      // write an INSTALLER record on sucessful completion of rehydration
      fsPromises.writeFile(pythonRecordPath, 'ComfyUI');

      if (packWheels) {
        // remove the now installed wheels
        fsPromises.rm(wheelsPath, { recursive: true });
      }

      log.info(`Python successfully installed to ${pythonRootPath}`);
    } else {
      log.info(`Rehydration of python bundle exited with code ${exitCode}`);
      throw new Error('Python rehydration failed');
    }
  }
  return pythonInterpreterPath;
}

type DirectoryStructure = (string | [string, string[]])[];

// Create directories needed by ComfyUI in the user's data directory.
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
      ],
    ],
  ];
  createDirIfNotExists(localComfyDirectory);

  directories.forEach((dir: string | [string, string[]]) => {
    if (Array.isArray(dir)) {
      const [mainDir, subDirs] = dir;
      const mainDirPath: string = path.join(localComfyDirectory, mainDir);
      createDirIfNotExists(mainDirPath);
      subDirs.forEach((subDir: string) => {
        const subDirPath: string = path.join(mainDirPath, subDir);
        createDirIfNotExists(subDirPath);
      });
    } else {
      const dirPath: string = path.join(localComfyDirectory, dir);
      createDirIfNotExists(dirPath);
    }
  });

  const userSettingsPath = path.join(localComfyDirectory, 'user', 'default');
  createComfyConfigFile(userSettingsPath);
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

async function createComfyConfigFile(userSettingsPath: string): Promise<void> {
  const configContent: any = {
    'Comfy.ColorPalette': 'dark',
    'Comfy.NodeLibrary.Bookmarks': [],
    'Comfy.UseNewMenu': 'Floating',
    'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
    'Comfy.Workflow.ShowMissingModelsWarning': true,
  };

  const configFilePath = path.join(userSettingsPath, 'comfy.settings.json');

  if (fs.existsSync(configFilePath)) {
    return;
  }

  try {
    await fsPromises.writeFile(configFilePath, JSON.stringify(configContent, null, 2));
    log.info(`Created ComfyUI config file at: ${configFilePath}`);
  } catch (error) {
    log.error(`Failed to create ComfyUI config file: ${error}`);
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
    const selectedDirectory = await selectedInstallDirectory();
    createComfyDirectories(selectedDirectory);

    const { modelConfigPath } = await determineResourcesPaths();
    createModelConfigFiles(modelConfigPath, selectedDirectory);
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
  if (!app.isPackaged) {
    return {
      // development: install python to in-tree assets dir
      userResourcesPath: path.join(app.getAppPath(), 'assets'),
      pythonInstallPath: path.join(app.getAppPath(), 'assets'),
      appResourcesPath: path.join(app.getAppPath(), 'assets'),
      modelConfigPath: modelConfigPath,
      basePath: basePath,
    };
  }

  const defaultUserResourcesPath = getDefaultUserResourcesPath();
  const defaultPythonInstallPath =
    process.platform === 'win32'
      ? path.join(path.dirname(path.dirname(app.getPath('userData'))), 'Local', 'comfyui_electron')
      : app.getPath('userData');

  const appResourcePath = process.resourcesPath;

  // TODO(robinhuang): Look for extra models yaml file and use that as the userResourcesPath if it exists.
  return {
    userResourcesPath: defaultUserResourcesPath,
    pythonInstallPath: defaultPythonInstallPath,
    appResourcesPath: appResourcePath,
    modelConfigPath: modelConfigPath,
    basePath: basePath,
  };
}

function getDefaultUserResourcesPath(): string {
  return process.platform === 'win32' ? path.join(app.getPath('home'), 'comfyui-electron') : app.getPath('userData');
}

function dev_getDefaultModelConfigPath(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(app.getAppPath(), 'config', 'model_paths_windows.yaml');
    case 'darwin':
      return path.join(app.getAppPath(), 'config', 'model_paths_mac.yaml');
    default:
      return path.join(app.getAppPath(), 'config', 'model_paths_linux.yaml');
  }
}
