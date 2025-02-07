import fs from 'node:fs';
import path from 'node:path';

import { useDesktopConfig } from '@/store/desktopConfig';

import { ComfyConfigManager } from '../config/comfyConfigManager';
import { ComfyServerConfig, ModelPaths } from '../config/comfyServerConfig';
import { comfySettings } from '../config/comfySettings';
import { InstallOptions } from '../preload';
import { HasTelemetry, getTelemetry, trackEvent } from '../services/telemetry';

export class InstallWizard implements HasTelemetry {
  public migrationItemIds: Set<string> = new Set();
  readonly telemetry = getTelemetry();

  constructor(public installOptions: InstallOptions) {
    this.migrationItemIds = new Set(installOptions.migrationItemIds ?? []);
  }

  get migrationSource(): string | undefined {
    return this.installOptions.migrationSourcePath;
  }

  @trackEvent('install_flow:create_comfy_directories')
  public async install() {
    // Setup the ComfyUI folder structure.
    ComfyConfigManager.createComfyDirectories(useDesktopConfig().get('basePath')!);
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
    const destUserFilesDir = path.join(useDesktopConfig().get('basePath')!, 'user');
    fs.cpSync(srcUserFilesDir, destUserFilesDir, { recursive: true });
  }

  /**
   * Setup comfy.settings.json file
   */
  public initializeSettings() {
    const settings = {
      'Comfy-Desktop.AutoUpdate': this.installOptions.autoUpdate,
      'Comfy-Desktop.SendStatistics': this.installOptions.allowMetrics,
      'Comfy-Desktop.UV.PythonInstallMirror': this.installOptions.pythonMirror,
      'Comfy-Desktop.UV.PypiInstallMirror': this.installOptions.pypiMirror,
      'Comfy-Desktop.UV.TorchInstallMirror': this.installOptions.torchMirror,
    };
    for (const [key, value] of Object.entries(settings)) {
      comfySettings.set(key, value);
    }
    const launchArgs = comfySettings.get('Comfy.Server.LaunchArgs') ?? {};
    if (this.installOptions.device === 'cpu') {
      launchArgs['cpu'] = '';
      comfySettings.set('Comfy.Server.LaunchArgs', launchArgs);
    }

    comfySettings.saveSettings();
  }

  /**
   * Setup extra_models_config.yaml file
   */
  public async initializeModelPaths() {
    let yamlContent: Record<string, ModelPaths>;

    const comfyDesktopConfig = ComfyServerConfig.getBaseConfig();
    comfyDesktopConfig['base_path'] = useDesktopConfig().get('basePath')!;

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
