import log from 'electron-log/main';
import ElectronStore from 'electron-store';
import { app, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { DesktopSettings } from '.';

/** Backing ref for the singleton config instance. */
let current: DesktopConfig;

/** Temporary service locator. DesktopConfig.load() must be called before access. */
export function useDesktopConfig() {
  if (!current) throw new Error('Cannot access store before initialization.');
  return current;
}

/** Handles loading of electron-store config, pre-window errors, and provides a non-null interface for the store. */
export class DesktopConfig {
  #store: ElectronStore<DesktopSettings>;

  private constructor(store: ElectronStore<DesktopSettings>) {
    this.#store = store;
  }

  /** @inheritdoc {@link ElectronStore.get} */
  get<Key extends keyof DesktopSettings>(key: Key, defaultValue?: Required<DesktopSettings>[Key]) {
    return defaultValue === undefined ? this.#store.get(key) : this.#store.get(key, defaultValue);
  }

  /** @inheritdoc {@link ElectronStore.set} */
  set<Key extends keyof DesktopSettings>(key: Key, value: Required<DesktopSettings>[Key]) {
    return value === undefined ? this.#store.delete(key) : this.#store.set(key, value);
  }

  /** @inheritdoc {@link ElectronStore.delete} */
  delete<Key extends keyof DesktopSettings>(key: Key) {
    this.#store.delete(key);
  }

  /**
   * Static factory method. Loads the config from disk.
   * @param shell Shell environment that can open file and folder views for the user
   * @param options electron-store options to pass through to the backing store
   * @returns The newly created instance, or `undefined` on error.
   * @throws On unknown error
   */
  static async load(
    shell: Electron.Shell,
    options?: ConstructorParameters<typeof ElectronStore<DesktopSettings>>[0]
  ): Promise<DesktopConfig | undefined> {
    try {
      const store = new ElectronStore<DesktopSettings>(options);
      current = new DesktopConfig(store);

      return current;
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
            return DesktopConfig.load(shell, options);
          }
        }

        // User chose to exit
        app.quit();
      } else {
        // Crash: Unknown filesystem error, permission denied on user data folder, etc
        log.error(`Unknown error whilst loading configuration file: ${configFilePath}`, error);
        throw new Error(configFilePath);
      }
    }
  }

  /**
   * Saves each {@link config} setting individually, returning a promise for the task.
   * @param key The key of {@link DesktopSettings} to save
   * @param value The value to be saved.  Must be valid.
   * @returns A promise that resolves on successful save, or rejects with the first caught error.
   */
  async setAsync<Key extends keyof DesktopSettings>(key: Key, value: DesktopSettings[Key]): Promise<void> {
    return new Promise((resolve) => {
      log.info(`Saving setting: [${key}]`, value);
      this.#store.set(key, value);
      resolve();
    });
  }

  /** @inheritdoc {@link ElectronStore.get} */
  async getAsync<Key extends keyof DesktopSettings>(key: Key): Promise<DesktopSettings[Key]> {
    return new Promise((resolve) => resolve(this.#store.get(key)));
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
