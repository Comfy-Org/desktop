import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyConfigManager } from '../../../src/config/comfyConfigManager';
import { ComfyServerConfig, ModelPaths } from '../../../src/config/comfyServerConfig';
import { ComfySettings } from '../../../src/config/comfySettings';
import { InstallWizard } from '../../../src/install/installWizard';
import { InstallOptions } from '../../../src/preload';
import { getTelemetry } from '../../../src/services/telemetry';
import { electronMock } from '../setup';

vi.mock('node:fs', () => ({
  default: {
    cpSync: vi.fn(),
    existsSync: vi.fn(),
  },
  cpSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../../../src/config/comfyConfigManager');
vi.mock('../../../src/config/comfyServerConfig');

electronMock.app.getPath = vi.fn((name: string) => {
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
});

// Mock process.resourcesPath since app.isPackaged is true
vi.stubGlobal('process', {
  ...process,
  resourcesPath: '/test/resources',
});

// Mock getAppResourcesPath module
vi.mock('../../../src/install/resourcePaths', () => ({
  getAppResourcesPath: () => '/test/resources',
}));

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}));

describe('InstallWizard', () => {
  let installWizard: InstallWizard;

  const defaultInstallOptions: InstallOptions = {
    installPath: '/test/path',
    autoUpdate: true,
    allowMetrics: true,
    device: 'nvidia',
    pythonMirror: 'default',
    pypiMirror: 'default',
    torchMirror: 'default',
  };

  beforeEach(async () => {
    await ComfySettings.load('/test/path');
    installWizard = new InstallWizard(defaultInstallOptions, getTelemetry());
  });

  describe('install', () => {
    it('should create ComfyUI directories and initialize required files', async () => {
      const baseConfig: ModelPaths = { test: 'config' };
      vi.spyOn(ComfyServerConfig, 'getBaseConfig').mockReturnValue(baseConfig);
      await installWizard.install();

      expect(ComfyConfigManager.createComfyDirectories).toHaveBeenCalledWith('/test/path');
      expect(getTelemetry().track).toHaveBeenCalledTimes(2);
      expect(getTelemetry().track).toHaveBeenCalledWith('install_flow:create_comfy_directories_start');
      expect(getTelemetry().track).toHaveBeenCalledWith('install_flow:create_comfy_directories_end');
    });
  });

  describe('initializeUserFiles', () => {
    it('should not copy files when migration source is not set', () => {
      installWizard.initializeUserFiles();

      expect(fs.cpSync).not.toHaveBeenCalled();
      expect(getTelemetry().track).not.toHaveBeenCalled();
    });

    it('should not copy files when source and destination are the same', () => {
      const wizardWithSamePaths = new InstallWizard(
        {
          ...defaultInstallOptions,
          installPath: '/test/path',
          migrationSourcePath: '/test/path',
          migrationItemIds: ['user_files'],
        },
        getTelemetry()
      );

      wizardWithSamePaths.initializeUserFiles();

      expect(fs.cpSync).not.toHaveBeenCalled();
      // Should still track that we attempted migration
      expect(getTelemetry().track).toHaveBeenCalledWith('migrate_flow:migrate_user_files');
    });

    it('should copy user files when migration source is set and user_files is in migrationItemIds', () => {
      const wizardWithMigration = new InstallWizard(
        {
          ...defaultInstallOptions,
          migrationSourcePath: '/source/path',
          migrationItemIds: ['user_files'],
        },
        getTelemetry()
      );

      wizardWithMigration.initializeUserFiles();

      expect(fs.cpSync).toHaveBeenCalledWith(path.join('/source/path', 'user'), path.join('/test/path', 'user'), {
        recursive: true,
      });
      expect(getTelemetry().track).toHaveBeenCalledWith('migrate_flow:migrate_user_files');
    });
  });

  describe('initializeSettings', () => {
    it('should create settings file with default values when no existing settings', async () => {
      // Mock fs to simulate no existing settings
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fsPromises.readFile).mockResolvedValue('{}');

      await installWizard.initializeSettings();

      // Verify settings were saved
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const savedSettings = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
      expect(savedSettings['Comfy-Desktop.AutoUpdate']).toBe(true);
      expect(savedSettings['Comfy-Desktop.SendStatistics']).toBe(true);
      expect(savedSettings['Comfy-Desktop.UV.PythonInstallMirror']).toBe('default');
      expect(savedSettings['Comfy-Desktop.UV.PypiInstallMirror']).toBe('default');
      expect(savedSettings['Comfy-Desktop.UV.TorchInstallMirror']).toBe('default');
    });

    it('should merge with existing settings when settings file exists', async () => {
      // Mock fs to simulate existing settings
      const existingSettings = {
        'Existing.Setting': 'value',
        'Comfy.ColorPalette': 'light',
        'Comfy.Server.LaunchArgs': { existingArg: true },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(existingSettings));

      await installWizard.initializeSettings();

      // Verify settings were merged and saved
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const savedSettings = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
      expect(savedSettings['Existing.Setting']).toBe('value');
      expect(savedSettings['Comfy.ColorPalette']).toBe('light');
      expect(savedSettings['Comfy.Server.LaunchArgs']).toEqual({ existingArg: true });
      expect(savedSettings['Comfy-Desktop.AutoUpdate']).toBe(true);
      expect(savedSettings['Comfy-Desktop.SendStatistics']).toBe(true);
    });

    it('should add CPU launch args when device is cpu', async () => {
      const wizardWithCpu = new InstallWizard(
        {
          ...defaultInstallOptions,
          device: 'cpu',
        },
        getTelemetry()
      );

      await wizardWithCpu.initializeSettings();

      // Verify CPU settings were saved
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const savedSettings = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
      expect(savedSettings['Comfy.Server.LaunchArgs']).toEqual({ cpu: '' });
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
        getTelemetry()
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
      expect(getTelemetry().track).toHaveBeenCalledWith('migrate_flow:migrate_models');
    });
  });
});
