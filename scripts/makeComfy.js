import { execSync } from 'node:child_process';

import pkg from './getPackage.js';

const comfyRepo = 'https://github.com/comfyanonymous/ComfyUI';
const managerRepo = 'https://github.com/ltdrdata/ComfyUI-Manager';

if (pkg.config.comfyUI.optionalBranch) {
  // Checkout branch.
  execSync(`git clone ${comfyRepo} --depth 1 --branch ${pkg.config.comfyUI.optionalBranch} assets/ComfyUI`);
} else {
  // Checkout tag as branch.
  execSync(`git clone ${comfyRepo} --depth 1 --branch v${pkg.config.comfyUI.version} assets/ComfyUI`);
}
execSync(`git clone ${managerRepo} assets/ComfyUI/custom_nodes/ComfyUI-Manager`);
execSync(`cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git checkout ${pkg.config.managerCommit} && cd ../../..`);
execSync(`yarn run make:frontend`);
execSync(`yarn run download:uv all`);
execSync(`yarn run patch:core:frontend`);
