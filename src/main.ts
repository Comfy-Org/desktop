import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';
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
  mainWindow.loadURL('http://localhost:8188/');

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};


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


const launchPythonServer = async () => {
  const isServerRunning = await isPortInUse(host, port);
  if (isServerRunning) {
    console.log('Python server is already running');
    return Promise.resolve();
  }

  console.log('Launching Python server...');

  return new Promise<void>(async (resolve, reject) => {
    const {userResourcesPath, appResourcesPath} = app.isPackaged ? {
      // production: install python to per-user application data dir
      userResourcesPath: app.getPath('appData'),
      appResourcesPath: process.resourcesPath,
    } : {
      // development: install python to in-tree assets dir
      userResourcesPath: path.join(app.getAppPath(), 'assets'),
      appResourcesPath: path.join(app.getAppPath(), 'assets'),
    }

    try {
      await fs.mkdir(userResourcesPath);
    } catch {null;}

    console.log(`userResourcesPath: ${userResourcesPath}`);
    console.log(`appResourcesPath: ${appResourcesPath}`);

    const pythonRootPath = path.join(userResourcesPath, 'python');
    const pythonInterpreterPath = process.platform==='win32' ? path.join(pythonRootPath, 'python.exe') : path.join(pythonRootPath, 'bin', 'python');
    const pythonRecordPath = path.join(pythonRootPath, "INSTALLER");
    const scriptPath = path.join(appResourcesPath, 'ComfyUI', 'main.py');

    // check for existence of both interpreter and INSTALLER record to ensure a correctly installed python env
    Promise.all([fs.access(pythonInterpreterPath), fs.access(pythonRecordPath)]).then(async () => {
      pythonProcess = spawn(pythonInterpreterPath, [scriptPath], {
        cwd: path.dirname(scriptPath)
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
      pythonProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });
    }).catch(async () => {
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

          pythonProcess = spawn(pythonInterpreterPath, [scriptPath], {
            cwd: path.dirname(scriptPath)
          });

          pythonProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
          });
          pythonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
          });
        } else {
          console.log(`Rehydration of python bundle exited with code ${code}`);
        }
      });
    });

    const checkInterval = 1000; // Check every 1 second

    const checkServerReady = async () => {
      const isReady = await isPortInUse(host, port);
      if (isReady) {
        console.log('Python server is ready');
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
  try {
    await launchPythonServer();
    createWindow();
  } catch (error) {

  }
});

const killPythonServer = () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
};

app.on('will-quit', () => {
  killPythonServer();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
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
