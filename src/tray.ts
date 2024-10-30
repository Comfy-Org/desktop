import { Tray, Menu, BrowserWindow, app, shell } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from './constants';
import { exec } from 'child_process';
import log from 'electron-log/main';
import { PythonEnvironment } from './pythonEnvironment';
import { getModelsDirectory } from './utils';

export function SetupTray(
  mainView: BrowserWindow,
  basePath: string,
  modelConfigPath: string,
  reinstall: () => void,
  pythonEnvironment: PythonEnvironment
): Tray {
  // Set icon for the tray
  // I think there is a way to packaged the icon in so you don't need to reference resourcesPath
  const trayImage = path.join(
    app.isPackaged ? process.resourcesPath : './assets',
    'UI',
    process.platform === 'darwin' ? 'Comfy_Logo_x16_BW.png' : 'Comfy_Logo_x32.png'
  );
  let tray = new Tray(trayImage);

  tray.setToolTip('ComfyUI');

  // For Mac you can have a separate icon when you press.
  // The current design language for Mac Eco System is White or Black icon then when you click it is in color
  if (process.platform === 'darwin') {
    tray.setPressedImage(path.join(app.isPackaged ? process.resourcesPath : './assets', 'UI', 'Comfy_Logo_x16.png'));
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Comfy Window',
      click: function () {
        mainView.show();
        // Mac Only
        if (process.platform === 'darwin') {
          app.dock.show();
        }
      },
    },
    {
      label: 'Quit Comfy',
      click() {
        app.quit();
      },
    },
    {
      label: 'Hide',
      click() {
        mainView.hide();
        // Mac Only
        if (process.platform === 'darwin') {
          app.dock.hide();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Reset Install Location',
      click: () => reinstall(),
    },
    { type: 'separator' },
    {
      label: 'Open Models Folder',
      click: () => shell.openPath(getModelsDirectory(basePath)),
    },
    {
      label: 'Open Outputs Folder',
      click: () => shell.openPath(path.join(basePath, 'output')),
    },
    {
      label: 'Open Inputs Folder',
      click: () => shell.openPath(path.join(basePath, 'input')),
    },
    {
      label: 'Open Custom Nodes Folder',
      click: () => shell.openPath(path.join(basePath, 'custom_nodes')),
    },
    {
      label: 'Open Model Config',
      click: () => shell.openPath(modelConfigPath),
    },
    {
      label: 'Open Logs Folder',
      click: () => shell.openPath(app.getPath('logs')),
    },
    {
      label: 'Open devtools (Electron)',
      click: () => mainView.webContents.openDevTools(),
    },
    {
      label: 'Open devtools (ComfyUI)',
      click: () => mainView.webContents.send(IPC_CHANNELS.OPEN_DEVTOOLS),
    },
    {
      label: 'Install Python Packages (Open Terminal)',
      click: () => {
        // Open a Terminal locally and
        const pythonDir = path.dirname(pythonEnvironment.pythonInterpreterPath);
        const pythonExe = path.basename(pythonEnvironment.pythonInterpreterPath);
        const command =
          process.platform === 'win32'
            ? `start powershell.exe -noexit -command "cd '${pythonDir}'; .\\${pythonExe} -m pip list"`
            : `osascript -e 'tell application "Terminal"
                do script "cd \\"${pythonDir}\\" && ./${pythonExe} -m pip list"
                activate
              end tell'`;
        exec(command, (error, stdout, stderr) => {
          if (error) {
            log.error(`Error executing command: ${error}`);
          }
        });
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // If we want to make it more dynamic return tray so we can access it later
  return tray;
}
