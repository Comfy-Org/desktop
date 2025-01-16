import { execSync } from 'node:child_process';

import pkg from './getPackage.js';

const comfyRepo = 'https://github.com/comfyanonymous/ComfyUI';
const managerRepo = 'https://github.com/Comfy-Org/ComfyUI-Manager';

execSync(`git clone ${comfyRepo} --depth 1 --branch v${pkg.config.comfyVersion} assets/ComfyUI`);
execSync(`git clone ${managerRepo} assets/ComfyUI/custom_nodes/ComfyUI-Manager`);
execSync(`cd assets/ComfyUI/custom_nodes/ComfyUI-Manager && git checkout ${pkg.config.managerCommit} && cd ../../..`);
execSync(`yarn run make:frontend`);
