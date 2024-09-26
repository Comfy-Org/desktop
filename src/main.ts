import { spawn, ChildProcess } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import fs from 'fs';
import axios from 'axios';
import path from 'node:path';
import { SetupTray } from './tray';
import { IPC_CHANNELS, SENTRY_URL_ENDPOINT } from './constants';
import dotenv from 'dotenv';
import { app, BrowserWindow, webContents, screen, ipcMain, crashReporter } from 'electron';
import tar from 'tar';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';

import { updateElectronApp, UpdateSourceType } from 'update-electron-app';

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

app.isPackaged &&
  Sentry.init({
    dsn: SENTRY_URL_ENDPOINT,
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

function readLogMain() {
  return log.transports.file.readAllLogs()[0].lines.slice(-100).join('\n');
}

app.on('ready', () => {
  log.info('App is Ready');
});

let pythonProcess: ChildProcess | null = null;
const host = '127.0.0.1'; // Replace with the desired IP address
const port = 8188; // Replace with the port number your server is running on
let mainWindow: BrowserWindow | null;
const messageQueue: Array<any> = []; // Stores mesaages before renderer is ready.

export const createWindow = async (): Promise<BrowserWindow> => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
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

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    log.info('Loading Vite Dev Server');
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  ipcMain.on(IPC_CHANNELS.RENDERER_READY, () => {
    log.info('Received renderer-ready message!');
    // Send all queued messages
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      log.info('Sending queued message ', message.channel);
      mainWindow.webContents.send(message.channel, message.data);
    }
  });

  // Set up the System Tray Icon for all platforms
  // Returns a tray so you can set a global var to access.
  SetupTray(mainWindow);

  // Overrides the behavior of closing the window to allow for
  // the python server to continue to run in the background
  mainWindow.on('close', (e: Electron.Event) => {
    e.preventDefault();
    mainWindow.hide();
    // Mac Only Behavior
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });
  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
  return mainWindow;
};

// Server Heartbeat Listener Variables
let serverHeartBeatReference: NodeJS.Timeout = null;
const serverHeartBeatInterval: number = 15 * 1000; //15 Seconds
async function serverHeartBeat() {
  const isReady = await isComfyServerReady(host, port);
  if (isReady) {
    // Getting webcontents[0] is not reliable if app started with dev window
    webContents.getAllWebContents()[0].send('python-server-status', 'active');
  } else {
    webContents.getAllWebContents()[0].send('python-server-status', 'false');
  }
}

const isComfyServerReady = async (host: string, port: number): Promise<boolean> => {
  const url = `http://${host}:${port}/queue`;

  try {
    log.info(`Checking if server is running at ${url}`);
    const response = await axios.get(url, {
      timeout: 5000, // 5 seconds timeout
    });

    if (response.status >= 200 && response.status < 300) {
      log.info(`Server is running at ${url}`);
      log.info(response.data);
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
const maxFailWait: number = 60 * 1000; // 60seconds
let currentWaitTime = 0;
let spawnServerTimeout: NodeJS.Timeout = null;

const launchPythonServer = async (
  pythonInterpreterPath: string,
  appResourcesPath: string,
  userResourcesPath: string
) => {
  const isServerRunning = await isComfyServerReady(host, port);
  if (isServerRunning) {
    log.info('Python server is already running');
    // Server has been started outside the app, so attach to it.
    setTimeout(() => {
      // Not sure if needed but wait a few moments before sending the connect message up.
      webContents.getAllWebContents()[0].send('python-server-status', 'active');
    }, 5000);
    clearInterval(serverHeartBeatReference);
    webContents.getAllWebContents()[0].loadURL('http://localhost:8188/');
    serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
    return Promise.resolve();
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
    ];

    pythonProcess = spawnPython(pythonInterpreterPath, comfyMainCmd, path.dirname(scriptPath), {
      logFile: 'comfyui',
      stdx: true,
    });

    const checkInterval = 1000; // Check every 1 second

    const checkServerReady = async () => {
      currentWaitTime += 1000;
      if (currentWaitTime > maxFailWait) {
        //Something has gone wrong and we need to backout.
        clearTimeout(spawnServerTimeout);
        reject('Python Server Failed To Start');
      }
      const isReady = await isComfyServerReady(host, port);
      if (isReady) {
        sendProgressUpdate(90, 'Finishing...');
        log.info('Python server is ready');
        // Start the Heartbeat listener, send connected message to Renderer and resolve promise.
        serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
        webContents.getAllWebContents()[0].send('python-server-status', 'active');
        //For now just replace the source of the main window to the python server
        setTimeout(() => webContents.getAllWebContents()[0].loadURL('http://localhost:8188/'), 1000);
        clearTimeout(spawnServerTimeout);
        resolve();
      } else {
        log.info('Ping failed. Retrying...');
        spawnServerTimeout = setTimeout(checkServerReady, checkInterval);
      }
    };

    checkServerReady();
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const windowsLocalAppData = path.join(app.getPath('home'), 'ComfyUI');
log.info('Windows Local App Data directory: ', windowsLocalAppData);
app.on('ready', async () => {
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
  log.info(`userResourcesPath: ${userResourcesPath}`);
  log.info(`appResourcesPath: ${appResourcesPath}`);

  try {
    dotenv.config({ path: path.join(appResourcesPath, 'ComfyUI', '.env') });
  } catch {
    // if no .env file, skip it
  }

  createDirIfNotExists(userResourcesPath);

  try {
    sendProgressUpdate(10, 'Creating menu...');
    await createWindow();

    sendProgressUpdate(20, 'Setting up comfy environment...');
    createComfyDirectories(userResourcesPath);
    const pythonRootPath = path.join(userResourcesPath, 'python');
    const pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(pythonRootPath, 'python.exe')
        : path.join(pythonRootPath, 'bin', 'python');
    sendProgressUpdate(40, 'Setting up Python Environment...');
    await setupPythonEnvironment(pythonInterpreterPath, appResourcesPath, userResourcesPath);
    sendProgressUpdate(50, 'Starting Comfy Server...');
    await launchPythonServer(pythonInterpreterPath, appResourcesPath, userResourcesPath);
  } catch (error) {
    log.error(error);
    sendProgressUpdate(0, error.message);
  }
});

function sendProgressUpdate(percentage: number, status: string): void {
  if (mainWindow) {
    log.info('Sending progress update to renderer ' + status);

    if (!mainWindow.webContents || mainWindow.webContents.isLoading()) {
      log.info('Queueing message since renderer is not ready yet.');
      messageQueue.push({
        channel: IPC_CHANNELS.LOADING_PROGRESS,
        data: {
          percentage,
          status,
        },
      });
      return;
    }
    mainWindow.webContents.send(IPC_CHANNELS.LOADING_PROGRESS, {
      percentage,
      status,
    });
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
  if (process.platform !== 'darwin') {
    //app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

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
    });
    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      pythonLog.info(`stdout: ${message}`);
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
        stderr += data.toString();
        log.error(`stderr: ${data}`);
      });
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        log.info(`stdout: ${data}`);
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
