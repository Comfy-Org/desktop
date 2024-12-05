const {build} =  require('vite');
const electronPath = require('electron');
const {spawn} = require('child_process');

/** @type 'production' | 'development'' */
const mode = (process.env.MODE = process.env.MODE || 'development')

/** @type {import('vite').LogLevel} */
const logLevel = 'warn'

/**
 * Setup watcher for `main` package
 * On file changed it totally re-launch electron app.
 */
function setupMainPackageWatcher() {
	/** @type {ChildProcess | null} */
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
				name: 'reload-app-on-main-package-change',
				writeBundle() {
					/** Kill electron if process already exist */
					if (electronApp !== null) {
						electronApp.removeListener('exit', process.exit);
						electronApp.kill('SIGINT');
						electronApp = null;
					}

					/** Spawn new electron process */
					electronApp = spawn(String(electronPath), ['--remote-debugging-port=9000',  '--remote-allow-origins=http://127.0.0.1:9000', '.'], {
						stdio: 'inherit',
					});

					electronApp.addListener('')
					/** Stops the watch script when the application has been quit */
					electronApp.addListener('exit', process.exit);
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

(async () => {
	await setupPreloadPackageWatcher();
	await setupMainPackageWatcher();
})();
