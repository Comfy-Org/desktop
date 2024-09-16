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
import { ELECTRON_BRIDGE_API } from './constants';
import log from 'electron-log/renderer';

log.info('👋 This message is being logged by "renderer.ts", included via Vite');

interface ProgressUpdate {
  percentage: number;
  status: string;
}

const progressBar = document.getElementById('progress') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;

function updateProgress({ percentage, status }: ProgressUpdate) {
  log.info(`Updating progress: ${percentage}%, ${status}`);
  progressBar.style.width = `${percentage}%`;
  loadingText.textContent = status;

  if (percentage === 100) {
    loadingText.textContent = 'ComfyUI is ready!';
  }
}

if (ELECTRON_BRIDGE_API in window) {
  log.info(`${ELECTRON_BRIDGE_API} found, setting up listeners`);
  (window as any).electronAPI.onProgressUpdate((update: ProgressUpdate) => {
    log.info('Received loading progress', update);
    updateProgress(update);
  });
} else {
  console.error(`${ELECTRON_BRIDGE_API} not found in window object`);
}
