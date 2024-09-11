import { Tray, Menu, BrowserWindow, app } from "electron";
import path from 'path';

export function SetupTray(mainView: BrowserWindow): Tray {

    // Set icon for the tray 
    // I think there is a way to packaged the icon in so you don't need to reference resourcesPath
    const trayImage = path.join(app.isPackaged ? process.resourcesPath : './assets', 'UI', process.platform === 'darwin' ? 'Comfy_Logo_x16_BW.png' : 'Comfy_Logo_x32.png');
    let tray = new Tray(trayImage);

    tray.setTitle('ComfyUI'); // Only Macos, can be blank to JUST show icon 
    tray.setToolTip('ComfyUI - Server is running');

    // For Mac you can have a separate icon when you press. 
    // The current design language for Mac Eco System is White or Black icon then when you click it is in color
    if (process.platform === "darwin")
    {
        tray.setPressedImage(path.join(app.isPackaged ? process.resourcesPath : './assets', 'UI','Comfy_Logo_x16.png'));
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
        }
    }]);

    tray.setContextMenu(contextMenu);

    // If we want to make it more dynamic return tray so we can access it later
    return tray;
}