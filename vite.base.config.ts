import { builtinModules } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import pkg from './package.json';

export const builtins = ['electron', ...builtinModules.map((m) => [m, `node:${m}`]).flat()];

export const external = [
  ...builtins,
  ...Object.keys('dependencies' in pkg ? (pkg.dependencies as Record<string, unknown>) : {}),
];

export function getBuildConfig(env: ConfigEnv): UserConfig {
  const { mode, command } = env;

  return {
    mode,
    build: {
      // Prevent multiple builds from interfering with each other.
      emptyOutDir: false,
      // 🚧 Multiple builds may conflict.
      outDir: '.vite/build',
      watch: command === 'serve' ? {} : null,
      minify: command === 'build',
    },
    clearScreen: false,
  };
}

export function pluginHotRestart(command: 'reload' | 'restart'): Plugin {
  return {
    name: '@electron-forge/plugin-vite:hot-restart',
    closeBundle() {
      if (command === 'reload') {
        // TODO: Send message to external renderer dev server for reload.
      } else {
        // Main process hot restart.
        // https://github.com/electron/forge/blob/v7.2.0/packages/api/core/src/api/start.ts#L216-L223
        process.stdin.emit('data', 'rs');
      }
    },
  };
}
