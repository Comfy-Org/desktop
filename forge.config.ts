import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'path';
import fs from 'fs';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ...(process.env.PUBLISH == 'true' && {
      windowsSign: {
        debug: true,
        hookFunction: (filePath) => {
          if (!filePath.endsWith('ComfyUI.exe')) return; // For now just ignore any file that isnt the main exe will need to change when building with installers/auto updates / a compiled python servesr
          import('child_process').then((cp) =>
            cp.execSync(
              `signtool.exe sign /sha1 ${process.env.DIGICERT_FINGERPRINT} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 ${filePath}`
            )
          );
        },
      },
      osxSign: {
        identity: process.env.SIGN_ID as string,
        optionsForFile: (filepath) => {
          return { entitlements: './scripts/entitlements.mac.plist' };
        },
      },
      osxNotarize: {
        appleId: process.env.APPLE_ID as string,
        appleIdPassword: process.env.APPLE_PASSWORD as string,
        teamId: process.env.APPLE_TEAM_ID as string,
      },
    }),
    extraResource: ['./assets/ComfyUI', './assets/python.tgz', './assets/UI'],

    icon: process.platform === 'linux' ? 'assets/UI/Comfy_Logo_x128.png' : 'assets/UI/Comfy_Logo',
  },
  rebuildConfig: {},
  hooks: {
    prePackage: async () => {
      const configDir = path.join(__dirname, 'config');
      const assetDir = path.join(__dirname, 'assets', 'ComfyUI');

      // Ensure the asset directory exists
      if (!fs.existsSync(assetDir)) {
        fs.mkdirSync(assetDir, { recursive: true });
      }

      let sourceFile;
      if (process.platform === 'darwin') {
        sourceFile = path.join(configDir, 'model_paths_mac.yaml');
      } else if (process.platform === 'win32') {
        sourceFile = path.join(configDir, 'model_paths_windows.yaml');
      } else {
        sourceFile = path.join(configDir, 'model_paths_linux.yaml');
      }

      const destFile = path.join(assetDir, 'extra_model_paths.yaml');

      try {
        fs.copyFileSync(sourceFile, destFile);
        console.log(`Copied ${sourceFile} to ${destFile}`);
      } catch (err) {
        console.error(`Failed to copy config file: ${err}`);
        throw err; // This will stop the packaging process if the copy fails
      }
    },
    postPackage: async (forgeConfig, packageResult) => {
      console.log('Post-package hook started');
      console.log('Package result:', JSON.stringify(packageResult, null, 2));
    },
    readPackageJson: async (config, packageJson) => {
      return packageJson;
    },
  },
  makers: [
    new MakerSquirrel(
      (arch) => ({
        noDelta: !process.env.PUBLISH,
        remoteReleases: `https://comfyui-electron-releases.s3.us-west-2.amazonaws.com/win32/${arch}`,
        frameworkVersion: 'net481',
      }),
      ['win32']
    ),
    new MakerZIP(
      (arch) => ({
        macUpdateManifestBaseUrl: `https://comfyui-electron-releases.s3.us-west-2.amazonaws.com/darwin/${arch}`,
      }),
      ['darwin', 'win32']
    ),
    // the forge build produces a "ComfyUI" bin, but the rpm/deb makers expect a "comfyui-electron" bin (matching the "name" in package.json). We override this below
    new MakerRpm({
      options: {
        bin: 'ComfyUI',
      },
    }),
    new MakerDeb({
      options: {
        bin: 'ComfyUI',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    // {
    //   name: '@electron-forge/publisher-gcs',
    //   config: {
    //     storageOptions: {
    //       projectId: 'dreamboothy',
    //     },
    //     bucket: 'electron-artifacts',
    //   },
    // },
    {
      name: '@electron-forge/publisher-s3',
      config: {
        bucket: 'comfyui-electron-releases',
        public: true,
        keyResolver: (fileName: string, platform: string, arch: string) => {
          return `${platform}/${arch}/${fileName}`;
        },
      },
    },
    // {
    //   name: '@electron-forge/publisher-github',
    //   platforms: ['darwin', 'win32'],
    //   config: {
    //     repository: {
    //       owner: 'comfy-org',
    //       name: 'electron',
    //     },
    //     prerelease: true,
    //   },
    // },
  ],
};

export default config;
