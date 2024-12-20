import { build } from 'vite';
import electronPath from 'electron';
import { spawn } from 'node:child_process';

// Starts the app using the vite dev server, for use in playwright e2e testing.
// Needs to be replaced with something more permanent at some point.

/** @type {'production' | 'development'} */
const mode = (process.env.MODE = process.env.MODE || 'development');

/** @type {import('vite').LogLevel} */
const logLevel = 'warn';

/** @returns {import('vite').PluginOption} */
function runAppAfterBuild() {
  return {
    name: 'reload-app-on-main-package-change-a',
    writeBundle() {
      // CI-specific Electron launch args
      const args = ['--remote-debugging-port=9000', '--remote-allow-origins=http://127.0.0.1:9000', '.'];

      /** Spawn new electron process */
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const electronApp = spawn(String(electronPath), args, { stdio: 'inherit' });

      /** Stops the watch script when the application has been quit */
      electronApp.addListener('exit', () => process.exit());
    },
  };
}

/**
 * Setup watcher for `main` package
 * On file changed it totally re-launch electron app.
 */
function setupMainPackageWatcher() {
  return build({
    mode,
    logLevel,
    configFile: 'vite.main.config.ts',
    plugins: [runAppAfterBuild()],
  });
}

await setupMainPackageWatcher();
