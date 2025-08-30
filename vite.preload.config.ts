import type { UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';

import { external, getBuildConfig } from './vite.base.config';

// https://vitejs.dev/config
export default defineConfig((env) => {
  const config: UserConfig = {
    build: {
      rollupOptions: {
        external,
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: './src/preload.ts',
        output: {
          format: 'cjs',
          // It should not be split chunks.
          inlineDynamicImports: true,
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name].cjs',
          assetFileNames: '[name].[ext]',
        },
      },
    },
    // TODO: Not impl. - placeholder for vitest configuration
    // Note: tests/preload directory doesn't exist yet
    // test: {
    //   name: 'preload',
    //   include: ['tests/preload/**/*'],
    //   environment: 'jsdom',
    // },
  };

  return mergeConfig(getBuildConfig(env), config);
});
