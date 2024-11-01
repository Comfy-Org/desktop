import { Configuration } from 'electron-builder';

const debugConfig: Configuration = {
  files: ['package.json', 'README.md', 'src/**', '.vite/**', 'node_modules/**'],
  extraFiles: [{ from: './assets', to: process.platform === 'darwin' ? './Resources' : './resources' }],
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
};

export default debugConfig;
