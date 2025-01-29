import log from 'electron-log/main';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SETTINGS: ComfySettingsData = {
  'Comfy-Desktop.AutoUpdate': true,
  'Comfy-Desktop.SendStatistics': true,
  'Comfy.ColorPalette': 'dark',
  'Comfy.UseNewMenu': 'Top',
  'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
  'Comfy.Workflow.ShowMissingModelsWarning': true,
  'Comfy.Server.LaunchArgs': {},
  'Comfy-Desktop.PythonInstallMirror': '',
  'Comfy-Desktop.PypiInstallMirror': '',
  'Comfy-Desktop.TorchInstallMirror': '',
} as const;

export interface ComfySettingsData {
  'Comfy-Desktop.AutoUpdate': boolean;
  'Comfy-Desktop.SendStatistics': boolean;
  'Comfy.Server.LaunchArgs': Record<string, string>;
  'Comfy-Desktop.PythonInstallMirror': string;
  'Comfy-Desktop.PypiInstallMirror': string;
  'Comfy-Desktop.TorchInstallMirror': string;
  [key: string]: unknown;
}

/**
 * ComfySettings is a class that loads settings from the comfy.settings.json file.
 *
 * This file is exclusively written to by the ComfyUI server once it starts.
 * The Electron process can only write to this file during initialization, before
 * the ComfyUI server starts.
 */
export class ComfySettings {
  public readonly filePath: string;
  private settings: ComfySettingsData = structuredClone(DEFAULT_SETTINGS);
  private static writeLocked = false;

  constructor(basePath: string) {
    this.filePath = path.join(basePath, 'user', 'default', 'comfy.settings.json');
  }

  /**
   * Locks the settings to prevent further modifications.
   * Called when the ComfyUI server starts, as it takes ownership of the settings file.
   */
  static lockWrites() {
    ComfySettings.writeLocked = true;
  }

  public async loadSettings() {
    try {
      await fs.access(this.filePath);
    } catch {
      log.info(`Settings file ${this.filePath} does not exist. Using default settings.`);
      return;
    }
    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      // TODO: Reimplement with validation and error reporting.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.settings = JSON.parse(fileContent);
    } catch (error) {
      log.error(`Settings file cannot be loaded.`, error);
    }
  }

  /**
   * Saves settings to disk. Can only be called before the ComfyUI server starts.
   * @throws Error if called after the ComfyUI server has started
   */
  async saveSettings() {
    if (!this.settings) return;

    if (ComfySettings.writeLocked) {
      const error = new Error('Settings are locked and cannot be modified');
      log.error(error);
      throw error;
    }

    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      log.error('Failed to save settings:', error);
      throw error;
    }
  }

  set<K extends keyof ComfySettingsData>(key: K, value: ComfySettingsData[K]) {
    if (ComfySettings.writeLocked) {
      throw new Error('Settings are locked and cannot be modified');
    }
    this.settings[key] = value;
  }

  get<K extends keyof ComfySettingsData>(key: K): ComfySettingsData[K] {
    return this.settings[key] ?? DEFAULT_SETTINGS[key];
  }
}
