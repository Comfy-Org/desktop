import log from 'electron-log/main';
import ElectronStore from 'electron-store';
import { app, dialog } from 'electron';
import path from 'node:path';
import fs from 'fs/promises';
import type { DesktopSettings } from '.';

let currentStore: ElectronStore<DesktopSettings>;

/** Generic wrapper class to load electron stores and handle errors. */
export function useDesktopStore() {
  const store = currentStore;

  async function loadStore(
    options?: ConstructorParameters<typeof ElectronStore<DesktopSettings>>[0]
  ): Promise<ElectronStore<DesktopSettings> | undefined> {
    try {
      currentStore = new ElectronStore<DesktopSettings>(options);
      return currentStore;
    } catch (error) {
      const configFilePath = path.join(getUserDataOrQuit(), `${options?.name ?? 'config'}.json`);

      if (error instanceof SyntaxError) {
        // The .json file is invalid.  Prompt user to reset.
        const { response } = await showResetPrompt(configFilePath);

        // You sure?
        if (response === 0) {
          const { response } = await showConfirmReset(configFilePath);

          if (response === 0) {
            // Delete all settings
            await tryDeleteConfigFile(configFilePath);

            // Causing a stack overflow from this recursion would take immense patience.
            return loadStore(options);
          }
        }

        // User chose to exit
        app.quit();
      } else {
        // Crash: Unknown filesystem error, permission denied on user data folder, etc
        log.error(`Unknown error whilst loading configuration file: ${configFilePath}`, error);
        dialog.showErrorBox('User Data', `Unknown error whilst writing to user data folder:\n\n${configFilePath}`);
      }
    }
  }

  return {
    store,
    loadStore,
  };
}

function showResetPrompt(configFilePath: string): Promise<Electron.MessageBoxReturnValue> {
  return dialog.showMessageBox({
    title: 'Invalid configuration file',
    type: 'error',
    message: `Format of the configuration file is invalid:\n\n${configFilePath}`,
    buttons: ['&Reset the configuration file', '&Quit'],
    defaultId: 1,
    cancelId: 1,
    normalizeAccessKeys: true,
  });
}

function showConfirmReset(configFilePath: string): Promise<Electron.MessageBoxReturnValue> {
  return dialog.showMessageBox({
    title: 'Confirm reset settings',
    type: 'warning',
    message: `The configuration file below will be cleared and all settings will be reset.  You should back this file up before deleting it.\n\n${configFilePath}`,
    buttons: ['Try to open the &file', '&Yes, delete all settings', '&Quit'],
    defaultId: 1,
    cancelId: 1,
    normalizeAccessKeys: true,
  });
}

async function tryDeleteConfigFile(configFilePath: string) {
  try {
    await fs.rm(configFilePath);
  } catch (error) {
    log.error(`Unable to delete configuration file: ${configFilePath}`, error);
    dialog.showErrorBox('Delete Failed', `Unknown error whilst attempting to delete config file:\n\n${configFilePath}`);
  }
}

function getUserDataOrQuit() {
  try {
    return app.getPath('userData');
  } catch (error) {
    // Crash: Can't even find the user userData folder
    log.error('Cannot find user data folder.', error);
    dialog.showErrorBox('User Data', 'Unknown error whilst attempting to determine user data folder.');
    app.quit();
    throw error;
  }
}
