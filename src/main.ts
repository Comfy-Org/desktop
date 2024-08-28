import { app, BrowserWindow } from 'electron';
import path from 'path';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}
let pythonProcess: ChildProcess | null = null;
const host = '127.0.0.1'; // Replace with the desired IP address
const port = 8188; // Replace with the port number your server is running on

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

  return new Promise<void>((resolve, reject) => {
    let executablePath: string;

    if (app.isPackaged) {
      //Production: use the bundled Python package
      executablePath = path.join(process.resourcesPath, 'UI', packagedComfyUIExecutable);
      pythonProcess = spawn(executablePath, { shell: true });
    } else {
      // Development: use the fake Python server
      executablePath = path.join(app.getAppPath(), 'ComfyUI', 'ComfyUI.sh');
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