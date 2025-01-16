import electronPath from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import type { PluginOption } from 'vite';

/**
 * Loads the electron app whenever vite is loaded in watch mode.
 * Reloads the app after the bundle has been written and closed.
 *
 * Only operates in watch mode.
 */
export function viteElectronAppPlugin(): PluginOption {
  const startApp = () => {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    electronApp = spawn(String(electronPath), ['--inspect=9223', '.'], { stdio: 'inherit' });
    // eslint-disable-next-line unicorn/no-process-exit
    electronApp.addListener('exit', () => process.exit());
  };

  let electronApp: ChildProcess | null = null;

  return {
    name: 'Load Electron app in watch mode',
    apply: 'build',
    buildStart() {
      // Only operate in watch mode.
      if (this.meta.watchMode !== true || !electronApp) return;

      electronApp.removeAllListeners();
      electronApp.kill('SIGINT');
      electronApp = null;
    },
    closeBundle() {
      // Only operate in watch mode.
      if (this.meta.watchMode === true) startApp();
    },
  };
}
