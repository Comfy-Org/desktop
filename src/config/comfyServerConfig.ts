import * as fsPromises from 'node:fs/promises';
import log from 'electron-log/main';
import yaml from 'yaml';
import path from 'node:path';
import { app } from 'electron';

interface ModelPaths {
  comfyui: {
    base_path: string;
    is_default: boolean;
    [key: string]: string | boolean;
  };
}

/**
 * The ComfyServerConfig class is used to manage the configuration for the ComfyUI server.
 */
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

  /**
   * Get the base config for the current operating system.
   */
  public static getBaseConfig(): ModelPaths | null {
    for (const [operatingSystem, modelPathConfig] of Object.entries(this.configTemplates)) {
      if (operatingSystem === process.platform) {
        return modelPathConfig;
      }
    }
    return null;
  }
  /**
   * Generate the content for the extra_model_paths.yaml file.
   */
  private static generateConfigFileContent(modelPathConfig: ModelPaths): string {
    const modelConfigYaml = yaml.stringify(modelPathConfig, { lineWidth: -1 });
    return `# ComfyUI extra_model_paths.yaml for ${process.platform}\n${modelConfigYaml}`;
  }

  private static mergeConfig(baseConfig: ModelPaths, customConfig: ModelPaths): ModelPaths {
    return {
      ...baseConfig,
      comfyui: {
        ...baseConfig.comfyui,
        ...customConfig.comfyui,
      },
    };
  }

  private static async writeConfigFile(configFilePath: string, content: string): Promise<boolean> {
    try {
      await fsPromises.writeFile(configFilePath, content, 'utf8');
      log.info(`Created extra_model_paths.yaml at ${configFilePath}`);
      return true;
    } catch (error) {
      log.error('Error writing config file:', error);
      return false;
    }
  }

  /**
   * Create the extra_model_paths.yaml file in the given destination path with the given custom config.
   */
  public static async createConfigFile(destinationPath: string, customConfig: ModelPaths): Promise<boolean> {
    log.info(`Creating model config files in ${destinationPath}`);
    try {
      const baseConfig = this.getBaseConfig();
      if (!baseConfig) {
        log.error('No base config found');
        return false;
      }
      const configContent = this.generateConfigFileContent(this.mergeConfig(baseConfig, customConfig));
      return await this.writeConfigFile(destinationPath, configContent);
    } catch (error) {
      log.error('Error creating model config files:', error);
      return false;
    }
  }

  public static async readBasePathFromConfig(configPath: string): Promise<string | null> {
    try {
      const fileContent = await fsPromises.readFile(configPath, 'utf8');
      const config = yaml.parse(fileContent);

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
