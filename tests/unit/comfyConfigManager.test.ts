import fs, { type PathLike } from 'node:fs';
import { ComfyConfigManager, DirectoryStructure } from '../../src/config/comfyConfigManager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

// Workaround for mock impls.
const { normalize } = path;

// Mock the fs module
vi.mock('node:fs');
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('ComfyConfigManager', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.renameSync).mockReset();
  });

  describe('setUpComfyUI', () => {
    it('should reject existing directory when it contains ComfyUI structure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(() => ComfyConfigManager.setUpComfyUI(path.normalize('/existing/ComfyUI'))).toThrow();
    });

    it('should create ComfyUI subdirectory when it is missing', () => {
      vi.mocked(fs.existsSync).mockImplementationOnce((path: PathLike) => {
        if ([normalize('/some/base/path/ComfyUI')].includes(path.toString())) {
          return false;
        }
        return true;
      });

      ComfyConfigManager.setUpComfyUI(path.normalize('/some/base/path/ComfyUI'));
    });
  });

  describe('isComfyUIDirectory', () => {
    it('should return true when all required directories exist', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: PathLike) => {
        const requiredDirs = [
          normalize('/fake/path/models'),
          normalize('/fake/path/input'),
          normalize('/fake/path/user'),
          normalize('/fake/path/output'),
          normalize('/fake/path/custom_nodes'),
        ];
        return requiredDirs.includes(path.toString());
      });

      const result = ComfyConfigManager.isComfyUIDirectory('/fake/path');

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledTimes(5);
    });

    it('should return false when some required directories are missing', () => {
      vi.mocked(fs.existsSync)
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
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ComfyConfigManager.createComfyDirectories('/fake/path/ComfyUI');

      // Verify each required directory was created
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/models'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/input'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/user'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/output'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/custom_nodes'), { recursive: true });
    });
  });

  describe('createNestedDirectories', () => {
    it('should create nested directory structure correctly', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

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
