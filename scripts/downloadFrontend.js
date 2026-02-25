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

// Example "1.3.34" or "v1.3.34"
const version = process.argv[2] || frontend.version;
if (!version) {
  console.error('No version specified');
  process.exit(1);
}
const releaseTag = version.startsWith('v') ? version : `v${version}`;

const frontendRepo = 'https://github.com/Comfy-Org/ComfyUI_frontend';

if (frontend.optionalBranch) {
  // Optional branch, no release; build from source
  console.log('Building frontend from source...');
  const frontendDir = 'assets/frontend';

  try {
    execAndLog(`git clone ${frontendRepo} --depth 1 --branch ${frontend.optionalBranch} ${frontendDir}`);
    execAndLog(`pnpm install --frozen-lockfile`, frontendDir, { COREPACK_ENABLE_STRICT: '0' });
    // Run the build directly to avoid test-only typecheck failures.
    execAndLog(`pnpm exec nx build`, frontendDir, {
      COREPACK_ENABLE_STRICT: '0',
      DISTRIBUTION: 'desktop',
      USE_PROD_CONFIG: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
    });
    await fs.mkdir('assets/ComfyUI/web_custom_versions/desktop_app', { recursive: true });
    await fs.cp(path.join(frontendDir, 'dist'), 'assets/ComfyUI/web_custom_versions/desktop_app', { recursive: true });
    await fs.rm(frontendDir, { recursive: true });
  } catch (error) {
    console.error('Error building frontend:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  /**
   * Run a command and log the output.
   * @param {string} command The command to run.
   * @param {string | undefined} cwd The working directory.
   * @param {Record<string, string>} env Additional environment variables.
   */
  function execAndLog(command, cwd, env = {}) {
    try {
      const output = execSync(command, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
      console.log(output);
    } catch (error) {
      console.error(`Command failed: ${command}`);
      logExecErrorOutput(error);
      throw error;
    }
  }

  /**
   * Log stdout/stderr for exec failures when available.
   * @param {unknown} error The error thrown by execSync.
   */
  function logExecErrorOutput(error) {
    if (!error || typeof error !== 'object') {
      return;
    }

    const execError = /** @type {{ stdout?: { toString?: () => string }, stderr?: { toString?: () => string } }} */ (
      error
    );
    const stdoutText = execError.stdout?.toString?.();
    const stderrText = execError.stderr?.toString?.();

    if (stdoutText) {
      console.error(stdoutText);
    }

    if (stderrText) {
      console.error(stderrText);
    }
  }
} else {
  // Download desktop-specific release frontend zip.
  const releaseBaseUrl = `https://github.com/Comfy-Org/ComfyUI_frontend/releases/download/${releaseTag}`;
  const frontendArtifact = 'dist-desktop.zip';

  const downloadPath = 'temp_frontend.zip';
  const extractPath = 'assets/ComfyUI/web_custom_versions/desktop_app';

  /**
   * Download the desktop frontend artifact for the configured release.
   * @returns {Promise<{ artifact: string, data: Buffer }>}
   */
  async function downloadReleaseArtifact() {
    const artifactUrl = `${releaseBaseUrl}/${frontendArtifact}`;

    try {
      console.log(`Downloading frontend artifact "${frontendArtifact}"...`);
      /** @type {import('axios').AxiosResponse<Buffer>} */
      const response = await axios({
        method: 'GET',
        url: artifactUrl,
        responseType: 'arraybuffer',
      });
      return {
        artifact: frontendArtifact,
        data: /** @type {Buffer} */ (response.data),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Frontend artifact "${frontendArtifact}" not found for ${releaseTag}.`);
      }
      throw error;
    }
  }

  async function downloadAndExtractFrontend() {
    try {
      // Create directories if they don't exist
      await fs.mkdir(extractPath, { recursive: true });

      const releaseArtifact = await downloadReleaseArtifact();
      const artifact = releaseArtifact.artifact;
      const data = releaseArtifact.data;

      // Save to temporary file
      await fs.writeFile(downloadPath, data);

      // Extract the zip file
      console.log(`Extracting frontend artifact "${artifact}"...`);
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
