import * as fsPromises from 'node:fs/promises';
import path from 'path';
import log from 'electron-log/main';
import { stringify } from 'yaml';

interface ModelPaths {
  comfyui: {
    base_path: string;
    is_default: boolean;
    [key: string]: string | boolean;
  };
}

const commonPaths = {
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
  custom_nodes: 'custom_nodes/',
};

const configTemplates: Record<string, ModelPaths> = {
  win32: {
    comfyui: {
      base_path: '%USERPROFILE%/comfyui-electron',
      ...commonPaths,
    },
  },
  darwin: {
    comfyui: {
      base_path: '~/Library/Application Support/ComfyUI',
      ...commonPaths,
    },
  },
  linux: {
    comfyui: {
      base_path: '~/.config/ComfyUI',
      ...commonPaths,
    },
  },
};

export async function createModelConfigFiles(extraModelConfigPath: string, customBasePath?: string): Promise<boolean> {
  log.info(`Creating model config files in ${extraModelConfigPath} with base path ${customBasePath}`);
  try {
    for (const [platform, config] of Object.entries(configTemplates)) {
      if (platform !== process.platform) {
        continue;
      }

      log.info(`Creating model config files for ${platform}`);

      // If a custom base path is provided, use it
      if (customBasePath) {
        config.comfyui.base_path = customBasePath;
      }

      const yamlContent = stringify(config, { lineWidth: -1 });

      // Add a comment at the top of the file
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
