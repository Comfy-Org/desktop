const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('yaml');
const readline = require('readline');

/**
 * Get the path to the extra_models_config.yaml file based on the platform.
 * @returns The path to the extra_models_config.yaml file.
 */

function getConfigPath() {
  switch (process.platform) {
    case 'darwin': // macOS
      return path.join(os.homedir(), 'Library', 'Application Support', 'ComfyUI', 'extra_models_config.yaml');
    case 'win32': // Windows
      return path.join(process.env.APPDATA, 'ComfyUI', 'extra_models_config.yaml');
    default:
      console.log('Platform not supported for this operation');
      process.exit(1);
  }
}

async function askForConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question + ' (y/N): ', answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function main() {
  try {
    const configPath = getConfigPath();
    let basePath = null;

    // Read base_path before deleting the config file
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.parse(configContent);
      basePath = config?.comfyui?.base_path;
      
      // Delete config file
      fs.unlinkSync(configPath);
      console.log(`Successfully removed ${configPath}`);
    } else {
      console.log('Config file not found, nothing to remove');
    }

    // If base_path exists, ask user if they want to delete it
    if (basePath && fs.existsSync(basePath)) {
      console.log(`Found ComfyUI installation directory at: ${basePath}`);
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

main();
