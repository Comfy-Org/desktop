/* eslint-disable unicorn/prefer-top-level-await */
import dotenv from 'dotenv';
import { app, shell } from 'electron';
import { LevelOption } from 'electron-log';
import log from 'electron-log/main';

import { comfySettings } from './config/comfySettings';
import { DesktopApp } from './desktopApp';
import { AppState } from './main-process/appState';
import { DevOverrides } from './main-process/devOverrides';
import SentryLogging from './services/sentry';
import { getTelemetry } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';

// Synchronous pre-start configuration
dotenv.config();
initalizeLogging();

const telemetry = getTelemetry();
const appState = new AppState();
const overrides = new DevOverrides();

// Register the quit handlers regardless of single instance lock and before squirrel startup events.
quitWhenAllWindowsAreClosed();
trackAppQuitEvents();
initializeSentry();

// Async config & app start
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('App already running. Exiting...');
  app.quit();
} else {
  startApp().catch((error) => {
    log.error('Unhandled exception in app startup', error);
    app.exit(2020);
  });
}

/** Wrapper for top-level await; the app is bundled to CommonJS. */
async function startApp() {
  // Wait for electron app ready event
  await new Promise<void>((resolve) => app.once('ready', () => resolve()));
  log.debug('App ready');

  telemetry.registerHandlers();
  telemetry.track('desktop:app_ready');

  // Load config or exit
  const config = await DesktopConfig.load(shell);
  if (!config) {
    DesktopApp.fatalError({
      message: 'Unknown error loading app config on startup.',
      title: 'User Data',
      exitCode: 20,
    });
  }

  const isNewUser = config.get('basePath') === undefined;
  if (!isNewUser) await comfySettings.loadSettings();

  const desktopApp = new DesktopApp(appState, overrides, config);
  await desktopApp.showLoadingPage();
  await desktopApp.start();
}

/** Must be called prior to any logging. Sets default log level and logs app version. */
function initalizeLogging() {
  log.initialize();
  log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';
  log.info(`Starting app v${app.getVersion()}`);
}

/** Quit when all windows are closed.*/
function quitWhenAllWindowsAreClosed() {
  app.on('window-all-closed', () => {
    log.info('Quitting ComfyUI because window all closed');
    app.quit();
  });
}

/** Add telemetry for the app quit event. */
function trackAppQuitEvents() {
  app.on('quit', (event, exitCode) => {
    telemetry.track('desktop:app_quit', {
      reason: event,
      exitCode,
    });
  });
}

/** Sentry needs to be initialized at the top level. */
function initializeSentry() {
  log.verbose('Initializing Sentry');
  SentryLogging.init();
}
