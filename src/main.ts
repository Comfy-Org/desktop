import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { SetupTray } from './tray';

import dotenv from "dotenv";
import { app, BrowserWindow, webContents } from 'electron';
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import('electron-squirrel-startup').then(ess => {
  const {default: check} = ess;
  if (check) {
    app.quit();
  }
});
import tar from 'tar';

let pythonProcess: ChildProcess | null = null;
const host = '127.0.0.1'; // Replace with the desired IP address
const port = 8188; // Replace with the port number your server is running on
const scriptPath = path.join(process.resourcesPath, 'ComfyUI', 'main.py');

const packagedComfyUIExecutable = process.platform == 'win32' ? 'run_cpu.bat' : process.platform == 'darwin' ? 'ComfyUI' : 'ComfyUI';

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'ComfyUI',
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, // Enable Node.js integration
      contextIsolation: false,
    },

  });

  // Load the UI from the Python server's URL
  //mainWindow.loadURL('http://localhost:8188/');
  mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));

  SetupTray(mainWindow);

  mainWindow.on('close' , (e) => {
    e.preventDefault();
    mainWindow.hide();
  })
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
    webContents.getAllWebContents()[0].send("python-server-status", "active");
  } else {
    webContents.getAllWebContents()[0].send("python-server-status", "false");
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
const maxFailWait: number = 10 * 2000; // 10seconds
let currentWaitTime: number = 0;
let spawnServerTimeout: NodeJS.Timeout = null;

const launchPythonServer = async (args: {userResourcesPath: string, appResourcesPath: string}) => {
  const {userResourcesPath, appResourcesPath} = args;

  const isServerRunning = await isPortInUse(host, port);
  if (isServerRunning) {
    console.log('Python server is already running');
    // Server has been started outside the app, so attach to it.
    setTimeout(() => {
      // Not sure if needed but wait a few moments before sending the connect message up. 
      webContents.getAllWebContents()[0].send("python-server-status", "active");
    }, 5000);
    clearInterval(serverHeartBeatReference);
    webContents.getAllWebContents()[0].loadURL('http://localhost:8188/');
    serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
    return Promise.resolve();
  }

  console.log('Launching Python server...');

  return new Promise<void>(async (resolve, reject) => {
    const pythonRootPath = path.join(userResourcesPath, 'python');
    const pythonInterpreterPath = process.platform==='win32' ? path.join(pythonRootPath, 'python.exe') : path.join(pythonRootPath, 'bin', 'python');
    const pythonRecordPath = path.join(pythonRootPath, "INSTALLER");
    const scriptPath = path.join(appResourcesPath, 'ComfyUI', 'main.py');
    const comfyMainCmd = [scriptPath, ...(process.env.COMFYUI_CPU_ONLY === "true" ? ["--cpu"] : [])];

    const spawnPython = async () => {
      pythonProcess = spawn(pythonInterpreterPath, comfyMainCmd, {
        cwd: path.dirname(scriptPath)
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
      pythonProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });
    }

    try {
      // check for existence of both interpreter and INSTALLER record to ensure a correctly installed python env
      await Promise.all([fs.access(pythonInterpreterPath), fs.access(pythonRecordPath)]);
      spawnPython();
    } catch {
      console.log('Running one-time python installation on first startup...');
      // clean up any possible existing non-functional python env
      try {
        await fs.rm(pythonRootPath, {recursive: true});
      } catch {null;}

      const pythonTarPath = path.join(appResourcesPath, 'python.tgz');
      await tar.extract({file: pythonTarPath, cwd: userResourcesPath, strict: true});

      const wheelsPath = path.join(pythonRootPath, 'wheels');
      const rehydrateCmd = ['-m', 'uv', 'pip', 'install', '--no-index', '--no-deps', ...(await fs.readdir(wheelsPath)).map(x => path.join(wheelsPath, x))];
      const rehydrateProc = spawn(pythonInterpreterPath, rehydrateCmd, {cwd: wheelsPath});

      rehydrateProc.on("exit", code => {
        // write an INSTALLER record on sucessful completion of rehydration
        fs.writeFile(pythonRecordPath, "ComfyUI");

        if (code===0) {
          // remove the now installed wheels
          fs.rm(wheelsPath, {recursive: true});
          console.log(`Python successfully installed to ${pythonRootPath}`);

          spawnPython();
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
        reject("Python Server Failed To Start");
      }
      const isReady = await isPortInUse(host, port);
      if (isReady) {
        console.log('Python server is ready');
        // Start the Heartbeat listener, send connected message to Renderer and resolve promise. 
        serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
        webContents.getAllWebContents()[0].send("python-server-status", "active");
        //For now just replace the source of the main window to the python server
        webContents.getAllWebContents()[0].loadURL('http://localhost:8188/');
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
  const {userResourcesPath, appResourcesPath} = app.isPackaged ? {
    // production: install python to per-user application data dir
    userResourcesPath: app.getPath('appData'),
    appResourcesPath: process.resourcesPath,
  } : {
    // development: install python to in-tree assets dir
    userResourcesPath: path.join(app.getAppPath(), 'assets'),
    appResourcesPath: path.join(app.getAppPath(), 'assets'),
  }

  console.log(`userResourcesPath: ${userResourcesPath}`);
  console.log(`appResourcesPath: ${appResourcesPath}`);

  try {
    dotenv.config({path: path.join(appResourcesPath, ".env")});
  } catch {
    // if no .env file, skip it
  }

  try {
    await fs.mkdir(userResourcesPath);
  } catch {
    // if user-specific resources dir already exists, that is fine
  }
  try { 
    createWindow();
    await launchPythonServer({userResourcesPath, appResourcesPath});
  } catch (error) {

  }
});

const killPythonServer = () => {
  console.log('Python server:', pythonProcess);
  return new Promise<void>(async(resolve, reject) => {
    if (pythonProcess) {
      try { 
        pythonProcess.kill();
        setTimeout(() => {
          resolve();
        }, 5000);
        while (pythonProcess.exitCode == null)
        {}
        resolve(); 
      }
      catch(error)
      {
        console.error(error);
        reject(error);
      } 
    }
    else
    {
      resolve();
    }
  })
};

app.on('before-quit', async () => {
  await killPythonServer();
  app.exit();
})

app.on('quit', () => {
  app.exit();
})

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
