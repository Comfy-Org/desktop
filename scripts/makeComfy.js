const { execSync } = require('child_process');
const pkg = require('../package.json');

function makeAssets(gpuFlag) {
  const baseCommand = [
    'cd assets',
    '&&',
    `comfy-cli --skip-prompt --here install --version ${pkg.config.comfyVersion} --fast-deps`,
    gpuFlag,
    '--manager-url https://github.com/Comfy-Org/manager-core',
    '&&',
    'comfy-cli --here standalone',
    '&&',
    'yarn run make:frontend'
  ].join(' ');

  // Special case for macOS which needs additional checks
  if (gpuFlag === '--m-series') {
    return execSync(`${baseCommand} && ../scripts/checkAssetsMacos.sh python`, { stdio: 'inherit' });
  }

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
