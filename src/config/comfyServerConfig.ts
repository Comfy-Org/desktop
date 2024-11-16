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

type ModelPaths = Record<string, string>;

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
  static generateConfigFileContent(modelPathConfigs: Record<string, ModelPaths>): string {
    const modelConfigYaml = yaml.stringify(modelPathConfigs, { lineWidth: -1 });
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
   * Create the extra_model_paths.yaml file in the given destination path with the given custom config.
   * @param destinationPath - The path to the destination file.
   * @param customConfig - The custom config to merge with the base config.
   * @param extraConfigs - The extra configs such as paths from A1111.
   */
  public static async createConfigFile(
    destinationPath: string,
    customConfig: ModelPaths,
    extraConfigs: Record<string, ModelPaths>
  ): Promise<boolean> {
    log.info(`Creating model config files in ${destinationPath}`);
    try {
      const baseConfig = this.getBaseConfig();
      if (!baseConfig) {
        log.error('No base config found');
        return false;
      }
      const comfyuiConfig = this.mergeConfig(baseConfig, customConfig);
      const configContent = this.generateConfigFileContent({
        ...extraConfigs,
        comfyui: comfyuiConfig,
      });
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

  /**
   * Get the config for the migration source (Existing ComfyUI instance).
   * @param migrationSource - The path to the migration source.
   * @param migrationItemIds - The item ids to migrate.
   */
  public static async getMigrationConfig(
    migrationSource?: string,
    migrationItemIds: Set<string> = new Set()
  ): Promise<{ comfyui: ModelPaths } & Record<string, ModelPaths>> {
    if (!migrationSource || !migrationItemIds.has('models')) {
      return { comfyui: {} };
    }
    // The yaml file exited in migration source repo.
    const migrationServerConfig = await ComfyServerConfig.getConfigFromRepoPath(migrationSource);

    // The model paths in the migration source repo.
    const migrationComfyConfig = migrationSource
      ? ComfyServerConfig.getBaseModelPathsFromRepoPath(migrationSource)
      : {};

    // The overall paths to add to the config file.
    const comfyuiConfig = ComfyServerConfig.mergeConfig(migrationServerConfig['comfyui'] ?? {}, migrationComfyConfig);
    // Do not migrate custom nodes as we currently don't have a way to install their dependencies.
    if ('custom_nodes' in comfyuiConfig) {
      delete comfyuiConfig['custom_nodes'];
    }
    return {
      ...migrationServerConfig,
      comfyui: comfyuiConfig,
    };
  }
}
