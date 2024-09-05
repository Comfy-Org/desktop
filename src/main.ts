import { app, BrowserWindow, webContents } from 'electron';
import path from 'path';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import('electron-squirrel-startup').then(ess => {
  const {default: check} = ess;
  if (check) {
    app.quit();
  }
});

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

const launchPythonServer = async () => {
  const isServerRunning = await isPortInUse(host, port);
  if (isServerRunning) {
    console.log('Python server is already running');
    // Server has been started outside the app, so attach to it.
    setTimeout(() => {
      // Not sure if needed but wait a few moments before sending the connect message up. 
      webContents.getAllWebContents()[0].send("python-server-status", "active");
    }, 5000);
    clearInterval(serverHeartBeatReference);
    serverHeartBeatReference = setInterval(serverHeartBeat, serverHeartBeatInterval);
    return Promise.resolve();
  }

  console.log('Launching Python server...');

  return new Promise<void>((resolve, reject) => {
    let executablePath: string;
    let pythonProcess: ChildProcess;
    if (app.isPackaged) {
        if (process.platform == 'darwin') {
            // On macOS, the Python executable is inside the app bundle
            const pythonPath = path.join(process.resourcesPath, 'python', 'bin', 'python');
            console.log('pythonPath', pythonPath);
            console.log(scriptPath)
            pythonProcess = spawn(pythonPath, [scriptPath]);
        } else {
            //Production: use the bundled Python package
            executablePath = path.join(process.resourcesPath, 'UI', packagedComfyUIExecutable);
            pythonProcess = spawn(executablePath, { shell: true });
        }
    } else {
      // Development: use the fake Python server
      if (process.platform == 'darwin') {
        // On macOS, the Python executable is inside the app bundle
        const pythonPath = path.join(app.getAppPath(), 'assets', 'python', 'bin', 'python');
        pythonProcess = spawn(pythonPath, [scriptPath]);
      }
      else {
        executablePath = path.join(process.resourcesPath, 'UI', packagedComfyUIExecutable);
        pythonProcess = spawn(executablePath, { shell: true });
      }
    }
    
    pythonProcess.stdout.pipe(process.stdout);
    pythonProcess.stderr.pipe(process.stderr);

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
