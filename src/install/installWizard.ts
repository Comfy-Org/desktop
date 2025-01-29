import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { ComfyConfigManager } from '../config/comfyConfigManager';
import { ComfyServerConfig, ModelPaths } from '../config/comfyServerConfig';
import { type ComfySettingsData, DEFAULT_SETTINGS } from '../config/comfySettings';
import { InstallOptions } from '../preload';
import { HasTelemetry, ITelemetry, trackEvent } from '../services/telemetry';

export class InstallWizard implements HasTelemetry {
  public migrationItemIds: Set<string> = new Set();

  constructor(
    public installOptions: InstallOptions,
    readonly telemetry: ITelemetry
  ) {
    this.migrationItemIds = new Set(installOptions.migrationItemIds ?? []);
  }

  get migrationSource(): string | undefined {
    return this.installOptions.migrationSourcePath;
  }

  get basePath(): string {
    return this.installOptions.installPath;
  }

  @trackEvent('install_flow:create_comfy_directories')
  public async install() {
    // Setup the ComfyUI folder structure.
    ComfyConfigManager.createComfyDirectories(this.basePath);
    this.initializeUserFiles();
    this.initializeSettings();
    await this.initializeModelPaths();
  }

  /**
   * Copy user files from migration source to the new ComfyUI folder.
   */
  public initializeUserFiles() {
    const shouldMigrateUserFiles = !!this.migrationSource && this.migrationItemIds.has('user_files');
    if (!shouldMigrateUserFiles) return;

    this.telemetry.track('migrate_flow:migrate_user_files');
    // Copy user files from migration source to the new ComfyUI folder.
    const srcUserFilesDir = path.join(this.migrationSource, 'user');
    const destUserFilesDir = path.join(this.basePath, 'user');
    fs.cpSync(srcUserFilesDir, destUserFilesDir, { recursive: true });
  }

  /**
   * Setup comfy.settings.json file
   */
  public initializeSettings() {
    const settingsPath = path.join(this.basePath, 'user', 'default', 'comfy.settings.json');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const existingSettings: ComfySettingsData = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {};

    const settings = {
      ...DEFAULT_SETTINGS,
      ...existingSettings,
      'Comfy-Desktop.AutoUpdate': this.installOptions.autoUpdate,
      'Comfy-Desktop.SendStatistics': this.installOptions.allowMetrics,
      'Comfy-Desktop.PythonInstallMirror': this.installOptions.pythonMirror,
      'Comfy-Desktop.PypiInstallMirror': this.installOptions.pypiMirror,
      'Comfy-Desktop.TorchInstallMirror': this.installOptions.torchMirror,
    };

    if (this.installOptions.device === 'cpu') {
      settings['Comfy.Server.LaunchArgs'] ??= {};
      settings['Comfy.Server.LaunchArgs']['cpu'] = '';
    }

    const settingsJson = JSON.stringify(settings, null, 2);
    fs.writeFileSync(settingsPath, settingsJson);
    log.info(`Wrote settings to ${settingsPath}: ${settingsJson}`);
  }

  /**
   * Setup extra_models_config.yaml file
   */
  public async initializeModelPaths() {
    let yamlContent: Record<string, ModelPaths>;

    const comfyDesktopConfig = ComfyServerConfig.getBaseConfig();
    comfyDesktopConfig['base_path'] = this.basePath;

    const { migrationSource } = this;
    const shouldMigrateModels = !!migrationSource && this.migrationItemIds.has('models');

    if (shouldMigrateModels) {
      this.telemetry.track('migrate_flow:migrate_models');
      // The yaml file exists in migration source repo.
      const migrationServerConfigs = await ComfyServerConfig.getConfigFromRepoPath(migrationSource);

      // The model paths in the migration source repo.
      const migrationComfyConfig = ComfyServerConfig.getBaseModelPathsFromRepoPath('');
      migrationComfyConfig['base_path'] = migrationSource;

      yamlContent = {
        ...migrationServerConfigs,
        comfyui_migration: migrationComfyConfig,
        comfyui_desktop: comfyDesktopConfig,
      };
    } else {
      yamlContent = {
        comfyui_desktop: comfyDesktopConfig,
      };
    }

    await ComfyServerConfig.createConfigFile(ComfyServerConfig.configPath, yamlContent);
  }
}
