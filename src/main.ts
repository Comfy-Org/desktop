/* eslint-disable unicorn/prefer-top-level-await */
import dotenv from 'dotenv';
import { app, session, shell } from 'electron';
import { LevelOption } from 'electron-log';
import log from 'electron-log/main';

import { LogFile } from './constants';
import { DesktopApp } from './desktopApp';
import { removeAnsiCodesTransform, replaceFileLoggingTransform } from './infrastructure/structuredLogging';
import { initializeAppState } from './main-process/appState';
import { DevOverrides } from './main-process/devOverrides';
import SentryLogging from './services/sentry';
import { getTelemetry } from './services/telemetry';
import { DesktopConfig } from './store/desktopConfig';
import { rotateLogFiles } from './utils';
import { getStartupDebugLogger } from './utils/startupDebugLogger';

// Synchronous pre-start configuration
dotenv.config();
initalizeLogging();

const telemetry = getTelemetry();
initializeAppState();
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
  const debugLog = getStartupDebugLogger();
  debugLog.log('Main', 'startApp() called');
  const appTimer = debugLog.startTimer('Main:totalStartup');

  // Wait for electron app ready event
  debugLog.log('Main', 'Waiting for app ready event');
  await new Promise<void>((resolve) => app.once('ready', () => resolve()));
  debugLog.log('Main', 'App ready event received');

  await rotateLogFiles(app.getPath('logs'), LogFile.Main, 50);
  log.debug('App ready');

  debugLog.log('Main', 'Registering telemetry handlers');
  telemetry.registerHandlers();
  telemetry.track('desktop:app_ready');

  // Load config or exit
  debugLog.log('Main', 'Loading desktop config');
  const config = await DesktopConfig.load(shell);
  if (!config) {
    debugLog.log('Main', 'Failed to load config, fatal error');
    DesktopApp.fatalError({
      message: 'Unknown error loading app config on startup.',
      title: 'User Data',
      exitCode: 20,
    });
  }
  debugLog.log('Main', 'Config loaded successfully');

  telemetry.loadGenerationCount(config);

  // Load the Vue DevTools extension
  if (process.env.VUE_DEVTOOLS_PATH) {
    try {
      await session.defaultSession.loadExtension(process.env.VUE_DEVTOOLS_PATH);
    } catch (error) {
      log.error('Error loading Vue DevTools extension', error);
    }
  }

  debugLog.log('Main', 'Creating DesktopApp instance');
  const desktopApp = new DesktopApp(overrides, config);

  debugLog.log('Main', 'Showing loading page');
  await desktopApp.showLoadingPage();

  debugLog.log('Main', 'Starting DesktopApp');
  await desktopApp.start();

  appTimer();
  debugLog.log('Main', 'App startup complete');
}

/**
 * Must be called prior to any logging. Sets default log level and logs app version.
 * Corrects issues when logging structured data (to file).
 */
function initalizeLogging() {
  log.initialize();
  log.transports.file.level = (process.env.LOG_LEVEL as LevelOption) ?? 'info';
  log.transports.file.transforms.unshift(removeAnsiCodesTransform);
  replaceFileLoggingTransform(log.transports);

  // Set the app version for the desktop app. Relied on by Manager and other sub-processes.
  process.env.__COMFYUI_DESKTOP_VERSION__ = app.getVersion();
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
