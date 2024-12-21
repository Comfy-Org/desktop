/// <reference types="vitest/config" />
import { UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, external } from './vite.base.config';
import { viteElectronAppPlugin } from './infrastructure/viteElectronAppPlugin';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { version } from './package.json';

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
      'process.env.COMFYUI_CPU_ONLY': `"${process.env.COMFYUI_CPU_ONLY}"`,
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
