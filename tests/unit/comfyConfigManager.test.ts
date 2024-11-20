import fs from 'fs';
import { ComfyConfigManager, DirectoryStructure } from '../../src/config/comfyConfigManager';

// Mock the fs module
jest.mock('fs');
jest.mock('electron-log/main', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('ComfyConfigManager', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReset();
    (fs.mkdirSync as jest.Mock).mockReset();
    (fs.writeFileSync as jest.Mock).mockReset();
    (fs.renameSync as jest.Mock).mockReset();
  });

  describe('setUpComfyUI', () => {
    it('should reject existing directory when it contains ComfyUI structure', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(() => ComfyConfigManager.setUpComfyUI('/existing/ComfyUI')).toThrow();
    });

    it('should create ComfyUI subdirectory when it is missing', () => {
      (fs.existsSync as jest.Mock).mockImplementationOnce((path: string) => {
        if (['/some/base/path/ComfyUI'].includes(path)) {
          return false;
        }
        return true;
      });

      ComfyConfigManager.setUpComfyUI('/some/base/path/ComfyUI');
    });
  });

  describe('isComfyUIDirectory', () => {
    it('should return true when all required directories exist', () => {
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        const requiredDirs = [
          '/fake/path/models',
          '/fake/path/input',
          '/fake/path/user',
          '/fake/path/output',
          '/fake/path/custom_nodes',
        ];
        return requiredDirs.includes(path);
      });

      const result = ComfyConfigManager.isComfyUIDirectory('/fake/path');

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledTimes(5);
    });

    it('should return false when some required directories are missing', () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true) // models exists
        .mockReturnValueOnce(true) // input exists
        .mockReturnValueOnce(false) // user missing
        .mockReturnValueOnce(true) // output exists
        .mockReturnValueOnce(true); // custom_nodes exists

      const result = ComfyConfigManager.isComfyUIDirectory('/fake/path');

      expect(result).toBe(false);
    });
  });

  describe('createComfyDirectories', () => {
    it('should create all necessary directories when none exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      ComfyConfigManager.createComfyDirectories('/fake/path/ComfyUI');

      // Verify each required directory was created
      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/ComfyUI/models', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/ComfyUI/input', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/ComfyUI/user', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/ComfyUI/output', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/ComfyUI/custom_nodes', { recursive: true });
    });
  });

  describe('createNestedDirectories', () => {
    it('should create nested directory structure correctly', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const structure = ['dir1', ['dir2', ['subdir1', 'subdir2']], ['dir3', [['subdir3', ['subsubdir1']]]]];

      ComfyConfigManager['createNestedDirectories']('/fake/path', structure);

      // Verify the correct paths were created
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('dir1'), expect.any(Object));
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('dir2'), expect.any(Object));
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('subdir1'), expect.any(Object));
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('subsubdir1'), expect.any(Object));
    });

    it('should handle invalid directory structure items', () => {
      const invalidStructure = [
        'dir1',
        ['dir2'], // Invalid: array with only one item
        [123, ['subdir1']], // Invalid: non-string directory name
      ];

      ComfyConfigManager['createNestedDirectories']('/fake/path', invalidStructure as DirectoryStructure);

      // Verify only valid directories were created
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('dir1'), expect.any(Object));
      expect(fs.mkdirSync).not.toHaveBeenCalledWith(expect.stringContaining('subdir1'), expect.any(Object));
    });
  });
});
