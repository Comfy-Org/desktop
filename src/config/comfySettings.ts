import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log/main';

const DEFAULT_SETTINGS = {
  'Comfy-Desktop.AutoUpdate': true,
  'Comfy-Desktop.SendCrashStatistics': true,
};

type ComfySettingsData = Partial<typeof DEFAULT_SETTINGS>;

/**
 * ComfySettings is a class that loads settings from the comfy.settings.json file.
 */
export class ComfySettings {
  public readonly filePath: string;
  private settings: ComfySettingsData = DEFAULT_SETTINGS;

  constructor(basePath: string) {
    this.filePath = path.join(basePath, 'user', 'default', 'comfy.settings.json');
  }

  public loadSettings() {
    if (!fs.existsSync(this.filePath)) {
      log.info(`Settings file ${this.filePath} does not exist. Using default settings.`);
      return;
    }
    const fileContent = fs.readFileSync(this.filePath, 'utf-8');
    this.settings = JSON.parse(fileContent);
  }

  get<K extends keyof ComfySettingsData>(key: K): ComfySettingsData[K] {
    return this.settings[key] ?? DEFAULT_SETTINGS[key];
  }

  set<K extends keyof ComfySettingsData>(key: K, value: ComfySettingsData[K]) {
    this.settings[key] = value;
  }
}
