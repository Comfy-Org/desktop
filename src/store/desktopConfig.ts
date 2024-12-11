import log from 'electron-log/main';
import ElectronStore from 'electron-store';
import { app, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'fs/promises';
import type { DesktopSettings } from '.';
import type { GpuType } from '../preload';

/** Handles loading of electron-store config, pre-window errors, and provides a non-null interface for the store. */
export class DesktopConfig {
  static #store: ElectronStore<DesktopSettings> | undefined;
  static get store(): ElectronStore<DesktopSettings> {
    const store = this.#store;
    if (!store) throw new Error('Cannot access store before initialization.');
    return store;
  }

  static get devCpuMode(): boolean {
    return DesktopConfig.store.get('devCpuMode') === true;
  }

  static get gpu(): GpuType | undefined {
    return DesktopConfig.store.get('detectedGpu');
  }

  static async load(
    options?: ConstructorParameters<typeof ElectronStore<DesktopSettings>>[0]
  ): Promise<ElectronStore<DesktopSettings> | undefined> {
    try {
      DesktopConfig.#store = new ElectronStore<DesktopSettings>(options);

      return DesktopConfig.#store;
    } catch (error) {
      const configFilePath = path.join(getUserDataOrQuit(), `${options?.name ?? 'config'}.json`);

      if (error instanceof SyntaxError) {
        // The .json file is invalid.  Prompt user to reset.
        const { response } = await showResetPrompt(configFilePath);

        if (response === 1) {
          // Open dir with file selected
          shell.showItemInFolder(configFilePath);
        } else if (response === 0) {
          // Reset - you sure?
          const { response } = await showConfirmReset(configFilePath);

          if (response === 0) {
            // Open dir with file selected
            shell.showItemInFolder(configFilePath);
          } else if (response === 1) {
            // Delete all settings
            await tryDeleteConfigFile(configFilePath);

            // Causing a stack overflow from this recursion would take immense patience.
            return DesktopConfig.load(options);
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

  /**
   * Saves each {@link config} setting individually, returning a promise for the task.
   * @param key The key of {@link DesktopSettings} to save
   * @param value The value to be saved.  Must be valid.
   * @returns A promise that resolves on successful save, or rejects with the first caught error.
   */
  static async setAsync<Key extends keyof DesktopSettings>(key: Key, value: DesktopSettings[Key]): Promise<void> {
    return new Promise((resolve, reject) => {
      log.info(`Saving setting: [${key}]`, value);
      try {
        DesktopConfig.store.set(key, value);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}

function showResetPrompt(configFilePath: string): Promise<Electron.MessageBoxReturnValue> {
  return dialog.showMessageBox({
    title: 'Invalid configuration file',
    type: 'error',
    message: `Format of the configuration file below is invalid.  It should be a JSON file containing only ComfyUI configuration options.\n\n${configFilePath}`,
    buttons: ['&Reset desktop configuration', 'Show the &file (and quit)', '&Quit'],
    defaultId: 0,
    cancelId: 2,
    normalizeAccessKeys: true,
  });
}

function showConfirmReset(configFilePath: string): Promise<Electron.MessageBoxReturnValue> {
  return dialog.showMessageBox({
    title: 'Confirm reset settings',
    type: 'warning',
    message: `The configuration file below will be cleared and all settings will be reset.  You should back this file up before deleting it.\n\n${configFilePath}`,
    buttons: ['Show the &file (and quit)', '&Yes, delete all settings', '&Quit'],
    defaultId: 0,
    cancelId: 2,
    normalizeAccessKeys: true,
  });
}

async function tryDeleteConfigFile(configFilePath: string): Promise<void> {
  try {
    await fs.rm(configFilePath);
  } catch (error) {
    log.error(`Unable to delete configuration file: ${configFilePath}`, error);
    dialog.showErrorBox('Delete Failed', `Unknown error whilst attempting to delete config file:\n\n${configFilePath}`);
  }
}

function getUserDataOrQuit(): string {
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
