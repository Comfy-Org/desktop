import { spawn, ChildProcess } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import fs from 'fs';
import axios from 'axios';
import path from 'node:path';
import { SetupTray } from './tray';
import { IPC_CHANNELS, SENTRY_URL_ENDPOINT } from './constants';
import dotenv from 'dotenv';
import { app, BrowserWindow, screen, ipcMain, Menu, MenuItem } from 'electron';
import tar from 'tar';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';

import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import * as net from 'net';

updateElectronApp({
  updateSource: {
    type: UpdateSourceType.StaticStorage,
    baseUrl: `https://updater.comfy.org/${process.platform}/${process.arch}`,
  },
  logger: log,
  updateInterval: '2 hours',
});

log.initialize();
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import('electron-squirrel-startup').then((ess) => {
  const { default: check } = ess;
  if (check) {
    app.quit();
  }
});

const gotTheLock = app.requestSingleInstanceLock();
const windowsLocalAppData = path.join(app.getPath('home'), 'comfyui-electron');
log.info('Windows Local App Data directory: ', windowsLocalAppData);

if (!gotTheLock) {
  app.quit();
} else {
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

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  app.on('ready', async () => {
    log.info('App ready');

    app.on('activate', () => {
      // On OS X it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        const { userResourcesPath } = getResourcesPaths();
        createWindow(userResourcesPath);
      }
    });

    const { userResourcesPath, appResourcesPath } = getResourcesPaths();
    log.info(`userResourcesPath: ${userResourcesPath}`);
    log.info(`appResourcesPath: ${appResourcesPath}`);

    try {
      dotenv.config({ path: path.join(appResourcesPath, 'ComfyUI', '.env') });
    } catch {
      // if no .env file, skip it
    }

    createDirIfNotExists(userResourcesPath);

    try {
      await createWindow(userResourcesPath);
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
      port = await findAvailablePort(8000, 9999).catch((err) => {
        log.error(`ERROR: Failed to find available port: ${err}`);
        throw err;
      });
      sendProgressUpdate('Setting up comfy environment...');
      createComfyDirectories(userResourcesPath);
      const pythonRootPath = path.join(userResourcesPath, 'python');
      const pythonInterpreterPath =
        process.platform === 'win32'
          ? path.join(pythonRootPath, 'python.exe')
          : path.join(pythonRootPath, 'bin', 'python');
      sendProgressUpdate('Setting up Python Environment...');
      await setupPythonEnvironment(pythonInterpreterPath, appResourcesPath, userResourcesPath);
      sendProgressUpdate('Starting Comfy Server...');
      await launchPythonServer(pythonInterpreterPath, appResourcesPath, userResourcesPath);
    } catch (error) {
      log.error(error);
      sendProgressUpdate(
        'Was not able to start ComfyUI. Please check the logs for more details. You can open it from the tray icon.'
      );
    }

    ipcMain.on(IPC_CHANNELS.RESTART_APP, () => {
      log.info('Received restart app message!');
      restartApp();
    });
  });

  app.on('before-quit', () => {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  });

  app.on('before-quit', () => {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  });

  app.on('before-quit', async () => {
    try {
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

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    log.info('Window all closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
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
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

function restartApp() {
  log.info('Restarting app');
  app.relaunch();
  app.quit();
}

let pythonProcess: ChildProcess | null = null;
const host = '127.0.0.1';
let port = 8188;
let mainWindow: BrowserWindow | null;
const messageQueue: Array<any> = []; // Stores mesaages before renderer is ready.

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
export const createWindow = async (userResourcesPath: string): Promise<BrowserWindow> => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  if (mainWindow) {
    log.info('Main window already exists');
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    title: 'ComfyUI',
    width: width,
    height: height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, // Enable Node.js integration
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  await loadRendererIntoMainWindow();

  // Set up the System Tray Icon for all platforms
  // Returns a tray so you can set a global var to access.
  SetupTray(mainWindow, userResourcesPath);

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
  userResourcesPath: string
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
    const userDirectoryPath = path.join(userResourcesPath, 'user');
    const inputDirectoryPath = path.join(userResourcesPath, 'input');
    const outputDirectoryPath = path.join(userResourcesPath, 'output');
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
      '--port',
      port.toString(),
    ];

    log.info(`Starting ComfyUI using port ${port}.`);

    pythonProcess = spawnPython(pythonInterpreterPath, comfyMainCmd, path.dirname(scriptPath), {
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
        sendProgressUpdate('Finishing...');
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

function getResourcesPaths() {
  const { userResourcesPath, appResourcesPath } = app.isPackaged
    ? {
        // production: install python to per-user application data dir
        userResourcesPath: process.platform === 'win32' ? windowsLocalAppData : app.getPath('userData'),
        appResourcesPath: process.resourcesPath,
      }
    : {
        // development: install python to in-tree assets dir
        userResourcesPath: path.join(app.getAppPath(), 'assets'),
        appResourcesPath: path.join(app.getAppPath(), 'assets'),
      };

  return { userResourcesPath, appResourcesPath };
}

/**  Interval to send progress updates to the renderer. */
let progressInterval: NodeJS.Timeout | null = null;

function sendProgressUpdate(status: string): void {
  if (mainWindow) {
    log.info('Sending progress update to renderer ' + status);

    const sendUpdate = (status: string) => {
      const newMessage = {
        channel: IPC_CHANNELS.LOADING_PROGRESS,
        data: {
          status,
        },
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
    sendUpdate(status);
  }
}

const killPythonServer = async (): Promise<void> => {
  if (pythonProcess) {
    log.info('Killing python server.');

    return new Promise<void>((resolve, reject) => {
      // Set up a timeout in case the process doesn't exit
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: Python server did not exit within 10 seconds'));
      }, 10000);

      // Listen for the 'exit' event
      pythonProcess.once('exit', (code, signal) => {
        clearTimeout(timeout);
        log.info(`Python server exited with code ${code} and signal ${signal}`);
        pythonProcess = null;
        resolve();
      });

      // Attempt to kill the process
      const result = pythonProcess.kill();
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
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    log.info(`Spawning python process with command: ${cmd.join(' ')} in directory: ${cwd}`);
    const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, { cwd });

    let stdout = '';
    let stderr = '';

    if (options.stdx) {
      log.info('Setting up python process stdout/stderr listeners');
      pythonProcess.stderr.on('data', (data) => {
        const message = data.toString();
        stderr += message;
        log.error(message);
        if (mainWindow) {
          log.info(`Sending log message to renderer: ${message}`);
          mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
      pythonProcess.stdout.on('data', (data) => {
        const message = data.toString();
        stdout += message;
        log.info(message);
        if (mainWindow) {
          log.info(`Sending log message to renderer: ${message}`);
          mainWindow.webContents.send(IPC_CHANNELS.LOG_MESSAGE, message);
        }
      });
    }
    pythonProcess.on('close', (code) => {
      log.info(`Python process exited with code ${code}`);
      resolve({ exitCode: code, stdout, stderr });
    });

    pythonProcess.on('error', (err) => {
      log.error(`Failed to start Python process: ${err}`);
      reject(err);
    });

    process.on('exit', () => {
      log.warn('Parent process exiting, killing Python process');
      pythonProcess.kill();
    });
  });
};

async function setupPythonEnvironment(
  pythonInterpreterPath: string,
  appResourcesPath: string,
  userResourcesPath: string
) {
  const pythonRootPath = path.join(userResourcesPath, 'python');
  const pythonRecordPath = path.join(pythonRootPath, 'INSTALLER');
  try {
    // check for existence of both interpreter and INSTALLER record to ensure a correctly installed python env
    await Promise.all([fsPromises.access(pythonInterpreterPath), fsPromises.access(pythonRecordPath)]);
  } catch {
    log.info('Running one-time python installation on first startup...');

    try {
      // clean up any possible existing non-functional python env
      await fsPromises.rm(pythonRootPath, { recursive: true });
    } catch {
      null;
    }

    const pythonTarPath = path.join(appResourcesPath, 'python.tgz');
    await tar.extract({
      file: pythonTarPath,
      cwd: userResourcesPath,
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
        '--verbose',
        ...(await fsPromises.readdir(wheelsPath)).map((x) => path.join(wheelsPath, x)),
      ];
    } else {
      const reqPath = path.join(pythonRootPath, 'requirements.compiled');
      rehydrateCmd = [
        '-m',
        'uv',
        'pip',
        'install',
        '-r',
        reqPath,
        '--index-strategy',
        'unsafe-best-match',
        '--verbose',
      ];
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
}

type DirectoryStructure = (string | [string, string[]])[];

// Create directories needed by ComfyUI in the user's data directory.
function createComfyDirectories(localComfyDirectory: string): void {
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
