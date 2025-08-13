import { execSync } from 'node:child_process';

import pkg from './getPackage.js';

const comfyRepo = 'https://github.com/comfyanonymous/ComfyUI';
const managerRepo = 'https://github.com/ltdrdata/ComfyUI-Manager';

/** Suppress warning about detached head */
const noWarning = '-c advice.detachedHead=false';

if (pkg.config.comfyUI.optionalBranch) {
  // Checkout branch.
  execAndLog(`git clone ${comfyRepo} --depth 1 --branch ${pkg.config.comfyUI.optionalBranch} assets/ComfyUI`);
} else {
  // Checkout tag as branch.
  execAndLog(`git ${noWarning} clone ${comfyRepo} --depth 1 --branch v${pkg.config.comfyUI.version} assets/ComfyUI`);
}
execAndLog(`git clone ${managerRepo} assets/ComfyUI/custom_nodes/ComfyUI-Manager`);
execAndLog(
  `cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git ${noWarning} checkout ${pkg.config.managerCommit} && cd ../../..`
);
execAndLog(`yarn run make:frontend`);
execAndLog(`yarn run download:uv all`);

// Only download VC++ redistributable for production builds (ToDesktop or signed Windows builds)
// Check for PUBLISH=true which is set by ToDesktop builds and Windows signing builds
if (process.env.PUBLISH === 'true') {
  console.log('Production build detected (PUBLISH=true) - downloading VC++ redistributable for Windows installer');
  execAndLog(`yarn run download:vcredist`);
} else {
  console.log('Skipping VC++ redistributable download (PUBLISH != true)');
}

execAndLog(`yarn run patch:core:frontend`);
/**
 * Run a command and log the output.
 * @param {string} command The command to run.
 */
function execAndLog(command) {
  const output = execSync(command, { encoding: 'utf8' });
  console.log(output);
}
