import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log/main';

interface ComfySettingsData {
  'Comfy-Desktop.AutoUpdate'?: boolean;
  'Comfy-Desktop.SendCrashStatistics'?: boolean;
  [key: string]: any;
}

/**
 * ComfySettings is a class that loads settings from the comfy.settings.json file.
 */
export class ComfySettings {
  private filePath: string;
  private settings: ComfySettingsData;

  constructor(settingsPath: string) {
    this.filePath = path.join(settingsPath, 'user', 'default', 'comfy.settings.json');
    console.info(this.filePath);
    this.settings = this.loadSettings();
  }

  private loadSettings(): ComfySettingsData {
    if (!fs.existsSync(this.filePath)) {
      log.info(`Settings file ${this.filePath} does not exist`);
      return {};
    }
    try {
      const fileContent = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      log.error(`Failed to load settings from ${this.filePath}:`, error);
      return {};
    }
  }

  private saveSettings() {
    try {
      const dirname = path.dirname(this.filePath);
      if (!fs.existsSync(dirname)) {
        log.info(`Settings directory ${dirname} does not exist, creating ...`);
        fs.mkdirSync(dirname, {
          recursive: true,
        });
      }

      fs.writeFileSync(this.filePath, JSON.stringify(this.settings), 'utf-8');
    } catch (error) {
      log.error(`Failed to save settings to ${this.filePath}:`, error);
      return {};
    }
  }

  get autoUpdate(): boolean {
    return this.settings['Comfy-Desktop.AutoUpdate'] ?? true;
  }

  get sendCrashStatistics(): boolean {
    return this.settings['Comfy-Desktop.SendCrashStatistics'] ?? true;
  }

  set sendCrashStatistics(value: boolean) {
    this.settings['Comfy-Desktop.SendCrashStatistics'] = value;
    this.saveSettings();
  }

  public reload(): void {
    this.settings = this.loadSettings();
  }

  public getAllDesktopSettings(): Record<string, any> {
    return Object.entries(this.settings)
      .filter(([key]) => key.startsWith('Comfy-Desktop.'))
      .reduce(
        (acc, [key, value]) => {
          const settingName = key.replace('Comfy-Desktop.', '');
          acc[settingName] = value;
          return acc;
        },
        {} as Record<string, any>
      );
  }
}
