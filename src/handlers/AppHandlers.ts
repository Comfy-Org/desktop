import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { IPC_CHANNELS } from '../constants';

export function registerAppHandlers() {
  ipcMain.handle(IPC_CHANNELS.QUIT, () => {
    log.info('Received quit IPC request. Quitting app...');
    app.quit();
  });

  ipcMain.on(
    IPC_CHANNELS.RESTART_APP,
    (_event, { customMessage, delay }: { customMessage?: string; delay?: number }) => {
      function relaunchApplication(delay?: number) {
        if (delay) {
          setTimeout(() => {
            app.relaunch();
            app.quit();
          }, delay);
        } else {
          app.relaunch();
          app.quit();
        }
      }

      const delayText = delay ? `in ${delay}ms` : 'immediately';
      if (!customMessage) {
        log.info(`Relaunching application ${delayText}`);
        return relaunchApplication(delay);
      }

      log.info(`Relaunching application ${delayText} with custom confirmation message: ${customMessage}`);

      dialog
        .showMessageBox({
          type: 'question',
          buttons: ['Yes', 'No'],
          defaultId: 0,
          title: 'Restart ComfyUI',
          message: customMessage || 'Are you sure you want to restart ComfyUI?',
          detail: 'The application will close and restart automatically.',
        })
        .then(({ response }) => {
          if (response === 0) {
            // "Yes" was clicked
            log.info('User confirmed restart');
            relaunchApplication(delay);
          } else {
            log.info('User cancelled restart');
          }
        })
        .catch((error) => {
          log.error('Error showing restart confirmation dialog:', error);
        });
    }
  );
}
