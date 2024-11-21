import path from 'path';
import log from 'electron-log/main';
import fs from 'fs';
import { InstallOptions } from '../preload';
import { DEFAULT_SETTINGS } from '../config/comfySettings';
import { ComfyServerConfig, ModelPaths } from '../config/comfyServerConfig';
import { ComfyConfigManager } from '../config/comfyConfigManager';

export class InstallWizard {
  public migrationItemIds: Set<string> = new Set();

  constructor(public installOptions: InstallOptions) {
    this.migrationItemIds = new Set(installOptions.migrationItemIds ?? []);
  }

  get migrationSource(): string | undefined {
    return this.installOptions.migrationSourcePath;
  }

  get shouldMigrateUserFiles(): boolean {
    return !!this.migrationSource && this.migrationItemIds.has('user_files');
  }

  get shouldMigrateModels(): boolean {
    return !!this.migrationSource && this.migrationItemIds.has('models');
  }

  get basePath(): string {
    return path.join(this.installOptions.installPath, 'ComfyUI');
  }

  public async install() {
    // Setup the ComfyUI folder structure.
    ComfyConfigManager.setUpComfyUI(this.basePath);
    this.initializeUserFiles();
    this.initializeSettings();
    await this.initializeModelPaths();
  }

  /**
   * Copy user files from migration source to the new ComfyUI folder.
   */
  public initializeUserFiles() {
    if (!this.shouldMigrateUserFiles) {
      return;
    }
    // Copy user files from migration source to the new ComfyUI folder.
    const srcUserFilesDir = path.join(this.migrationSource!, 'user');
    const destUserFilesDir = path.join(this.basePath, 'user');
    fs.cpSync(srcUserFilesDir, destUserFilesDir, { recursive: true });
  }

  /**
   * Setup comfy.settings.json file
   */
  public initializeSettings() {
    const settingsPath = path.join(this.basePath, 'user', 'default', 'comfy.settings.json');
    const existingSettings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};

    const settings = {
      ...DEFAULT_SETTINGS,
      ...existingSettings,
      'Comfy-Desktop.AutoUpdate': this.installOptions.autoUpdate,
      'Comfy-Desktop.SendStatistics': this.installOptions.allowMetrics,
    };
    const settingsJson = JSON.stringify(settings, null, 2);
    fs.writeFileSync(settingsPath, settingsJson);
    log.info(`Wrote settings to ${settingsPath}: ${settingsJson}`);
  }

  /**
   * Setup extra_model_paths.yaml file
   */
  public async initializeModelPaths() {
    const { comfyui: comfyuiConfig, ...extraConfigs } = await this.getMigrationModelPaths();
    comfyuiConfig['base_path'] = this.basePath;
    await ComfyServerConfig.createConfigFile(ComfyServerConfig.configPath, comfyuiConfig, extraConfigs);
  }

  /**
   * Get the config for the migration source (Existing ComfyUI instance).
   */
  public async getMigrationModelPaths(): Promise<{ comfyui: ModelPaths } & Record<string, ModelPaths>> {
    if (!this.shouldMigrateModels) {
      return { comfyui: {} };
    }
    // The yaml file exited in migration source repo.
    const migrationServerConfig = await ComfyServerConfig.getConfigFromRepoPath(this.migrationSource!);

    // The model paths in the migration source repo.
    const migrationComfyConfig = this.migrationSource
      ? ComfyServerConfig.getBaseModelPathsFromRepoPath(this.migrationSource)
      : {};

    // The overall paths to add to the config file.
    const comfyuiConfig = ComfyServerConfig.mergeConfig(migrationServerConfig['comfyui'] ?? {}, migrationComfyConfig);
    // Do not migrate custom nodes as we currently don't have a way to install their dependencies.
    if ('custom_nodes' in comfyuiConfig) {
      delete comfyuiConfig['custom_nodes'];
    }
    return {
      ...migrationServerConfig,
      comfyui: comfyuiConfig,
    };
  }
}
