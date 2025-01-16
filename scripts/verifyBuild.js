/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Verify the app build for the current platform.
 * Check that all required paths are present.
 */
const PATHS = {
  mac: {
    base: 'dist/mac-arm64/ComfyUI.app/Contents/Resources',
    required: ['ComfyUI', 'ComfyUI/custom_nodes/ComfyUI-Manager', 'UI', 'uv/macos/uv', 'uv/macos/uvx'],
  },
  windows: {
    base: 'dist/win-unpacked/resources',
    required: [
      // Add Windows-specific paths here
      'ComfyUI',
      'ComfyUI/custom_nodes/ComfyUI-Manager',
      'UI',
      'uv/win/uv',
      'uv/win/uvx',
    ],
  },
};

function verifyConfig(config) {
  const missingPaths = [];

  for (const requiredPath of config.required) {
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
