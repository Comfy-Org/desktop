import todesktop from '@todesktop/runtime';
import { app, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';

import { IPC_CHANNELS } from '../constants';

export function registerAppHandlers() {
  ipcMain.handle(IPC_CHANNELS.QUIT, () => {
    log.info('Received quit IPC request. Quitting app...');
    app.quit();
  });

  ipcMain.handle(
    IPC_CHANNELS.RESTART_APP,
    async (_event, { customMessage, delay }: { customMessage?: string; delay?: number }) => {
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

      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        title: 'Restart ComfyUI',
        message: customMessage,
        detail: 'The application will close and restart automatically.',
      });

      if (response === 0) {
        // "Yes" was clicked
        log.info('User confirmed restart');
        relaunchApplication(delay);
      } else {
        log.info('User cancelled restart');
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CHECK_FOR_UPDATES,
    async (options?: object): Promise<{ isUpdateAvailable: boolean; version?: string }> => {
      try {
        log.info('Manually checking for updates');

        const updater = todesktop.autoUpdater;
        if (!updater) {
          log.warn('todesktop.autoUpdater is not available');
          return { isUpdateAvailable: false };
        }

        const result = await updater.checkForUpdates(options);
        if (result.updateInfo) {
          const { version, releaseDate } = result.updateInfo;
          const prettyDate = new Date(releaseDate).toLocaleString();
          log.info(`Update available: version ${version} released on ${prettyDate}`);
        } else {
          log.info('No updates available');
        }

        return {
          isUpdateAvailable: !!result.updateInfo,
          version: result.updateInfo?.version,
        };
      } catch (error) {
        log.error('Error checking for updates:', error);
        return { isUpdateAvailable: false };
      }
    }
  );

  ipcMain.on(IPC_CHANNELS.RESTART_AND_INSTALL, (options?: object) => {
    log.info('Restarting and installing update');

    const updater = todesktop.autoUpdater;
    if (!updater) {
      log.warn('todesktop.autoUpdater is not available');
      return;
    }

    try {
      updater.restartAndInstall(options);
    } catch (error) {
      log.error('Error restarting and installing update:', error);
    }
  });
}
