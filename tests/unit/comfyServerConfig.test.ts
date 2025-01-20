import { app } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  return await mkdtemp(prefix);
}

async function copyFixture(fixturePath: string, targetPath: string) {
  const content = await readFile(path.join('tests/assets/extra_models_paths', fixturePath), 'utf8');
  await writeFile(targetPath, content, 'utf8');
}

describe('ComfyServerConfig', () => {
  describe('configPath', () => {
    it('should return the correct path', () => {
      // Mock the userData path
      const mockUserDataPath = '/fake/user/data';
      vi.mocked(app.getPath).mockImplementation((key: string) => {
        if (key === 'userData') {
          return mockUserDataPath;
        }
        throw new Error(`Unexpected getPath key: ${key}`);
      });

      // Access the static property
      const result = ComfyServerConfig.configPath;

      // Verify the path is correctly joined
      expect(result).toBe(path.join(mockUserDataPath, 'extra_models_config.yaml'));

      // Verify app.getPath was called with correct argument
      expect(app.getPath).toHaveBeenCalledWith('userData');
    });
  });

  describe('readBasePathFromConfig', () => {
    let tmpdir = '';
    let testConfigPath = '';

    beforeAll(async () => {
      tmpdir = await createTmpDir();
      testConfigPath = path.join(tmpdir, 'test_config.yaml');
    });

    afterAll(async () => {
      await rm(tmpdir, { recursive: true });
    });

    it('should read base_path from valid config file', async () => {
      await copyFixture('valid-config.yaml', testConfigPath);
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result.status).toBe('success');
      expect(result.path).toBe('/test/path');
    });

    it('should detect non-existent file', async () => {
      const result = await ComfyServerConfig.readBasePathFromConfig('non_existent_file.yaml');
      expect(result.status).toBe('notFound');
      expect(result.path).toBeUndefined();
    });

    it('should handle missing base path', async () => {
      await copyFixture('missing-base-path.yaml', testConfigPath);
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result.status).toBe('invalid');
      expect(result.path).toBeUndefined();
    });

    it('should handle wrong base path type', async () => {
      await copyFixture('wrong-type.yaml', testConfigPath);
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result.status).toBe('invalid');
      expect(result.path).toBeDefined();
    });

    it('should handle malformed YAML', async () => {
      await copyFixture('malformed.yaml', testConfigPath);
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result.status).toBe('invalid');
      expect(result.path).toBeUndefined();
    });
  });

  describe('generateConfigFileContent', () => {
    const originalPlatform = process.platform;

    afterAll(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should generate valid YAML with model paths', () => {
      const testConfig = {
        comfyui_desktop: {
          base_path: '/test/path',
          checkpoints: '/test/path/models/checkpoints/',
          loras: '/test/path/models/loras/',
        },
      };

      const result = ComfyServerConfig.generateConfigFileContent(testConfig);

      expect(result).toContain(`# ComfyUI extra_model_paths.yaml for ${process.platform}`);
      expect(result).toContain('comfyui_desktop:');
      expect(result).toContain('  base_path: /test/path');
      expect(result).toContain('  checkpoints: /test/path/models/checkpoints/');
      expect(result).toContain('  loras: /test/path/models/loras/');
    });

    it.each(['win32', 'darwin', 'linux'] as const)('should include platform-specific header for %s', (platform) => {
      Object.defineProperty(process, 'platform', { value: platform });
      const testConfig = { test: { path: '/test' } };
      const result = ComfyServerConfig.generateConfigFileContent(testConfig);
      expect(result).toContain(`# ComfyUI extra_model_paths.yaml for ${platform}`);
    });

    it('should handle empty configs', () => {
      const result = ComfyServerConfig.generateConfigFileContent({});
      expect(result).toContain(`# ComfyUI extra_model_paths.yaml for ${process.platform}`);
      // The rest should just be an empty object
      expect(result.split('\n')[1]).toBe('{}');
    });
  });

  describe('getBaseModelPathsFromRepoPath', () => {
    it('should generate correct paths for all known model types', () => {
      const repoPath = '/test/repo';
      const result = ComfyServerConfig.getBaseModelPathsFromRepoPath(repoPath);

      expect(result.checkpoints).toBe(path.join(repoPath, 'models', 'checkpoints') + path.sep);
      expect(result.loras).toBe(path.join(repoPath, 'models', 'loras') + path.sep);
      expect(result.vae).toBe(path.join(repoPath, 'models', 'vae') + path.sep);
      expect(result.controlnet).toBe(path.join(repoPath, 'models', 'controlnet') + path.sep);

      for (const modelPath of Object.values(result)) {
        expect(modelPath).toContain(path.join(repoPath, 'models'));
        expect(modelPath.endsWith(path.sep)).toBe(true);
      }
    });

    it('should handle empty repo path', () => {
      const result = ComfyServerConfig.getBaseModelPathsFromRepoPath('');

      // Paths should be relative to models directory
      expect(result.checkpoints).toBe(path.join('models', 'checkpoints') + path.sep);
      expect(result.loras).toBe(path.join('models', 'loras') + path.sep);
    });
  });

  describe('getBaseConfig', () => {
    const originalPlatform = process.platform;

    afterAll(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it.each([
      {
        platform: 'win32',
      },
      {
        platform: 'darwin',
      },
      {
        platform: 'linux',
      },
    ])('should return platform-specific config for $platform', ({ platform }) => {
      Object.defineProperty(process, 'platform', { value: platform });
      const result = ComfyServerConfig.getBaseConfig();

      // All platforms should have these common paths
      expect(result.checkpoints).toContain('models/checkpoints');
      expect(result.loras).toContain('models/loras');
      expect(result.custom_nodes).toBe('custom_nodes/');
      expect(result.is_default).toBe('true');
    });

    it('should throw for unknown platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'invalid' });
      expect(() => ComfyServerConfig.getBaseConfig()).toThrow('No base config found for invalid');
    });
  });

  describe('readConfigFile', () => {
    let tmpdir = '';
    const originalPlatform = process.platform;

    beforeAll(async () => {
      tmpdir = await createTmpDir();
    });

    afterAll(async () => {
      await rm(tmpdir, { recursive: true });
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle missing files', async () => {
      const result = await ComfyServerConfig.readConfigFile('/non/existent/path.yaml');
      expect(result).toBeNull();
    });

    it('should handle invalid YAML', async () => {
      const configPath = path.join(tmpdir, 'invalid_config.yaml');
      await copyFixture('malformed.yaml', configPath);
      const result = await ComfyServerConfig.readConfigFile(configPath);
      expect(result).toBeNull();
    });
  });

  describe('readConfigFile edge cases', () => {
    let tmpdir = '';
    const originalPlatform = process.platform;
    const originalEnv = process.env;

    beforeAll(async () => {
      tmpdir = await createTmpDir();
    });

    afterAll(async () => {
      await rm(tmpdir, { recursive: true });
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = originalEnv;
    });

    it('should handle legacy format config', async () => {
      const configPath = path.join(tmpdir, 'legacy-format.yaml');
      await copyFixture('legacy-format.yaml', configPath);
      const result = await ComfyServerConfig.readBasePathFromConfig(configPath);

      expect(result.status).toBe('success');
      expect(result.path).toBe('/old/style/path');
    });

    it('should handle multiple sections and special values', async () => {
      const configPath = path.join(tmpdir, 'multiple-sections.yaml');
      await copyFixture('multiple-sections.yaml', configPath);
      const result = await ComfyServerConfig.readConfigFile(configPath);

      expect(result).not.toBeNull();
      expect(result!.comfyui_desktop.base_path).toBe('/primary/path');
      expect(result!.comfyui_migration.base_path).toBe('/migration/path');
    });
  });
});
