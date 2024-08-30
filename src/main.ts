import { spawn, ChildProcess } from 'node:child_process';
import { access, glob } from 'node:fs/promises';
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
const scriptPath = 'assets/ComfyUI/main.py';
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
    if (app.isPackaged) {
      // Production: use the bundled Python package
      const {pythonPath, scriptPath} = (process.platform == 'win32') ?  {
        pythonPath: path.join(process.resourcesPath, 'python', 'python.exe'),
        scriptPath: path.join(process.resourcesPath, 'ComfyUI', 'main.py'),
      } : {
        pythonPath: path.join(process.resourcesPath, 'python', 'bin', 'python'),
        scriptPath: path.join(process.resourcesPath, 'ComfyUI', 'main.py'),
      };

      console.log('Python Path:', pythonPath);
      console.log('Script Path:', scriptPath);

      access(pythonPath).then(async () => {
        pythonProcess = spawn(pythonPath, [scriptPath], {
          cwd: path.dirname(scriptPath)
        });
      }).catch(async () => {
        const pythonTarPath = path.join(process.resourcesPath, 'python.tgz');
        await tar.extract({file: pythonTarPath});

        const rehydrateCmd = ['-m', 'uv', 'pip', 'install', '--no-index', '--no-deps', ...await Array.fromAsync(glob(path.join(process.resourcesPath, 'python', 'wheels', '*')))];
        const rehyd = spawn(pythonPath, rehydrateCmd);
        rehyd.on("exit", code => {
          if (code===0) {
            pythonProcess = spawn(pythonPath, [scriptPath], {
              cwd: path.dirname(scriptPath)
            });
          } else {
            console.log(`rehydration of python bundle exited with code ${code}`)
          }
        });
      });
    } else {
      // Development: use the fake Python server
      const executablePath = path.join(app.getAppPath(), 'ComfyUI', 'ComfyUI.sh');
      pythonProcess = spawn(executablePath, {
        stdio: 'pipe',
      });
    }

    pythonProcess.stdout.pipe(process.stdout);
    pythonProcess.stderr.pipe(process.stderr);

    const checkInterval = 1000; // Check every 1 second

    const checkServerReady = async () => {
      const isReady = await isPortInUse(host, port);
      if (isReady) {
        console.log('Python server is ready');
        resolve();
      } else {
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
  createWindow();
  try {
    await launchPythonServer();

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
