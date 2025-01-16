/// <reference types="vitest/config" />
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';

import { viteElectronAppPlugin } from './infrastructure/viteElectronAppPlugin';
import { version } from './package.json';
import { external, getBuildConfig } from './vite.base.config';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const config: UserConfig = {
    build: {
      outDir: '.vite/build',
      lib: {
        entry: './src/main.ts',
        fileName: (_format, name) => `${name}.cjs`,
        formats: ['cjs'],
      },
      rollupOptions: {
        external,
      },
      sourcemap: true,
      minify: false,
    },
    server: {
      watch: {
        ignored: ['**/assets/ComfyUI/**', 'venv/**'],
      },
    },
    plugins: [
      // Custom hot reload solution for vite 6
      viteElectronAppPlugin(),
      process.env.NODE_ENV === 'production'
        ? sentryVitePlugin({
            org: 'comfy-org',
            project: 'desktop',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: {
              name: `ComfyUI@${version}`,
            },
          })
        : undefined,
    ],
    define: {
      VITE_NAME: JSON.stringify('COMFY'),
      'process.env.PUBLISH': `"${process.env.PUBLISH}"`,
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    test: {
      name: 'main',
      include: ['tests/unit/**/*'],
    },
  };

  return mergeConfig(getBuildConfig(env), config);
});
