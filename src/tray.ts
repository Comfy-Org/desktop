import { Tray, Menu, BrowserWindow, app, shell } from 'electron';
import path from 'path';

export function SetupTray(mainView: BrowserWindow, userResourcesPath: string): Tray {
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
      label: 'Open Folder',
      submenu: [
        {
          label: 'Models',
          click: () => shell.openPath(path.join(userResourcesPath, 'models')),
        },
        {
          label: 'Outputs',
          click: () => shell.openPath(path.join(userResourcesPath, 'output')),
        },
        {
          label: 'Inputs',
          click: () => shell.openPath(path.join(userResourcesPath, 'input')),
        },
        {
          label: 'Custom Nodes',
          click: () => shell.openPath(path.join(userResourcesPath, 'custom_nodes')),
        },
        {
          label: 'Logs',
          click: () => shell.openPath(app.getPath('logs')),
        },
      ],
    },
  ]);

  tray.setContextMenu(contextMenu);

  // If we want to make it more dynamic return tray so we can access it later
  return tray;
}
