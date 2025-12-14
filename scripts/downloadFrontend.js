import axios from 'axios';
import extract from 'extract-zip';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import packageJson from './getPackage.js';

const { frontend } = packageJson.config;
if (!frontend) {
  console.error('package.json does not contain frontend version config');
  process.exit(1);
}

// Example "v1.3.34"
const version = process.argv[2] || frontend.version;
if (!version) {
  console.error('No version specified');
  process.exit(1);
}

const frontendRepo = 'https://github.com/Comfy-Org/ComfyUI_frontend';

if (frontend.optionalBranch) {
  // Optional branch, no release; build from source
  console.log('Building frontend from source...');
  const frontendDir = 'assets/frontend';

  try {
    execAndLog(`git clone ${frontendRepo} --depth 1 --branch ${frontend.optionalBranch} ${frontendDir}`);
    execAndLog(`npm ci`, frontendDir);
    execAndLog(`npm run build`, frontendDir, { DISTRIBUTION: 'desktop' });
    await fs.mkdir('assets/ComfyUI/web_custom_versions/desktop_app', { recursive: true });
    await fs.cp(path.join(frontendDir, 'dist'), 'assets/ComfyUI/web_custom_versions/desktop_app', { recursive: true });
    await fs.rm(frontendDir, { recursive: true });
  } catch (error) {
    console.error('Error building frontend:', error.message);
    process.exit(1);
  }

  /**
   * Run a command and log the output.
   * @param {string} command The command to run.
   * @param {string | undefined} cwd The working directory.
   * @param {Record<string, string>} env Additional environment variables.
   */
  function execAndLog(command, cwd, env = {}) {
    const output = execSync(command, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    console.log(output);
  }
} else {
  // Download normal frontend release zip
  const url = `https://github.com/Comfy-Org/ComfyUI_frontend/releases/download/v${version}/dist.zip`;

  const downloadPath = 'temp_frontend.zip';
  const extractPath = 'assets/ComfyUI/web_custom_versions/desktop_app';

  async function downloadAndExtractFrontend() {
    try {
      // Create directories if they don't exist
      await fs.mkdir(extractPath, { recursive: true });

      // Download the file
      console.log('Downloading frontend...');
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
      });

      // Save to temporary file
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await fs.writeFile(downloadPath, response.data);

      // Extract the zip file
      console.log('Extracting frontend...');
      await extract(downloadPath, { dir: path.resolve(extractPath) });

      // Clean up temporary file
      await fs.unlink(downloadPath);

      console.log('Frontend downloaded and extracted successfully!');
    } catch (error) {
      console.error('Error downloading frontend:', error.message);
      process.exit(1);
    }
  }

  await downloadAndExtractFrontend();
}

// Copy desktop-ui package to assets
console.log('Copying desktop-ui package...');
const desktopUiSource = 'node_modules/@comfyorg/desktop-ui/dist';
const desktopUiTarget = 'assets/desktop-ui';

try {
  await fs.mkdir(desktopUiTarget, { recursive: true });
  await fs.cp(desktopUiSource, desktopUiTarget, { recursive: true });
  console.log('Desktop UI copied successfully!');
} catch (error) {
  console.error('Error copying desktop-ui:', error.message);
  process.exit(1);
}
