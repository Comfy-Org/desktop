import { Tray, Menu, BrowserWindow, app } from "electron";
import path from 'path';

export function SetupTray(mainView: BrowserWindow): Tray {

    const trayImage = path.join(process.resourcesPath, 'UI', 'Comfy_Logo_x32.png');
    let tray = new Tray(trayImage);

    tray.setTitle('ComfyUI');
    tray.setToolTip('ComfyUI - Server is running');
    
    const contextMenu = Menu.buildFromTemplate([
    {
        label: 'Show Comfy Window',
        click: function () {
            mainView.show();
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
        }
    }]);

    tray.setContextMenu(contextMenu);

    return tray;
}