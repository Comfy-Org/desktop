import * as child_process from 'node:child_process';
import pkg from './getPackage.js';

function makeAssets(gpuFlag) {
  const baseCommand = [
    'cd assets',
    '&&',
    `comfy-cli --skip-prompt --here install --version ${pkg.config.comfyVersion} --skip-requirement`,
    gpuFlag,
    '--manager-commit',
    pkg.config.managerCommit,
    '--manager-url',
    'https://github.com/Comfy-Org/ComfyUI-Manager',
    '&&',
    'yarn run make:frontend',
  ].join(' ');

  try {
    child_process.execSync(baseCommand, { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to make assets:', error);
    process.exit(1);
  }
}

// Get GPU flag from command line argument
const arg = process.argv[2];
const gpuFlags = {
  nvidia: '--nvidia',
  amd: '--amd',
  cpu: '--cpu',
  macos: '--m-series',
};

if (!arg || !gpuFlags[arg]) {
  console.error('Please specify a valid GPU type: nvidia, amd, cpu, or macos');
  process.exit(1);
}

makeAssets(gpuFlags[arg]);
