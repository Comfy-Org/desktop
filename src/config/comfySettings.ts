import fs from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';

export const DEFAULT_SETTINGS: ComfySettingsData = {
  'Comfy-Desktop.AutoUpdate': true,
  'Comfy-Desktop.SendStatistics': true,
  'Comfy.ColorPalette': 'dark',
  'Comfy.UseNewMenu': 'Top',
  'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
  'Comfy.Workflow.ShowMissingModelsWarning': true,
  'Comfy.Server.LaunchArgs': {},
} as const;

export interface ComfySettingsData {
  'Comfy-Desktop.AutoUpdate': boolean;
  'Comfy-Desktop.SendStatistics': boolean;
  'Comfy.Server.LaunchArgs': Record<string, string>;
  [key: string]: unknown;
}

/**
 * ComfySettings is a class that loads settings from the comfy.settings.json file.
 *
 * No save or write methods are exposed; this file is exclusively written to by ComfyUI core.
 */
export class ComfySettings {
  public readonly filePath: string;
  private settings: ComfySettingsData = structuredClone(DEFAULT_SETTINGS);

  constructor(basePath: string) {
    this.filePath = path.join(basePath, 'user', 'default', 'comfy.settings.json');
  }

  public async loadSettings() {
    try {
      await fs.access(this.filePath);
    } catch {
      log.info(`Settings file ${this.filePath} does not exist. Using default settings.`);
      return;
    }
    try {
      const fileContent = await fs.readFile(this.filePath, 'utf-8');
      this.settings = JSON.parse(fileContent);
    } catch (error) {
      log.error(`Settings file cannot be loaded.`, error);
    }
  }

  get<K extends keyof ComfySettingsData>(key: K): ComfySettingsData[K] {
    return this.settings[key] ?? DEFAULT_SETTINGS[key];
  }
}
