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

console.log('👋 This message is being logged by "renderer.ts", included via Vite');

interface ProgressUpdate {
  percentage: number;
  status: string;
}

const progressBar = document.getElementById('progress') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;

function updateProgress({ percentage, status }: ProgressUpdate) {
  console.log(`Updating progress: ${percentage}%, ${status}`);
  progressBar.style.width = `${percentage}%`;
  loadingText.textContent = status;

  if (percentage === 100) {
    loadingText.textContent = 'ComfyUI is ready!';
  }
}

console.log('Checking for electronAPI...');
if ('electronAPI' in window) {
  console.log('electronAPI found, setting up listeners');
  (window as any).electronAPI.onProgressUpdate((update: ProgressUpdate) => {
    console.log("Received loading progress", update);
    updateProgress(update);
  });

  console.log('Requesting initial progress');
  (window as any).electronAPI.requestProgress();
} else {
  console.error('electronAPI not found in window object');
}
