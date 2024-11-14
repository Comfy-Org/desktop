import * as fsPromises from 'node:fs/promises';
import log from 'electron-log/main';
import yaml from 'yaml';
import path from 'node:path';
import { app } from 'electron';

const knownModelKeys = [
  'checkpoints',
  'classifiers',
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
  'ipadapter',
  'liveportrait',
  'insightface',
  'layerstyle',
  'LLM',
  'Joy_caption',
  'sams',
  'blip',
  'CogVideo',
  'xlabs',
  'instantid',
  'custom_nodes',
] as const;

const commonPaths = knownModelKeys.reduce(
  (acc, key) => {
    acc[key] = `models/${key}/`;
    return acc;
  },
  {} as Record<string, string>
);

type ModelPaths = {
  base_path: string;
  [key: string]: string;
};

/**
 * The ComfyServerConfig class is used to manage the configuration for the ComfyUI server.
 */
export class ComfyServerConfig {
  private static readonly EXTRA_MODEL_CONFIG_PATH = 'extra_models_config.yaml';

  private static readonly configTemplates: Record<string, ModelPaths> = {
    win32: {
      base_path: '%USERPROFILE%/comfyui-electron',
      ...commonPaths,
    },
    darwin: {
      base_path: '~/Library/Application Support/ComfyUI',
      ...commonPaths,
    },
    linux: {
      base_path: '~/.config/ComfyUI',
      ...commonPaths,
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
  static getBaseConfig(): ModelPaths | null {
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
  static generateConfigFileContent(modelPathConfig: ModelPaths): string {
    const modelConfigYaml = yaml.stringify({ comfyui: modelPathConfig }, { lineWidth: -1 });
    return `# ComfyUI extra_model_paths.yaml for ${process.platform}\n${modelConfigYaml}`;
  }

  static mergeConfig(baseConfig: ModelPaths, customConfig: ModelPaths): ModelPaths {
    const mergedConfig: ModelPaths = { ...baseConfig };

    for (const [key, customPath] of Object.entries(customConfig)) {
      if (key in baseConfig) {
        // Concatenate paths if key exists in both configs
        // Order here matters, as ComfyUI searches for models in the order they are listed.
        mergedConfig[key] = baseConfig[key] + '\n' + customPath;
      } else {
        // Use custom path directly if key only exists in custom config
        mergedConfig[key] = customPath;
      }
    }

    return mergedConfig;
  }

  static async writeConfigFile(configFilePath: string, content: string): Promise<boolean> {
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
