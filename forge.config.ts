import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';


const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ...process.env.PUBLISH == 'true' && {windowsSign: {
      debug:true,
      hookFunction: (filePath) => {
        if (!filePath.endsWith("ComfyUI.exe")) return; // For now just ignore any file that isnt the main exe will need to change when building with installers/auto updates / a compiled python servesr
        require("child_process").execSync(`signtool.exe sign /sha1 ${process.env.DIGICERT_FINGERPRINT} /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 ${filePath}`)
      },
    }},
    osxSign: {
      identity: process.env.SIGN_ID,
      ignore: (filepath) => {
        console.log('########',filepath);
        if (filepath.includes('assets/ComfyUI') || filepath.includes('assets/python')) {
          return true;
        }
        else {
          return false;
        }
      }
    },
    extraResource: ['./assets/UI', './assets/ComfyUI', './assets/python'],
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    }
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (forgeConfig, packageResult) => {
      console.log('Post-package hook started');
      console.log('Package result:', JSON.stringify(packageResult, null, 2));
    },
    readPackageJson: async (config, packageJson) => {
      return packageJson;
    },
  },
  makers: [
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
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
    {
      name: '@electron-forge/publisher-github',
      platforms: ['darwin', 'win32'],
      config: {
        repository: {
          owner: 'comfy-org',
          name: 'electron',
        },
        prerelease: true,
      },
    },
  ],
};

export default config;
