const { execSync } = require('child_process');
const pkg = require('../package.json');
const fs = require('fs');

function makeAssets(gpuFlag) {
  const baseCommand = [
    'cd assets',
    '&&',
    `comfy-cli --skip-prompt --here install --version ${pkg.config.comfyVersion} --fast-deps`,
    gpuFlag,
    '--manager-commit',
    pkg.config.managerCommit,
    '&&',
    'comfy-cli --here standalone',
    '&&',
    'yarn run make:frontend'
  ].join(' ');

  
  execSync(baseCommand, { stdio: 'inherit' });
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
