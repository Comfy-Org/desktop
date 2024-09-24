import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, getBuildDefine, external, pluginHotRestart } from './vite.base.config';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { version } from './package.json'; // Import the version from package.json

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>;
  const { forgeConfigSelf } = forgeEnv;
  const define = getBuildDefine(forgeEnv);
  const config: UserConfig = {
    build: {
      lib: {
        entry: forgeConfigSelf.entry!,
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
    define,
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
