import { app } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import yaml, { type YAMLParseError } from 'yaml';

import { getAppResourcesPath } from '@/install/resourcePaths';

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

/** @see BasePathReadSuccess */
type BasePathReadResult = BasePathReadSuccess | BasePathReadFailure;

/** Result of a YAML config read attempt */
interface BasePathReadSuccess {
  /**
   * Exactly what happened when trying to read the file.
   * - `success`: All OK.  Path is present.
   * - `invalid`: File format invalid: `base_path` was not present or not a string.
   * - `notFound`: The file does not exist.
   * - `error`: Filesystem error (permissions, unresponsive disk, etc).
   */
  status: 'success';
  /** The value of base_path from the YAML file */
  path: string;
}

/** @see BasePathReadSuccess */
interface BasePathReadFailure {
  status: 'invalid' | 'notFound' | 'error';
  path?: unknown;
}

/**
 * The ComfyServerConfig class is used to manage the configuration for the ComfyUI server.
 */
export class ComfyServerConfig {
  // The name of the default config file.
  static readonly COMFYUI_DEFAULT_CONFIG_NAME = 'extra_model_paths.yaml';
  // The path to the extra_models_config.yaml file used by the Electron desktop app.
  static readonly EXTRA_MODEL_CONFIG_PATH = 'extra_models_config.yaml';

  private static readonly commonPaths = {
    custom_nodes: path.join(getAppResourcesPath(), 'ComfyUI', 'custom_nodes'),
    download_model_base: 'models',
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
      // TODO: Reimplement with validation and error reporting.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return yaml.parse(fileContent);
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
    const paths: ModelPaths = {};
    for (const key of knownModelKeys) {
      paths[key] = path.join(repoPath, 'models', key) + path.sep;
    }
    return paths;
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

  /**
   * Reads a YAML config file and attempts to return the base_path value.
   *
   * Attempts to read the new config path first, falling back to the original path if not.
   * @param configPath The path to read
   * @returns Status of the attempt and the value of base_path, if available
   */
  public static async readBasePathFromConfig(configPath: string): Promise<BasePathReadResult> {
    try {
      const fileContent = await fsPromises.readFile(configPath, 'utf8');
      // TODO: Reimplement with validation and error reporting.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const config = yaml.parse(fileContent);

      // Fallback to legacy yaml format, where we have everything under root 'comfyui'.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const base_path = config?.comfyui_desktop?.base_path ?? config?.comfyui?.base_path;
      if (typeof base_path !== 'string') {
        log.warn(`Base path in YAML config was invalid: [${ComfyServerConfig.configPath}]`);
        return { status: 'invalid', path: base_path };
      }

      return { status: 'success', path: base_path };
    } catch (error) {
      if ((error as YAMLParseError)?.name === 'YAMLParseError') {
        log.error(`Unable to parse config file [${configPath}]`, error);
        return { status: 'invalid' };
      } else if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        log.info(`Config file not found at ${configPath}`);
        return { status: 'notFound' };
      } else {
        log.error(`Error reading config file ${configPath}:`, error);
        return { status: 'error' };
      }
    }
  }

  /** @deprecated Do not use.  Tempoary workaround for validation only. */
  public static async setBasePathInDefaultConfig(basePath: string): Promise<boolean> {
    const parsedConfig = await ComfyServerConfig.readConfigFile(ComfyServerConfig.configPath);
    // TODO: Prompt user to attempt this as a troubleshooting option.
    if (parsedConfig === null) {
      // File does not exist.  Just create default.
      log.warn("Extra model paths config file doesn't exist.  Creating default.");

      const comfyDesktopConfig = ComfyServerConfig.getBaseConfig();
      comfyDesktopConfig['base_path'] = basePath;

      return await ComfyServerConfig.createConfigFile(ComfyServerConfig.configPath, {
        comfyui_desktop: comfyDesktopConfig,
      });
    }
    if (!parsedConfig) return false;

    parsedConfig.comfyui_desktop ??= {};
    parsedConfig.comfyui_desktop.base_path = basePath;
    const stringified = ComfyServerConfig.generateConfigFileContent(parsedConfig);

    return await ComfyServerConfig.writeConfigFile(ComfyServerConfig.configPath, stringified);
  }

  /**
   * Patches extra_model_config.yaml to include the custom nodes bundled with the app (eg. ComfyUI-Manager).
   * @returns
   */
  public static async addAppBundledCustomNodesToConfig(): Promise<void> {
    const parsedConfig = await ComfyServerConfig.readConfigFile(ComfyServerConfig.configPath);
    if (parsedConfig === null) {
      log.error('Failed to read config file');
      return;
    }

    if (!parsedConfig.desktop_patch) {
      const customNodesPath = path.join(getAppResourcesPath(), 'ComfyUI', 'custom_nodes');
      log.info(`Adding custom node extra_path to config ${customNodesPath}`);
      parsedConfig.desktop_patch = {};
      parsedConfig.desktop_patch.custom_nodes = customNodesPath;
      const stringified = ComfyServerConfig.generateConfigFileContent(parsedConfig);
      await ComfyServerConfig.writeConfigFile(ComfyServerConfig.configPath, stringified);
    }
  }
}
