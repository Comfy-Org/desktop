import { Configuration } from 'electron-builder';

const debugConfig: Configuration = {
  files: [
    'package.json',
    '.vite/**',
    'node_modules/**', // bundle runtime deps for main/preload
  ],
  extraResources: [
    // Keep runtime deps available even if electron-builder pruning misses them.
    { from: './node_modules', to: 'node_modules' },
    // Ship the prebuilt desktop UI downloaded by make:frontend.
    { from: './assets/desktop-ui', to: 'desktop-ui' },
    { from: './assets/ComfyUI', to: 'ComfyUI' },
    { from: './assets/uv', to: 'uv' },
    { from: './assets/UI', to: 'UI' },
  ],
  beforeBuild: './scripts/preMake.js',
  win: {
    icon: './assets/UI/Comfy_Logo.ico',
    target: 'zip',
    signtoolOptions: null,
  },
  mac: {
    icon: './assets/UI/Comfy_Logo.icns',
    target: 'zip',
    identity: null,
  },
  linux: {
    icon: './assets/UI/Comfy_Logo_x256.png',
    target: 'appimage',
  },
  asarUnpack: ['**/node_modules/node-pty/**/*'],
};

export default debugConfig;
