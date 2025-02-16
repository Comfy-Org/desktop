import { execSync } from 'node:child_process';

import pkg from './getPackage.js';

const comfyRepo = 'https://github.com/comfyanonymous/ComfyUI';
const managerRepo = 'https://github.com/Comfy-Org/ComfyUI-Manager';

// Clone and checkout base versions
execSync(`git clone ${comfyRepo} --depth 1 --branch v${pkg.config.comfyVersion} assets/ComfyUI`);
execSync(`git clone ${managerRepo} assets/ComfyUI/custom_nodes/ComfyUI-Manager`);
execSync(`cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git checkout ${pkg.config.managerCommit} && cd ../../..`);

// Cherry-pick commits for ComfyUI if specified
if (pkg.config.comfyCherryPicks?.length > 0) {
  for (const commit of pkg.config.comfyCherryPicks) {
    try {
      execSync(`cd assets/ComfyUI && git fetch origin ${commit} && git cherry-pick ${commit} && cd ../..`);
    } catch (error) {
      console.error(`Failed to cherry-pick commit ${commit} for ComfyUI:`, error.message);
      throw error;
    }
  }
}

// Cherry-pick commits for Manager if specified
if (pkg.config.managerCherryPicks?.length > 0) {
  for (const commit of pkg.config.managerCherryPicks) {
    try {
      execSync(
        `cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git fetch origin ${commit} && git cherry-pick ${commit} && cd ../../../..`
      );
    } catch (error) {
      console.error(`Failed to cherry-pick commit ${commit} for Manager:`, error.message);
      throw error;
    }
  }
}

execSync(`yarn run make:frontend`);
execSync(`yarn run download:uv all`);
