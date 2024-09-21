import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { pluginExposeRenderer } from './vite.base.config';
import { resolve } from 'node:path';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'renderer'>;
  const { root, mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? '';

  return {
    root,
    mode,
    base: './',
    build: {
      outDir: `.vite/renderer/${name}`,
    },
    define: {
      SENTRY_DSN_ENDPOINT: JSON.stringify(process.env.SENTRY_DSN_ENDPOINT),
    },
    plugins: [pluginExposeRenderer(name)],
    resolve: {
      alias: [{ find: 'src', replacement: resolve(__dirname, './src/') }],
      preserveSymlinks: true,
    },
    clearScreen: false,
  } as UserConfig;
});
