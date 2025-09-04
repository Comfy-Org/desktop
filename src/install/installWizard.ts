import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { ComfyConfigManager } from '../config/comfyConfigManager';
import { ComfyServerConfig, ModelPaths } from '../config/comfyServerConfig';
import { ComfySettings, type ComfySettingsData } from '../config/comfySettings';
import { InstallStage } from '../constants';
import { useAppState } from '../main-process/appState';
import { createInstallStageInfo } from '../main-process/installStages';
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

    const appState = useAppState();
    appState.setInstallStage(createInstallStageInfo(InstallStage.INITIALIZING_CONFIG, { progress: 10 }));

    await this.initializeSettings();
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
    if (path.resolve(srcUserFilesDir) !== path.resolve(destUserFilesDir)) {
      fs.cpSync(srcUserFilesDir, destUserFilesDir, { recursive: true });
    } else {
      log.warn(`Skipping user files migration: source and destination are the same (${srcUserFilesDir})`);
    }
  }

  /**
   * Setup comfy.settings.json file
   */
  public async initializeSettings() {
    // Load any existing settings if they exist
    const existingSettings = await ComfySettings.load(this.basePath);

    // Add install options to settings
    const settings: Partial<ComfySettingsData> = {
      'Comfy-Desktop.AutoUpdate': this.installOptions.autoUpdate,
      'Comfy-Desktop.SendStatistics': this.installOptions.allowMetrics,
      'Comfy-Desktop.UV.PythonInstallMirror': this.installOptions.pythonMirror,
      'Comfy-Desktop.UV.PypiInstallMirror': this.installOptions.pypiMirror,
      'Comfy-Desktop.UV.TorchInstallMirror': this.installOptions.torchMirror,
    };

    if (this.installOptions.device === 'cpu') {
      settings['Comfy.Server.LaunchArgs'] ??= {};
      settings['Comfy.Server.LaunchArgs']['cpu'] = '';
    }

    for (const [key, value] of Object.entries(settings)) {
      existingSettings.set(key, value);
    }

    await existingSettings.saveSettings();
    log.info(`Wrote install options to comfy settings file.`);
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
