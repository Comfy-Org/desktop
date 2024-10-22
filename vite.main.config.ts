import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, getBuildDefine, external, pluginHotRestart } from './vite.base.config';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { version } from './package.json';
import { resolve } from 'node:path';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>;
  const { forgeConfigSelf } = forgeEnv;
  //const define = getBuildDefine(forgeEnv);
  const config: UserConfig = {
    build: {
      outDir: '.vite/build',
      lib: {
        entry: './src/main.ts',
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: {
        external,
      },
      sourcemap: true,
    },
    plugins: [
      pluginHotRestart('restart'),
      sentryVitePlugin({
        org: 'comfy-org',
        project: 'electron',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: {
          name: version,
        },
      }),
    ],
    define: {
      VITE_NAME: JSON.stringify('COMFY'),
      'process.env.COMFYUI_CPU_ONLY': `"${process.env.COMFYUI_CPU_ONLY}"`,
      ...(env.command !== 'build' && {
        VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
        MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
      }),
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
