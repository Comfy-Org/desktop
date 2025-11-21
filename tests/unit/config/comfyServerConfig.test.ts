import { app } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyServerConfig } from '@/config/comfyServerConfig';

vi.mock('@/install/resourcePaths', () => ({
  getAppResourcesPath: vi.fn(() => '/mocked/app_resources'),
}));

async function createTmpDir() {
  const prefix = path.join(tmpdir(), 'vitest-');
  return mkdtemp(prefix);
}

async function copyFixture(fixturePath: string, targetPath: string) {
  const content = await readFile(path.join('tests/assets/extra_models_paths', fixturePath), 'utf8');
  await writeFile(targetPath, content, { encoding: 'utf8', flush: true });
}

function stubPlatform(platform: NodeJS.Platform) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...originalDescriptor, value: platform });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(process, 'platform', originalDescriptor);
    }
  };
}

describe('ComfyServerConfig', () => {
  const mockUserDataPath = '/fake/user/data';
  let tempDir = '';

  beforeAll(async () => {
    tempDir = await createTmpDir();
  });

  beforeEach(() => {
    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'userData') return '/fake/user/data';
      throw new Error(`Unexpected getPath key: ${key}`);
    });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe('configPath', () => {
    it('should return the correct path', () => {
      const { getPath } = app;
      vi.mocked(getPath).mockImplementation((key: string) => {
        if (key === 'userData') return mockUserDataPath;
        throw new Error(`Unexpected getPath key: ${key}`);
      });

      const { configPath } = ComfyServerConfig;
      expect(configPath).toBe(path.join(mockUserDataPath, 'extra_models_config.yaml'));
      expect(getPath).toHaveBeenCalledWith('userData');
    });
  });

  describe('readBasePathFromConfig', () => {
    it('should read base_path from valid config file', async () => {
      const testConfigPath = path.join(tempDir, 'test_config.yaml');
      await copyFixture('valid-config.yaml', testConfigPath);
      const readResult = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(readResult.status).toBe('success');
      expect(readResult.path).toBe('/test/path');
    });

    it('should detect non-existent file', async () => {
      const readResult = await ComfyServerConfig.readBasePathFromConfig('non_existent_file.yaml');
      expect(readResult.status).toBe('notFound');
      expect(readResult.path).toBeUndefined();
    });

    it('should handle missing base path', async () => {
      const testConfigPath = path.join(tempDir, 'test_config.yaml');
      await copyFixture('missing-base-path.yaml', testConfigPath);
      const readResult = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(readResult.status).toBe('invalid');
      expect(readResult.path).toBeUndefined();
    });

    it('should handle wrong base path type', async () => {
      const testConfigPath = path.join(tempDir, 'test_config.yaml');
      await copyFixture('wrong-type.yaml', testConfigPath);
      const readResult = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(readResult.status).toBe('invalid');
      expect(readResult.path).toBeDefined();
    });

    it('should handle malformed YAML', async () => {
      const testConfigPath = path.join(tempDir, 'test_config.yaml');
      await copyFixture('malformed.yaml', testConfigPath);
      const readResult = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(readResult.status).toBe('invalid');
      expect(readResult.path).toBeUndefined();
    });

    it('should handle legacy format config', async () => {
      const legacyConfigPath = path.join(tempDir, 'legacy-format.yaml');
      await copyFixture('legacy-format.yaml', legacyConfigPath);
      const readResult = await ComfyServerConfig.readBasePathFromConfig(legacyConfigPath);
      expect(readResult.status).toBe('success');
      expect(readResult.path).toBe('/old/style/path');
    });

    it('should handle filesystem errors', async () => {
      vi.spyOn(fsPromises, 'readFile').mockRejectedValueOnce(new Error('Disk error'));
      const readResult = await ComfyServerConfig.readBasePathFromConfig('/test/path');
      expect(readResult.status).toBe('error');
      expect(readResult.path).toBeUndefined();
    });
  });

  describe('generateConfigFileContent', () => {
    it('should generate valid YAML with model paths', () => {
      const testModelConfig = {
        comfyui_desktop: {
          base_path: '/test/path',
          checkpoints: '/test/path/models/checkpoints/',
          loras: '/test/path/models/loras/',
        },
      };

      const generatedYaml = ComfyServerConfig.generateConfigFileContent(testModelConfig);

      expect(generatedYaml).toContain(`# ComfyUI extra_model_paths.yaml for ${process.platform}`);
      expect(generatedYaml).toContain('comfyui_desktop:');
      expect(generatedYaml).toContain('  base_path: /test/path');
      expect(generatedYaml).toContain('  checkpoints: /test/path/models/checkpoints/');
      expect(generatedYaml).toContain('  loras: /test/path/models/loras/');
    });

    it.each(['win32', 'darwin', 'linux'] as const)('should include platform-specific header for %s', (platform) => {
      const restorePlatform = stubPlatform(platform);
      try {
        const testConfig = { test: { path: '/test' } };
        const generatedYaml = ComfyServerConfig.generateConfigFileContent(testConfig);
        expect(generatedYaml).toContain(`# ComfyUI extra_model_paths.yaml for ${platform}`);
      } finally {
        restorePlatform();
      }
    });

    it('should handle empty configs', () => {
      const generatedYaml = ComfyServerConfig.generateConfigFileContent({});
      expect(generatedYaml).toContain(`# ComfyUI extra_model_paths.yaml for ${process.platform}`);
      expect(generatedYaml.split('\n')[1]).toBe('{}');
    });
  });

  describe('getBaseModelPathsFromRepoPath', () => {
    it('should generate correct paths for all known model types', () => {
      const repoPath = '/test/repo';
      const modelPaths = ComfyServerConfig.getBaseModelPathsFromRepoPath(repoPath);

      expect(modelPaths.checkpoints).toBe(path.join(repoPath, 'models', 'checkpoints') + path.sep);
      expect(modelPaths.loras).toBe(path.join(repoPath, 'models', 'loras') + path.sep);
      expect(modelPaths.vae).toBe(path.join(repoPath, 'models', 'vae') + path.sep);
      expect(modelPaths.controlnet).toBe(path.join(repoPath, 'models', 'controlnet') + path.sep);

      for (const modelPath of Object.values(modelPaths)) {
        expect(modelPath).toContain(path.join(repoPath, 'models'));
        expect(modelPath.endsWith(path.sep)).toBe(true);
      }
    });

    it('should handle paths with special characters', () => {
      const repoPath = '/test/repo with spaces/and#special@chars';
      const modelPaths = ComfyServerConfig.getBaseModelPathsFromRepoPath(repoPath);

      expect(modelPaths.checkpoints).toBe(path.join(repoPath, 'models', 'checkpoints') + path.sep);
      expect(modelPaths.loras).toBe(path.join(repoPath, 'models', 'loras') + path.sep);
    });

    it('should handle relative paths', () => {
      const repoPath = './relative/path';
      const modelPaths = ComfyServerConfig.getBaseModelPathsFromRepoPath(repoPath);

      expect(modelPaths.checkpoints).toBe(path.join(repoPath, 'models', 'checkpoints') + path.sep);
      expect(modelPaths.loras).toBe(path.join(repoPath, 'models', 'loras') + path.sep);
    });

    it('should handle empty paths', () => {
      const modelPaths = ComfyServerConfig.getBaseModelPathsFromRepoPath('');

      expect(modelPaths.checkpoints).toBe(path.join('models', 'checkpoints') + path.sep);
      expect(modelPaths.loras).toBe(path.join('models', 'loras') + path.sep);
    });
  });

  describe('getBaseConfig', () => {
    it.each(['win32', 'darwin', 'linux'] as const)('should return platform-specific config for %s', (platform) => {
      const restorePlatform = stubPlatform(platform);
      try {
        const platformConfig = ComfyServerConfig.getBaseConfig();

        expect(platformConfig.custom_nodes).toBe('custom_nodes/');
        expect(platformConfig.is_default).toBe('true');
      } finally {
        restorePlatform();
      }
    });

    it('should throw for unknown platforms', () => {
      const restorePlatform = stubPlatform('invalid' as NodeJS.Platform);
      try {
        expect(() => ComfyServerConfig.getBaseConfig()).toThrow('No base config found for invalid');
      } finally {
        restorePlatform();
      }
    });
  });

  describe('readConfigFile', () => {
    it('should handle missing files', async () => {
      const configContent = await ComfyServerConfig.readConfigFile('/non/existent/path.yaml');
      expect(configContent).toBeNull();
    });

    it('should handle invalid YAML', async () => {
      const invalidConfigPath = path.join(tempDir, 'invalid_config.yaml');
      await copyFixture('malformed.yaml', invalidConfigPath);
      const configContent = await ComfyServerConfig.readConfigFile(invalidConfigPath);
      expect(configContent).toBeNull();
    });

    it('should handle multiple sections and special values', async () => {
      const multiSectionConfigPath = path.join(tempDir, 'multiple-sections.yaml');
      await copyFixture('multiple-sections.yaml', multiSectionConfigPath);
      const configContent = await ComfyServerConfig.readConfigFile(multiSectionConfigPath);

      expect(configContent).not.toBeNull();
      expect(configContent!.comfyui_desktop.base_path).toBe('/primary/path');
      expect(configContent!.comfyui_migration.base_path).toBe('/migration/path');
    });
  });

  describe('exists', () => {
    it('should return true when config file exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      expect(ComfyServerConfig.exists()).toBe(true);
    });

    it('should return false when config file does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(ComfyServerConfig.exists()).toBe(false);
    });
  });

  describe('writeConfigFile', () => {
    it('should write config file successfully', async () => {
      const testPath = path.join(tempDir, 'test-write.yaml');
      const result = await ComfyServerConfig.writeConfigFile(testPath, 'test content');
      expect(result).toBe(true);
      const content = await readFile(testPath, 'utf8');
      expect(content).toBe('test content');
    });

    it('should handle write errors', async () => {
      vi.spyOn(fsPromises, 'writeFile').mockRejectedValueOnce(new Error('Write failed'));
      const result = await ComfyServerConfig.writeConfigFile(path.join(path.sep, 'invalid', 'path'), 'test');
      expect(result).toBe(false);
    });
  });

  describe('createConfigFile', () => {
    it('should create config file successfully', async () => {
      const testPath = path.join(tempDir, 'test-create.yaml');
      const testConfig = { test: { path: '/test' } };
      const result = await ComfyServerConfig.createConfigFile(testPath, testConfig);
      expect(result).toBe(true);
      const content = await readFile(testPath, 'utf8');
      expect(content).toContain('test:');
      expect(content).toContain('path: /test');
    });

    it('should handle creation errors', async () => {
      vi.spyOn(ComfyServerConfig, 'writeConfigFile').mockResolvedValueOnce(false);
      const result = await ComfyServerConfig.createConfigFile(path.join(path.sep, 'invalid', 'path'), {});
      expect(result).toBe(false);
    });

    it('should handle YAML generation errors', async () => {
      vi.spyOn(ComfyServerConfig, 'generateConfigFileContent').mockImplementationOnce(() => {
        throw new Error('YAML generation failed');
      });

      const result = await ComfyServerConfig.createConfigFile(path.join(path.sep, 'test', 'path'), {});

      expect(log.default.error).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('getConfigFromRepoPath', () => {
    it('should read config from repo path', async () => {
      const testConfig: Record<string, { path: string }> = { test: { path: `${path.sep}test` } };
      const mockReadConfigFile = vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(testConfig);
      const result = await ComfyServerConfig.getConfigFromRepoPath(path.join(path.sep, 'test', 'repo'));
      expect(result).toEqual(testConfig);
      expect(mockReadConfigFile).toHaveBeenCalledWith(path.join(path.sep, 'test', 'repo', 'extra_model_paths.yaml'));
    });

    it('should return empty object when config read fails', async () => {
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(null);
      const result = await ComfyServerConfig.getConfigFromRepoPath(path.join(path.sep, 'test', 'repo'));
      expect(result).toEqual({});
    });
  });

  describe('addAppBundledCustomNodesToConfig', () => {
    it('should add desktop_extensions when not present', async () => {
      const mockConfig = {
        comfyui_desktop: { base_path: '/test/path' },
      };
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(mockConfig);
      const writeConfigSpy = vi.spyOn(ComfyServerConfig, 'writeConfigFile').mockResolvedValueOnce(true);

      await ComfyServerConfig.addAppBundledCustomNodesToConfig();

      expect(writeConfigSpy).toHaveBeenCalledWith(
        ComfyServerConfig.configPath,
        expect.stringContaining('desktop_extensions:')
      );
      expect(writeConfigSpy).toHaveBeenCalledWith(
        ComfyServerConfig.configPath,
        expect.stringContaining(path.normalize('/mocked/app_resources/ComfyUI/custom_nodes'))
      );
    });

    it('should not modify config when desktop_extensions already exists', async () => {
      const mockConfig = {
        comfyui_desktop: { base_path: '/test/path' },
        desktop_extensions: { custom_nodes: '/existing/path' },
      };
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(mockConfig);
      const writeConfigSpy = vi.spyOn(ComfyServerConfig, 'writeConfigFile');

      await ComfyServerConfig.addAppBundledCustomNodesToConfig();

      expect(writeConfigSpy).not.toHaveBeenCalled();
    });

    it('should handle config read failure', async () => {
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(null);
      const writeConfigSpy = vi.spyOn(ComfyServerConfig, 'writeConfigFile');

      await ComfyServerConfig.addAppBundledCustomNodesToConfig();

      expect(writeConfigSpy).not.toHaveBeenCalled();
      expect(log.default.error).toHaveBeenCalledWith('Failed to read config file');
    });
  });

  describe('setBasePathInDefaultConfig', () => {
    it('should create new config file when none exists', async () => {
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(null);
      const createConfigSpy = vi.spyOn(ComfyServerConfig, 'createConfigFile').mockResolvedValueOnce(true);

      const result = await ComfyServerConfig.setBasePathInDefaultConfig('/new/base/path');

      expect(result).toBe(true);
      expect(createConfigSpy).toHaveBeenCalledWith(
        ComfyServerConfig.configPath,
        expect.objectContaining({
          comfyui_desktop: expect.objectContaining({
            base_path: '/new/base/path',
          }),
        })
      );
    });

    it('should update existing config file with new base path', async () => {
      const existingConfig = {
        comfyui_desktop: {
          base_path: '/old/path',
          custom_nodes: 'custom_nodes/',
        },
      };
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(existingConfig);
      const writeConfigSpy = vi.spyOn(ComfyServerConfig, 'writeConfigFile').mockResolvedValueOnce(true);

      const result = await ComfyServerConfig.setBasePathInDefaultConfig('/new/base/path');

      expect(result).toBe(true);
      expect(writeConfigSpy).toHaveBeenCalledWith(
        ComfyServerConfig.configPath,
        expect.stringContaining('/new/base/path')
      );
    });

    it('should create comfyui_desktop section if not present', async () => {
      const existingConfig = {};
      vi.spyOn(ComfyServerConfig, 'readConfigFile').mockResolvedValueOnce(existingConfig);
      const writeConfigSpy = vi.spyOn(ComfyServerConfig, 'writeConfigFile').mockResolvedValueOnce(true);

      const result = await ComfyServerConfig.setBasePathInDefaultConfig('/new/base/path');

      expect(result).toBe(true);
      expect(writeConfigSpy).toHaveBeenCalledWith(
        ComfyServerConfig.configPath,
        expect.stringContaining('comfyui_desktop:')
      );
    });
  });
});
