import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readline from 'node:readline';
import * as yaml from 'yaml';

/**
 * Get the path to the extra_models_config.yaml file based on the platform.
 * @param {string} filename The name of the file to find in the user data folder
 * @returns The path to the extra_models_config.yaml file.
 */

function getConfigPath(filename) {
  switch (process.platform) {
    case 'darwin': // macOS
      return path.join(os.homedir(), 'Library', 'Application Support', 'ComfyUI', filename);
    case 'win32': // Windows
      return path.join(process.env.APPDATA, 'ComfyUI', filename);
    default:
      console.log('Platform not supported for this operation');
      process.exit(1);
  }
}

/** @returns {Promise<boolean>} */
function askForConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question + ' (y/N): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function main() {
  try {
    const configPath = getConfigPath('config.json');
    const windowStorePath = getConfigPath('window.json');
    const modelsConfigPath = getConfigPath('extra_models_config.yaml');
    let desktopBasePath;
    /** @type {string | undefined} */
    let basePath;

    // Read basePath from desktop config
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');

      /** @type {import('../src/store/desktopSettings').DesktopSettings} */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(configContent);
      desktopBasePath = parsed?.basePath;
    }

    // Read base_path before deleting the config file
    if (fs.existsSync(modelsConfigPath)) {
      const configContent = fs.readFileSync(modelsConfigPath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const config = yaml.parse(configContent);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      basePath = config?.comfyui?.base_path;
    } else {
      console.log('Config file not found, nothing to remove');
    }

    // Delete all config files
    for (const file of [configPath, windowStorePath, modelsConfigPath]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Successfully removed ${file}`);
      }
    }

    // If config.json basePath exists, ask user if they want to delete it
    if (desktopBasePath && fs.existsSync(desktopBasePath)) {
      console.log(`Found ComfyUI installation directory at: ${desktopBasePath}`);
      const shouldDelete = await askForConfirmation('Would you like to delete this directory as well?');

      if (shouldDelete) {
        fs.rmSync(desktopBasePath, { recursive: true, force: true });
        console.log(`Successfully removed ComfyUI directory at ${desktopBasePath}`);
      } else {
        console.log('Skipping ComfyUI directory deletion');
      }
    }

    // If base_path exists and does not match basePath, ask user if they want to delete it
    if (basePath && basePath !== desktopBasePath && fs.existsSync(basePath)) {
      console.log(`Found ComfyUI models directory at: ${basePath}`);
      const shouldDelete = await askForConfirmation('Would you like to delete this directory as well?');

      if (shouldDelete) {
        fs.rmSync(basePath, { recursive: true, force: true });
        console.log(`Successfully removed ComfyUI directory at ${basePath}`);
      } else {
        console.log('Skipping ComfyUI directory deletion');
      }
    }
  } catch (error) {
    console.error('Error during reset:', error);
    process.exit(1);
  }
}

await main();
