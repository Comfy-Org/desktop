import * as fsPromises from 'node:fs/promises';
import log from 'electron-log/main';
import { stringify, parse } from 'yaml';
import path from 'node:path';
import { app } from 'electron';

interface ModelPaths {
  comfyui: {
    base_path: string;
    is_default: boolean;
    [key: string]: string | boolean;
  };
}

export class ComfyServerConfig {
  private static readonly EXTRA_MODEL_CONFIG_PATH = 'extra_models_config.yaml';

  private static readonly commonPaths = {
    is_default: true,
    checkpoints: 'models/checkpoints/',
    classifiers: 'models/classifiers/',
    clip: 'models/clip/',
    clip_vision: 'models/clip_vision/',
    configs: 'models/configs/',
    controlnet: 'models/controlnet/',
    diffusers: 'models/diffusers/',
    diffusion_models: 'models/diffusion_models/',
    embeddings: 'models/embeddings/',
    gligen: 'models/gligen/',
    hypernetworks: 'models/hypernetworks/',
    loras: 'models/loras/',
    photomaker: 'models/photomaker/',
    style_models: 'models/style_models/',
    unet: 'models/unet/',
    upscale_models: 'models/upscale_models/',
    vae: 'models/vae/',
    vae_approx: 'models/vae_approx/',
    // TODO(robinhuang): Remove when we have a better way to specify base model paths.
    animatediff_models: 'models/animatediff_models/',
    animatediff_motion_lora: 'models/animatediff_motion_lora/',
    animatediff_video_formats: 'models/animatediff_video_formats/',
    ipadapter: 'models/ipadapter/',
    liveportrait: 'models/liveportrait/',
    insightface: 'models/insightface/',
    layerstyle: 'models/layerstyle/',
    LLM: 'models/LLM/',
    Joy_caption: 'models/Joy_caption/',
    sams: 'models/sams/',
    blip: 'models/blip/',
    CogVideo: 'models/CogVideo/',
    xlabs: 'models/xlabs/',
    instantid: 'models/instantid/',
    // End custom node model directories.
    custom_nodes: 'custom_nodes/',
  } as const;

  private static readonly configTemplates: Record<string, ModelPaths> = {
    win32: {
      comfyui: {
        base_path: '%USERPROFILE%/comfyui-electron',
        ...this.commonPaths,
      },
    },
    darwin: {
      comfyui: {
        base_path: '~/Library/Application Support/ComfyUI',
        ...this.commonPaths,
      },
    },
    linux: {
      comfyui: {
        base_path: '~/.config/ComfyUI',
        ...this.commonPaths,
      },
    },
  } as const;

  /**
   * The path to the extra_models_config.yaml file. The config file is used for ComfyUI core to determine search paths
   * for models and custom nodes.
   */
  public static readonly configPath: string = path.join(
    app.getPath('userData'),
    ComfyServerConfig.EXTRA_MODEL_CONFIG_PATH
  );

  public static async createModelConfigFiles(extraModelConfigPath: string, customBasePath?: string): Promise<boolean> {
    log.info(`Creating model config files in ${extraModelConfigPath} with base path ${customBasePath}`);
    try {
      for (const [platform, config] of Object.entries(this.configTemplates)) {
        if (platform !== process.platform) {
          continue;
        }

        log.info(`Creating model config files for ${platform}`);

        if (customBasePath) {
          config.comfyui.base_path = customBasePath;
        }

        const yamlContent = stringify(config, { lineWidth: -1 });
        const fileContent = `# ComfyUI extra_model_paths.yaml for ${platform}\n${yamlContent}`;
        await fsPromises.writeFile(extraModelConfigPath, fileContent, 'utf8');
        log.info(`Created extra_model_paths.yaml at ${extraModelConfigPath}`);
        return true;
      }
      log.info(`No model config files created for platform ${process.platform}`);
      return false;
    } catch (error) {
      log.error('Error creating model config files:', error);
      return false;
    }
  }

  public static async readBasePathFromConfig(configPath: string): Promise<string | null> {
    try {
      const fileContent = await fsPromises.readFile(configPath, 'utf8');
      const config = parse(fileContent);

      if (config?.comfyui?.base_path) {
        return config.comfyui.base_path;
      }

      log.warn(`No base_path found in ${configPath}`);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`Config file not found at ${configPath}`);
      } else {
        log.error(`Error reading config file ${configPath}:`, error);
      }
      return null;
    }
  }
}
