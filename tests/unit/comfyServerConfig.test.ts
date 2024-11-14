// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/fake/user/data'),
  },
}));

import { app } from 'electron';
import path from 'path';
import { ComfyServerConfig } from '../../src/config/comfyServerConfig';
import * as fsPromises from 'node:fs/promises';

describe('ComfyServerConfig', () => {
  describe('configPath', () => {
    it('should return the correct path', () => {
      // Mock the userData path
      const mockUserDataPath = '/fake/user/data';
      (app.getPath as jest.Mock).mockImplementation((key: string) => {
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
    const testConfigPath = path.join(__dirname, 'test_config.yaml');

    beforeAll(async () => {
      // Create a test YAML file
      const testConfig = `# Test ComfyUI config
comfyui:
  base_path: ~/test/comfyui
  is_default: true
  checkpoints: models/checkpoints/
  loras: models/loras/`;

      await fsPromises.writeFile(testConfigPath, testConfig, 'utf8');
    });

    afterAll(async () => {
      await fsPromises.rm(testConfigPath);
    });

    it('should read base_path from valid config file', async () => {
      const result = await ComfyServerConfig.readBasePathFromConfig(testConfigPath);
      expect(result).toBe('~/test/comfyui');
    });

    it('should return null for non-existent file', async () => {
      const result = await ComfyServerConfig.readBasePathFromConfig('non_existent_file.yaml');
      expect(result).toBeNull();
    });

    it('should return null for invalid config file', async () => {
      const invalidConfigPath = path.join(__dirname, 'invalid_config.yaml');
      await fsPromises.writeFile(invalidConfigPath, 'invalid: yaml: content:', 'utf8');

      const result = await ComfyServerConfig.readBasePathFromConfig(invalidConfigPath);
      expect(result).toBeNull();

      await fsPromises.rm(invalidConfigPath);
    });
  });
});
