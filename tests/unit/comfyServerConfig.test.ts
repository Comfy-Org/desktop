import { app } from 'electron';
import path from 'node:path';
import { ComfyServerConfig } from '../../src/config/comfyServerConfig';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/fake/user/data'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

async function createTmpDir() {
  const prefix = path.join(tmpdir(), 'vitest-');
  return await mkdtemp(prefix);
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

      // Create a test YAML file
      const testConfig = `# Test ComfyUI config
comfyui:
  base_path: ~/test/comfyui
  is_default: true
  checkpoints: models/checkpoints/
  loras: models/loras/`;

      await writeFile(testConfigPath, testConfig, 'utf8');
    });

    afterAll(async () => {
      await rm(tmpdir, { recursive: true });
    });

    it('should read base_path from valid config file', async () => {
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result.status).toBe('success');
      expect(result.path).toBe('~/test/comfyui');
    });

    it('should detect non-existent file', async () => {
      const result = await ComfyServerConfig.readBasePathFromConfig('non_existent_file.yaml');
      expect(result.status).toBe('notFound');
      expect(result.path).toBeUndefined();
    });

    it('should detect invalid config file', async () => {
      const invalidConfigPath = path.join(tmpdir, 'invalid_config.yaml');
      await writeFile(invalidConfigPath, 'invalid: yaml: content:', 'utf8');

      const result = await ComfyServerConfig.readBasePathFromConfig(invalidConfigPath);
      expect(result.status).toBe('invalid');
      expect(result.path).toBeUndefined();

      await rm(invalidConfigPath);
    });
  });
});
