import { Tray, Menu, BrowserWindow, app } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import log from 'electron-log/main';
import { PythonEnvironment } from './pythonEnvironment';
import { AppWindow } from './main-process/appWindow';
import { VirtualEnvironment } from './virtualEnvironment';

export function SetupTray(mainView: AppWindow, reinstall: () => void, pythonEnvironment: PythonEnvironment): Tray {


export function SetupTray(
  mainView: BrowserWindow,
  reinstall: () => void,
  virtualEnvironment: VirtualEnvironment
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
      label: 'Install Python Packages (Open Terminal)',
      click: () => {
        // Open a Terminal locally and
        const pythonDir = path.dirname(virtualEnvironment.pythonInterpreterPath);
        const pythonExe = path.basename(virtualEnvironment.pythonInterpreterPath);
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
