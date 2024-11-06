import { app, dialog, Menu, MenuItem } from 'electron';

export function buildMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const aboutMenuItem = {
      label: 'About ComfyUI',
      click: () => {
        dialog.showMessageBox({
          title: 'About',
          message: `ComfyUI v${app.getVersion()}`,
          detail: 'Created by Comfy Org\nCopyright © 2024',
          buttons: ['OK'],
        });
      },
    };
    const helpMenuItem = menu.items.find((item) => item.role === 'help');
    if (helpMenuItem && helpMenuItem.submenu) {
      helpMenuItem.submenu.append(new MenuItem(aboutMenuItem));
      Menu.setApplicationMenu(menu);
    } else {
      // If there's no Help menu, add one
      menu.append(
        new MenuItem({
          label: 'Help',
          submenu: [aboutMenuItem],
        })
      );
      Menu.setApplicationMenu(menu);
    }
  }
}
