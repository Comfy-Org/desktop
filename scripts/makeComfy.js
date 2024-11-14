const { execSync } = require('child_process');
const pkg = require('../package.json');
const fs = require('fs');

function makeAssets(gpuFlag) {
  const baseCommand = [
    'cd assets',
    '&&',
    `comfy-cli --skip-prompt --here install --version ${pkg.config.comfyVersion} --fast-deps`,
    gpuFlag,
    '--manager-url https://github.com/Comfy-Org/manager-core',
    '--manager-commit',
    pkg.config.managerCommit,
    '&&',
    'comfy-cli --here standalone',
    '&&',
    'yarn run make:frontend'
  ].join(' ');

  
  execSync(baseCommand, { stdio: 'inherit' });
  
  // Rename custom_nodes/ComfyUI-Manager to manager-core
  if (!fs.existsSync('assets/ComfyUI/custom_nodes/ComfyUI-Manager')) {
    throw new Error('ComfyUI-Manager not found');
  }
  fs.renameSync('./assets/ComfyUI/custom_nodes/ComfyUI-Manager', './assets/ComfyUI/custom_nodes/manager-core');
}

// Get GPU flag from command line argument
const arg = process.argv[2];
const gpuFlags = {
  nvidia: '--nvidia',
  amd: '--amd',
  cpu: '--cpu',
  macos: '--m-series'
};

if (!arg || !gpuFlags[arg]) {
  console.error('Please specify a valid GPU type: nvidia, amd, cpu, or macos');
  process.exit(1);
}

makeAssets(gpuFlags[arg]);
