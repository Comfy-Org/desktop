import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function getLogFile() {
  const logPath = path.join(os.homedir(), '.config', 'ComfyUI', 'logs', 'main.log');
  return await fs.readFile(logPath, 'utf8');
}

test('app quits when window is closed', async () => {
  const logContentBefore = await getLogFile();

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9000');
  expect(browser.isConnected()).toBeTruthy();

  const context = browser.contexts()[0];
  const page = context.pages()[0];

  // Close the window
  await page.close();

  // Give the app a moment to write logs
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Check the logs
  const logContentAfter = await getLogFile();
  const newLogs = logContentAfter.slice(logContentBefore.length);

  expect(newLogs).toContain('Quitting ComfyUI because window all closed');
});
