import { build } from 'vite';
import electronPath from 'electron';
import { spawn } from 'node:child_process';

/** @type {'production' | 'development'} */
const mode = (process.env.MODE = process.env.MODE || 'development');

/** @type {import('vite').LogLevel} */
const logLevel = 'warn';

/**
 * Setup watcher for `main` package
 * On file changed it totally re-launch electron app.
 */
function setupMainPackageWatcher() {
  /** @type {import('node:child_process').ChildProcess | null} */
  let electronApp = null;

  return build({
    mode,
    logLevel,
    configFile: 'vite.main.config.ts',
    build: {
      /**
       * Set to {} to enable rollup watcher
       * @see https://vitejs.dev/config/build-options.html#build-watch
       */
      watch: {},
    },
    plugins: [
      {
        name: 'reload-app-on-main-package-change-a',
        writeBundle() {
          /** Kill electron if process already exist */
          if (electronApp !== null) {
            electronApp.removeListener('exit', () => process.exit());
            electronApp.kill('SIGINT');
            electronApp = null;
          }

          const args = process.env.CI
            ? ['--remote-debugging-port=9000', '--remote-allow-origins=http://127.0.0.1:9000']
            : ['--inspect=9223'];

          /** Spawn new electron process */
          electronApp = spawn(String(electronPath), [...args, '.'], {
            stdio: 'inherit',
          });

          /** Stops the watch script when the application has been quit */
          electronApp.addListener('exit', () => process.exit());
        },
      },
    ],
  });
}

/**
 * Setup watcher for `preload` package
 * On file changed it reload web page.
 */
function setupPreloadPackageWatcher() {
  return build({
    mode,
    logLevel,
    configFile: 'vite.preload.config.ts',
    build: {
      /**
       * Set to {} to enable rollup watcher
       * @see https://vitejs.dev/config/build-options.html#build-watch
       */
      watch: {},
    },
    plugins: [
      {
        name: 'reload-page-on-preload-package-change',
        writeBundle() {},
      },
    ],
  });
}

await setupPreloadPackageWatcher();
await setupMainPackageWatcher();
