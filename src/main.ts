import { spawn, ChildProcess } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import fs from 'fs';
import net from 'node:net';
import path from 'node:path';
import { SetupTray } from './tray';
import { IPC_CHANNELS } from './constants';
import dotenv from 'dotenv';
import { app, BrowserWindow, webContents, screen } from 'electron';
import tar from 'tar';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import('electron-squirrel-startup').then((ess) => {
  const { default: check } = ess;
  if (check) {
    app.quit();
  }
});

let pythonProcess: ChildProcess | null = null;
const host = '127.0.0.1'; // Replace with the desired IP address
const port = 8188; // Replace with the port number your server is running on
let mainWindow: BrowserWindow | null;

const createWindow = async () => {
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
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    console.log('Loading Vite Dev Server');
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

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
};

// Server Heartbeat Listener Variables
let serverHeartBeatReference: NodeJS.Timeout = null;
const serverHeartBeatInterval: number = 15 * 1000; //15 Seconds
async function serverHeartBeat() {
  const isReady = await isPortInUse(host, port);
  if (isReady) {
    // Getting webcontents[0] is not reliable if app started with dev window
    webContents.getAllWebContents()[0].send('python-server-status', 'active');
  } else {
    webContents.getAllWebContents()[0].send('python-server-status', 'false');
  }
}

const isPortInUse = (host: string, port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false);
    });

    server.listen(port, host);
  });
};

// Launch Python Server Variables
const maxFailWait: number = 50 * 1000; // 50seconds
let currentWaitTime = 0;
const spawnServerTimeout: NodeJS.Timeout = null;

const launchPythonServer = async (args: { userResourcesPath: string; appResourcesPath: string }) => {
  const { userResourcesPath, appResourcesPath } = args;

  const isServerRunning = await isPortInUse(host, port);
  if (isServerRunning) {
    console.log('Python server is already running');
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

  console.log('Launching Python server...');

  return new Promise<void>(async (resolve, reject) => {
    const pythonRootPath = path.join(userResourcesPath, 'python');
    const pythonInterpreterPath =
      process.platform === 'win32'
        ? path.join(pythonRootPath, 'python.exe')
        : path.join(pythonRootPath, 'bin', 'python');
    const pythonRecordPath = path.join(pythonRootPath, 'INSTALLER');
    const scriptPath = path.join(appResourcesPath, 'ComfyUI', 'main.py');
    const userDirectoryPath = path.join(app.getPath('userData'), 'user');
    const inputDirectoryPath = path.join(app.getPath('userData'), 'input');
    const outputDirectoryPath = path.join(app.getPath('userData'), 'output');
    const comfyMainCmd = [
      scriptPath,
      '--user-directory',
      userDirectoryPath,
      '--input-directory',
      inputDirectoryPath,
      '--output-directory',
      outputDirectoryPath,
      ...(process.env.COMFYUI_CPU_ONLY === 'true' ? ['--cpu'] : []),
    ];

    const spawnPython = (cmd: string[], cwd: string) => {
      const pythonProcess: ChildProcess = spawn(pythonInterpreterPath, cmd, {
        cwd,
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
      pythonProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });

      return pythonProcess;
    };

    try {
      // check for existence of both interpreter and INSTALLER record to ensure a correctly installed python env
      await Promise.all([fsPromises.access(pythonInterpreterPath), fsPromises.access(pythonRecordPath)]);
      pythonProcess = spawnPython(comfyMainCmd, path.dirname(scriptPath));
    } catch {
      console.log('Running one-time python installation on first startup...');

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

      const wheelsPath = path.join(pythonRootPath, 'wheels');
      // TODO: report space bug to uv upstream, then revert below mac fix
      const rehydrateCmd = [
        '-m',
        ...(process.platform !== 'darwin' ? ['uv'] : []),
        'pip',
        'install',
        '--no-index',
        '--no-deps',
        ...(await fsPromises.readdir(wheelsPath)).map((x) => path.join(wheelsPath, x)),
      ];
      const rehydrateProc = spawn(pythonInterpreterPath, rehydrateCmd, {
        cwd: wheelsPath,
      });

      rehydrateProc.on('exit', (code) => {
        if (code === 0) {
          // write an INSTALLER record on sucessful completion of rehydration
          fsPromises.writeFile(pythonRecordPath, 'ComfyUI');

          // remove the now installed wheels
          fsPromises.rm(wheelsPath, { recursive: true });
          console.log(`Python successfully installed to ${pythonRootPath}`);

          pythonProcess = spawnPython(comfyMainCmd, path.dirname(scriptPath));
        } else {
          console.log(`Rehydration of python bundle exited with code ${code}`);
        }
      });
    }

    const checkInterval = 1000; // Check every 1 second

    const checkServerReady = async () => {
      currentWaitTime += 1000;
      if (currentWaitTime > maxFailWait) {
        //Something has gone wrong and we need to backout.
        clearTimeout(spawnServerTimeout);
        reject('Python Server Failed To Start');
      }
      const isReady = await isPortInUse(host, port);
      if (isReady) {
        sendProgressUpdate(90, 'Finishing...');
        console.log('Python server is ready');
        // Start the Heartbeat listener, send connected message to Renderer and resolve promise.
        serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
        webContents.getAllWebContents()[0].send('python-server-status', 'active');
        //For now just replace the source of the main window to the python server
        setTimeout(() => webContents.getAllWebContents()[0].loadURL('http://localhost:8188/'), 1000);
        clearTimeout(spawnServerTimeout);
        resolve();
      } else {
        console.log('Ping failed. Retrying...');
        setTimeout(checkServerReady, checkInterval);
      }
    };

    checkServerReady();
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  const { userResourcesPath, appResourcesPath } = app.isPackaged
    ? {
        // production: install python to per-user application data dir
        userResourcesPath: app.getPath('userData'),
        appResourcesPath: process.resourcesPath,
      }
    : {
        // development: install python to in-tree assets dir
        userResourcesPath: path.join(app.getAppPath(), 'assets'),
        appResourcesPath: path.join(app.getAppPath(), 'assets'),
      };
  console.log(`userResourcesPath: ${userResourcesPath}`);
  console.log(`appResourcesPath: ${appResourcesPath}`);

  try {
    dotenv.config({ path: path.join(appResourcesPath, 'ComfyUI', '.env') });
  } catch {
    // if no .env file, skip it
  }

  try {
    await fsPromises.mkdir(userResourcesPath);
  } catch {
    // if user-specific resources dir already exists, that is fine
  }
  try {
    await createWindow();
    sendProgressUpdate(20, 'Setting up comfy environment...');
    createComfyDirectories();
    setTimeout(() => sendProgressUpdate(40, 'Starting Comfy Server...'), 1000);
    await launchPythonServer({ userResourcesPath, appResourcesPath });
  } catch (error) {
    console.error(error);
    sendProgressUpdate(0, 'Failed to start Comfy Server');
  }
});

function sendProgressUpdate(percentage: number, status: string) {
  if (mainWindow) {
    console.log('Sending progress update to renderer ' + status);
    mainWindow.webContents.send(IPC_CHANNELS.LOADING_PROGRESS, {
      percentage,
      status,
    });
  }
}

const killPythonServer = () => {
  console.log('Python server:', pythonProcess);
  return new Promise<void>((resolve, reject) => {
    if (pythonProcess) {
      try {
        const result: boolean = pythonProcess.kill(); //false if kill did not succeed sucessfully
        result ? resolve() : reject();
      } catch (error) {
        console.error(error);
        reject(error);
      }
    } else {
      resolve();
    }
  });
};

type DirectoryStructure = (string | [string, string[]])[];

// Create directories needed by ComfyUI in the user's data directory.
function createComfyDirectories(): void {
  const userDataPath: string = app.getPath('userData');
  const directories: DirectoryStructure = [
    'custom_nodes',
    'input',
    'output',
    'user',
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

  function createDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
    } else {
      console.log(`Directory already exists: ${dirPath}`);
    }
  }

  directories.forEach((dir: string | [string, string[]]) => {
    if (Array.isArray(dir)) {
      const [mainDir, subDirs] = dir;
      const mainDirPath: string = path.join(userDataPath, mainDir);
      createDir(mainDirPath);
      subDirs.forEach((subDir: string) => {
        const subDirPath: string = path.join(mainDirPath, subDir);
        createDir(subDirPath);
      });
    } else {
      const dirPath: string = path.join(userDataPath, dir);
      createDir(dirPath);
    }
  });
}

app.on('before-quit', async () => {
  try {
    await killPythonServer();
  } catch (error) {
    // Server did NOT exit properly
    app.exit();
  }
  app.exit();
});

app.on('quit', () => {
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
