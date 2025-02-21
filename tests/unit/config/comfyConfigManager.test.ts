import log from 'electron-log/main';
import fs, { type PathLike } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyConfigManager, DirectoryStructure } from '@/config/comfyConfigManager';

// Workaround for mock impls.
const { normalize } = path;

// Mock the fs module
vi.mock('node:fs');

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
    it('should allow existing directory when it contains ComfyUI structure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(() => ComfyConfigManager.createComfyDirectories(path.normalize('/existing/ComfyUI'))).not.toThrow();
    });

    it('should create ComfyUI subdirectory when it is missing', () => {
      vi.mocked(fs.existsSync).mockImplementationOnce((path: PathLike) => {
        if ([normalize('/some/base/path/ComfyUI')].includes(path.toString())) {
          return false;
        }
        return true;
      });

      ComfyConfigManager.createComfyDirectories(path.normalize('/some/base/path/ComfyUI'));
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

    it('should create full directory structure including all model subdirectories', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ComfyConfigManager.createComfyDirectories('/fake/path/ComfyUI');

      // Verify model subdirectories are created
      const expectedModelDirs = [
        'checkpoints',
        'clip',
        'clip_vision',
        'configs',
        'controlnet',
        'diffusers',
        'diffusion_models',
        'embeddings',
        'gligen',
        'hypernetworks',
        'loras',
        'photomaker',
        'style_models',
        'unet',
        'upscale_models',
        'vae',
        'vae_approx',
        'animatediff_models',
        'animatediff_motion_lora',
        'animatediff_video_formats',
        'liveportrait',
        'CogVideo',
        'layerstyle',
        'LLM',
        'Joy_caption',
      ];

      for (const dir of expectedModelDirs) {
        expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize(`/fake/path/ComfyUI/models/${dir}`), {
          recursive: true,
        });
      }

      // Verify nested subdirectories
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/user/default'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/models/insightface/buffalo_1'), {
        recursive: true,
      });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/models/blip/checkpoints'), {
        recursive: true,
      });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/models/xlabs/loras'), {
        recursive: true,
      });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize('/fake/path/ComfyUI/models/xlabs/controlnets'), {
        recursive: true,
      });
    });

    it('should catch and log errors when creating directories', () => {
      vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      ComfyConfigManager.createComfyDirectories('/fake/path/ComfyUI');

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(log.default.error).toHaveBeenCalledWith('Failed to create ComfyUI directories:', expect.any(Error));
    });
  });

  describe('createNestedDirectories', () => {
    it('should create nested directory structure correctly', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const structure = ['dir1', ['dir2', ['subdir1', 'subdir2']], ['dir3', [['subdir3', ['subsubdir1']]]]];

      ComfyConfigManager.createNestedDirectories('/fake/path', structure);

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

      ComfyConfigManager.createNestedDirectories('/fake/path', invalidStructure as DirectoryStructure);

      // Verify only valid directories were created
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('dir1'), expect.any(Object));
      expect(fs.mkdirSync).not.toHaveBeenCalledWith(expect.stringContaining('subdir1'), expect.any(Object));
    });
  });

  describe('createDirIfNotExists', () => {
    it('should create directory when it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      ComfyConfigManager.createDirIfNotExists('/fake/path/newdir');

      expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/path/newdir', { recursive: true });
    });

    it('should not create directory when it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      ComfyConfigManager.createDirIfNotExists('/fake/path/existingdir');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
