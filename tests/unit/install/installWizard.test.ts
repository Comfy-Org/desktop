import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyConfigManager } from '../../../src/config/comfyConfigManager';
import { ComfyServerConfig, ModelPaths } from '../../../src/config/comfyServerConfig';
import { InstallWizard } from '../../../src/install/installWizard';
import { InstallOptions } from '../../../src/preload';
import { ITelemetry } from '../../../src/services/telemetry';

// Mock comfySettings
vi.mock('../../../src/config/comfySettings', () => ({
  comfySettings: {
    get: vi.fn(),
    set: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
  },
  DEFAULT_SETTINGS: {
    'Comfy-Desktop.AutoUpdate': true,
    'Comfy-Desktop.SendStatistics': true,
    'Comfy.ColorPalette': 'dark',
    'Comfy.UseNewMenu': 'Top',
    'Comfy.Workflow.WorkflowTabsPosition': 'Topbar',
    'Comfy.Workflow.ShowMissingModelsWarning': true,
    'Comfy.Server.LaunchArgs': {},
    'Comfy-Desktop.UV.PythonInstallMirror': '',
    'Comfy-Desktop.UV.PypiInstallMirror': '',
    'Comfy-Desktop.UV.TorchInstallMirror': '',
  },
}));

vi.mock('node:fs', () => ({
  default: {
    cpSync: vi.fn(),
    existsSync: vi.fn(),
    promises: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(''),
    },
  },
}));

vi.mock('electron-log/main');
vi.mock('../../../src/config/comfyConfigManager');
vi.mock('../../../src/config/comfyServerConfig');
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn((name: string) => {
      switch (name) {
        case 'userData':
          return '/test/user/data';
        case 'appData':
          return '/test/app/data';
        case 'temp':
          return '/test/temp';
        default:
          return '/test/default';
      }
    }),
  },
}));

// Mock process.resourcesPath since app.isPackaged is true
vi.stubGlobal('process', {
  ...process,
  resourcesPath: '/test/resources',
});

// Mock getAppResourcesPath module
vi.mock('../../../src/install/resourcePaths', () => ({
  getAppResourcesPath: () => '/test/resources',
}));

describe('InstallWizard', () => {
  let installWizard: InstallWizard;
  const mockTelemetry: ITelemetry = {
    track: vi.fn(),
    hasConsent: true,
    flush: vi.fn(),
    registerHandlers: vi.fn(),
    queueSentryEvent: vi.fn(),
    popSentryEvent: vi.fn(),
    hasPendingSentryEvents: vi.fn(),
    clearSentryQueue: vi.fn(),
  };

  const defaultInstallOptions: InstallOptions = {
    installPath: '/test/path',
    autoUpdate: true,
    allowMetrics: true,
    device: 'nvidia',
    pythonMirror: 'default',
    pypiMirror: 'default',
    torchMirror: 'default',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installWizard = new InstallWizard(defaultInstallOptions, mockTelemetry);
  });

  describe('install', () => {
    it('should create ComfyUI directories and initialize required files', async () => {
      const baseConfig: ModelPaths = { test: 'config' };
      vi.spyOn(ComfyServerConfig, 'getBaseConfig').mockReturnValue(baseConfig);
      await installWizard.install();

      expect(ComfyConfigManager.createComfyDirectories).toHaveBeenCalledWith('/test/path');
      expect(mockTelemetry.track).toHaveBeenCalledTimes(2);
      expect(mockTelemetry.track).toHaveBeenCalledWith('install_flow:create_comfy_directories_start');
      expect(mockTelemetry.track).toHaveBeenCalledWith('install_flow:create_comfy_directories_end');
    });
  });

  describe('initializeUserFiles', () => {
    it('should not copy files when migration source is not set', () => {
      installWizard.initializeUserFiles();

      expect(fs.cpSync).not.toHaveBeenCalled();
      expect(mockTelemetry.track).not.toHaveBeenCalled();
    });

    it('should copy user files when migration source is set and user_files is in migrationItemIds', () => {
      const wizardWithMigration = new InstallWizard(
        {
          ...defaultInstallOptions,
          migrationSourcePath: '/source/path',
          migrationItemIds: ['user_files'],
        },
        mockTelemetry
      );

      wizardWithMigration.initializeUserFiles();

      expect(fs.cpSync).toHaveBeenCalledWith(path.join('/source/path', 'user'), path.join('/test/path', 'user'), {
        recursive: true,
      });
      expect(mockTelemetry.track).toHaveBeenCalledWith('migrate_flow:migrate_user_files');
    });
  });

  describe('initializeSettings', () => {
    it('should create settings file with default values when no existing settings', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { comfySettings } = await import('../../../src/config/comfySettings');

      await installWizard.initializeSettings();

      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.AutoUpdate', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.SendStatistics', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PythonInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PypiInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.TorchInstallMirror', 'default');
      expect(comfySettings.saveSettings).toHaveBeenCalled();
    });

    it('should merge with existing settings when settings file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const { comfySettings } = await import('../../../src/config/comfySettings');

      // Mock existing settings file
      const existingSettings = {
        'Existing.Setting': 'value',
        'Comfy.ColorPalette': 'light',
        'Comfy.Server.LaunchArgs': { existingArg: true },
      };
      vi.mocked(fs.promises.access).mockResolvedValue(undefined);
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(existingSettings));

      await installWizard.initializeSettings();

      // Verify that loadSettings is called to load existing settings
      expect(comfySettings.loadSettings).toHaveBeenCalled();

      // Then verify only our new settings are set (not overwriting existing ones)
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.AutoUpdate', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.SendStatistics', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PythonInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PypiInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.TorchInstallMirror', 'default');
      expect(comfySettings.saveSettings).toHaveBeenCalled();

      // Verify existing settings were preserved by checking they weren't overwritten
      expect(comfySettings.set).not.toHaveBeenCalledWith('Existing.Setting', expect.any(String));
      expect(comfySettings.set).not.toHaveBeenCalledWith('Comfy.ColorPalette', expect.any(String));
      expect(comfySettings.set).not.toHaveBeenCalledWith('Comfy.Server.LaunchArgs', expect.any(Object));
    });

    it('should add CPU launch args when device is cpu', async () => {
      const wizardWithCpu = new InstallWizard(
        {
          ...defaultInstallOptions,
          device: 'cpu',
        },
        mockTelemetry
      );

      const { comfySettings } = await import('../../../src/config/comfySettings');

      await wizardWithCpu.initializeSettings();

      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.AutoUpdate', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.SendStatistics', true);
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PythonInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.PypiInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy-Desktop.UV.TorchInstallMirror', 'default');
      expect(comfySettings.set).toHaveBeenCalledWith('Comfy.Server.LaunchArgs', { cpu: '' });
      expect(comfySettings.saveSettings).toHaveBeenCalled();
    });
  });

  describe('initializeModelPaths', () => {
    it('should create config with only desktop config when no migration', async () => {
      const baseConfig: ModelPaths = { test: 'config' };
      vi.spyOn(ComfyServerConfig, 'getBaseConfig').mockReturnValue(baseConfig);

      await installWizard.initializeModelPaths();

      expect(ComfyServerConfig.createConfigFile).toHaveBeenCalledWith(ComfyServerConfig.configPath, {
        comfyui_desktop: {
          ...baseConfig,
          base_path: '/test/path',
        },
      });
    });

    it('should include migration configs when migration source is set and models is in migrationItemIds', async () => {
      const wizardWithMigration = new InstallWizard(
        {
          ...defaultInstallOptions,
          migrationSourcePath: '/source/path',
          migrationItemIds: ['models'],
        },
        mockTelemetry
      );

      const baseConfig: ModelPaths = { test: 'config' };
      const migrationConfigs: Record<string, ModelPaths> = { migration: { test: 'config' } };
      const migrationModelPaths: ModelPaths = { models: 'paths' };

      vi.spyOn(ComfyServerConfig, 'getBaseConfig').mockReturnValue(baseConfig);
      vi.spyOn(ComfyServerConfig, 'getConfigFromRepoPath').mockResolvedValue(migrationConfigs);
      vi.spyOn(ComfyServerConfig, 'getBaseModelPathsFromRepoPath').mockReturnValue(migrationModelPaths);

      await wizardWithMigration.initializeModelPaths();

      expect(ComfyServerConfig.createConfigFile).toHaveBeenCalledWith(ComfyServerConfig.configPath, {
        ...migrationConfigs,
        comfyui_migration: {
          ...migrationModelPaths,
          base_path: '/source/path',
        },
        comfyui_desktop: {
          ...baseConfig,
          base_path: '/test/path',
        },
      });
      expect(mockTelemetry.track).toHaveBeenCalledWith('migrate_flow:migrate_models');
    });
  });
});
