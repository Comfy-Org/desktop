import { Configuration } from 'electron-builder';

const debugConfig: Configuration = {
  files: ['package.json', 'README.md', 'src/**', '.vite/**'],
  extraResources: ['./assets/ComfyUI', './assets/python.tgz', './assets/UI'],
  win: {
    asar: false,
    icon: './assets/UI/Comfy_Logo.ico',
    target: 'zip',
    signtoolOptions: null,
  },
  mac: {
    icon: './assets/UI/Comfy_Logo.icns',
    target: 'zip',
    sign: null,
  },
  linux: {
    icon: './assets/UI/Comfy_Logo_x256.png',
    target: 'appimage',
  },
};

export default debugConfig;
