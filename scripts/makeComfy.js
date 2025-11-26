import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
const assetsComfyPath = path.join('assets', 'ComfyUI');
const managerRequirementsPath = path.join(assetsComfyPath, 'manager_requirements.txt');

if (fs.existsSync(managerRequirementsPath)) {
  console.log('Detected manager_requirements.txt, skipping legacy ComfyUI-Manager clone.');
} else {
  execAndLog(`git clone ${managerRepo} assets/ComfyUI/custom_nodes/ComfyUI-Manager`);
  execAndLog(
    `cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git ${noWarning} checkout ${pkg.config.managerCommit} && cd ../../..`
  );
}
execAndLog(`yarn run make:frontend`);
execAndLog(`yarn run download:uv all`);
execAndLog(`yarn run patch:core:frontend`);
/**
 * Run a command and log the output.
 * @param {string} command The command to run.
 */
function execAndLog(command) {
  const output = execSync(command, { encoding: 'utf8' });
  console.log(output);
}
