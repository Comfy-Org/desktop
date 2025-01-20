import { app } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ComfyServerConfig } from '../../src/config/comfyServerConfig';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/fake/user/data'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function createTmpDir() {
  const prefix = path.join(tmpdir(), 'vitest-');
  return mkdtemp(prefix);
}

async function copyFixture(fixturePath: string, targetPath: string) {
  const content = await readFile(path.join('tests/assets/extra_models_paths', fixturePath), 'utf8');
  await writeFile(targetPath, content, 'utf8');
}

describe('ComfyServerConfig', () => {
  let tempDir = '';
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  beforeAll(async () => {
    tempDir = await createTmpDir();
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = originalEnv;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('configPath', () => {
    it('should return the correct path', () => {
      const mockUserDataPath = '/fake/user/data';
      const { getPath } = app;
      vi.mocked(getPath).mockImplementation((key: string) => {
        if (key === 'userData') {
          return mockUserDataPath;
        }
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
      Object.defineProperty(process, 'platform', { value: platform });
      const testConfig = { test: { path: '/test' } };
      const generatedYaml = ComfyServerConfig.generateConfigFileContent(testConfig);
      expect(generatedYaml).toContain(`# ComfyUI extra_model_paths.yaml for ${platform}`);
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
      Object.defineProperty(process, 'platform', { value: platform });
      const platformConfig = ComfyServerConfig.getBaseConfig();

      expect(platformConfig.checkpoints).toContain('models/checkpoints');
      expect(platformConfig.loras).toContain('models/loras');
      expect(platformConfig.custom_nodes).toBe('custom_nodes/');
      expect(platformConfig.is_default).toBe('true');
    });

    it('should throw for unknown platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'invalid' });
      expect(() => ComfyServerConfig.getBaseConfig()).toThrow('No base config found for invalid');
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
});
