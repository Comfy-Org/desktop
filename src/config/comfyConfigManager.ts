import fs from 'fs';
import path from 'path';
import log from 'electron-log/main';

export type DirectoryStructure = (string | DirectoryStructure)[];

export class ComfyConfigManager {
  private static readonly DEFAULT_DIRECTORIES: DirectoryStructure = [
    'custom_nodes',
    'input',
    'output',
    ['user', ['default']],
    [
      'models',
      [
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

        // TODO(robinhuang): Remove when we have a better way to specify base model paths.
        'animatediff_models',
        'animatediff_motion_lora',
        'animatediff_video_formats',
        'liveportrait',
        ['insightface', ['buffalo_1']],
        ['blip', ['checkpoints']],
        'CogVideo',
        ['xlabs', ['loras', 'controlnets']],
        'layerstyle',
        'LLM',
        'Joy_caption',
      ],
    ],
  ];

  public static setUpComfyUI(localComfyDirectory: string) {
    if (fs.existsSync(localComfyDirectory)) {
      throw new Error(`Selected directory ${localComfyDirectory} already exists`);
    }
    this.createComfyDirectories(localComfyDirectory);
  }

  public static isComfyUIDirectory(directory: string): boolean {
    const requiredSubdirs = ['models', 'input', 'user', 'output', 'custom_nodes'];
    return requiredSubdirs.every((subdir) => fs.existsSync(path.join(directory, subdir)));
  }

  static createComfyDirectories(localComfyDirectory: string): void {
    log.info(`Creating ComfyUI directories in ${localComfyDirectory}`);

    try {
      this.createNestedDirectories(localComfyDirectory, this.DEFAULT_DIRECTORIES);
    } catch (error) {
      log.error(`Failed to create ComfyUI directories: ${error}`);
    }
  }

  static createNestedDirectories(basePath: string, structure: DirectoryStructure): void {
    structure.forEach((item) => {
      if (typeof item === 'string') {
        const dirPath = path.join(basePath, item);
        this.createDirIfNotExists(dirPath);
      } else if (Array.isArray(item) && item.length === 2) {
        const [dirName, subDirs] = item;
        if (typeof dirName === 'string') {
          const newBasePath = path.join(basePath, dirName);
          this.createDirIfNotExists(newBasePath);
          if (Array.isArray(subDirs)) {
            this.createNestedDirectories(newBasePath, subDirs);
          }
        } else {
          log.warn(`Invalid directory structure item: ${JSON.stringify(item)}`);
        }
      } else {
        log.warn(`Invalid directory structure item: ${JSON.stringify(item)}`);
      }
    });
  }

  /**
   * Create a directory if not exists
   * @param dirPath
   */
  static createDirIfNotExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      log.info(`Created directory: ${dirPath}`);
    } else {
      log.info(`Directory already exists: ${dirPath}`);
    }
  }
}
