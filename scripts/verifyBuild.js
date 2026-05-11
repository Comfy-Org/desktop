import fs from 'node:fs';
import path from 'node:path';

/**
 * Verify the app build for the current platform.
 * Check that all required paths are present.
 */
/**
 * @typedef {{ base: string; required: string[] }} VerifyConfig
 */

const PATHS = /** @type {Record<'mac' | 'windows', VerifyConfig>} */ ({
  mac: {
    base: 'dist/mac-arm64/ComfyUI.app/Contents/Resources',
    required: ['ComfyUI', 'ComfyUI/.comfy_environment', 'UI', 'uv/macos/uv', 'uv/macos/uvx'],
  },
  windows: {
    base: 'dist/win-unpacked/resources',
    required: [
      // Add Windows-specific paths here
      'ComfyUI',
      'ComfyUI/.comfy_environment',
      'UI',
      'uv/win/uv.exe',
      'uv/win/uvx.exe',
    ],
  },
});

/**
 * @param {VerifyConfig} config
 */
function verifyConfig(config) {
  const required = [...config.required];
  const managerRequirementsPath = path.join(config.base, 'ComfyUI', 'manager_requirements.txt');
  const legacyManagerPath = path.join(config.base, 'ComfyUI', 'custom_nodes', 'ComfyUI-Manager');
  if (fs.existsSync(managerRequirementsPath)) {
    required.push('ComfyUI/manager_requirements.txt');
  } else if (fs.existsSync(legacyManagerPath)) {
    required.push('ComfyUI/custom_nodes/ComfyUI-Manager');
  } else {
    required.push('ComfyUI/manager_requirements.txt');
  }

  const missingPaths = [];

  for (const requiredPath of required) {
    const fullPath = path.join(config.base, requiredPath);
    if (!fs.existsSync(fullPath)) {
      missingPaths.push(requiredPath);
    }
  }

  if (missingPaths.length > 0) {
    console.error('❌ Build verification failed!');
    console.error('Missing required paths:');
    for (const p of missingPaths) console.error(`  - ${p}`);
    process.exit(1);
  }
}

function verifyBuild() {
  const platform = process.platform;

  if (platform === 'darwin') {
    console.log('🔍 Verifying build for Macos...');
    verifyConfig(PATHS.mac);
  } else if (platform === 'win32') {
    console.log('🔍 Verifying build for Windows...');
    verifyConfig(PATHS.windows);
  } else {
    console.error('❌ Unsupported platform:', platform);
    process.exit(1);
  }
}

verifyBuild();
