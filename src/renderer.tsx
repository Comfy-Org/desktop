/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';
import ReactDOM from 'react-dom/client';
import * as React from 'react';
import Home from './renderer/index';
import * as Sentry from '@sentry/electron/renderer';
import { ELECTRON_BRIDGE_API, SENTRY_URL_ENDPOINT } from './constants';
import { ElectronAPI } from './preload';

if (ELECTRON_BRIDGE_API in window) {
  const electronAPI: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];
  electronAPI.isPackaged().then((isPackaged) => {
    if (isPackaged) {
      //TODO set up report dialog
      Sentry.init({
        dsn: SENTRY_URL_ENDPOINT,
      });
    }
  });
}

// Generate the the app then render the root
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Home />);
