import * as fs from 'node:fs';
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
] as const;

export type ModelPaths = Record<string, string>;

/**
 * The ComfyServerConfig class is used to manage the configuration for the ComfyUI server.
 */
export class ComfyServerConfig {
  // The name of the default config file.
  static readonly COMFYUI_DEFAULT_CONFIG_NAME = 'extra_model_paths.yaml';
  // The path to the extra_models_config.yaml file used by the Electron desktop app.
  static readonly EXTRA_MODEL_CONFIG_PATH = 'extra_models_config.yaml';

  private static readonly commonPaths = {
    ...this.getBaseModelPathsFromRepoPath(''),
    custom_nodes: 'custom_nodes/',
  };
  private static readonly configTemplates: Record<string, ModelPaths> = {
    win32: {
      is_default: 'true',
      ...this.commonPaths,
    },
    darwin: {
      is_default: 'true',
      ...this.commonPaths,
    },
    linux: {
      is_default: 'true',
      ...this.commonPaths,
    },
  } as const;

  /**
   * The path to the extra_models_config.yaml file. The config file is used for ComfyUI core to determine search paths
   * for models and custom nodes.
   */
  public static get configPath(): string {
    return path.join(app.getPath('userData'), ComfyServerConfig.EXTRA_MODEL_CONFIG_PATH);
  }

  public static exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Get the base config for the current operating system.
   */
  static getBaseConfig(): ModelPaths {
    for (const [operatingSystem, modelPathConfig] of Object.entries(this.configTemplates)) {
      if (operatingSystem === process.platform) {
        return modelPathConfig;
      }
    }
    throw new Error(`No base config found for ${process.platform}`);
  }
  /**
   * Generate the content for the extra_model_paths.yaml file.
   */
  static generateConfigFileContent(modelPathConfigs: Record<string, ModelPaths>): string {
    const modelConfigYaml = yaml.stringify(modelPathConfigs, { lineWidth: -1 });
    return `# ComfyUI extra_model_paths.yaml for ${process.platform}\n${modelConfigYaml}`;
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

  public static async readConfigFile(configPath: string): Promise<Record<string, ModelPaths> | null> {
    try {
      const fileContent = await fsPromises.readFile(configPath, 'utf8');
      const config = yaml.parse(fileContent);
      return config;
    } catch (error) {
      log.error(`Error reading config file ${configPath}:`, error);
      return null;
    }
  }

  public static async getConfigFromRepoPath(repoPath: string): Promise<Record<string, ModelPaths>> {
    const configPath = path.join(repoPath, ComfyServerConfig.COMFYUI_DEFAULT_CONFIG_NAME);
    const config = (await this.readConfigFile(configPath)) ?? {};
    return config;
  }

  public static getBaseModelPathsFromRepoPath(repoPath: string): ModelPaths {
    return knownModelKeys.reduce((acc, key) => {
      acc[key] = path.join(repoPath, 'models', key) + path.sep;
      return acc;
    }, {} as ModelPaths);
  }

  /**
   * Create the extra_model_paths.yaml file in the given destination path.
   * @param destinationPath - The path to the destination file.
   * @param configs - The configs to write.
   */
  public static async createConfigFile(destinationPath: string, configs: Record<string, ModelPaths>): Promise<boolean> {
    log.info(`Creating model config files in ${destinationPath}`);
    try {
      const configContent = this.generateConfigFileContent(configs);
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

      if (config?.comfyui_desktop?.base_path) {
        return config.comfyui_desktop.base_path;
      }

      // Legacy yaml format, where we have everything under root 'comfyui'.
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
