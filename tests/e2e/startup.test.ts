import { test, _electron as electron, expect } from '@playwright/test';

test('launch app', async () => {
  const electronApp = await electron.launch({ args: ['.'] });
  electronApp.process().stdout?.on?.('data', (data) => {
    console.log(`Electron stdout: ${data}`);
  });
  electronApp.process().stderr?.on?.('data', (data) => {
    console.error(`Electron stderr: ${data}`);
  });

  const isPackaged = await electronApp.evaluate(async ({ app }) => {
    // This runs in Electron's main process, parameter here is always
    // the result of the require('electron') in the main app script.
    return app.isPackaged;
  });

  expect(isPackaged).toBe(false);

  // Wait for the first BrowserWindow to open
  // and return its Page object
  const window = await electronApp.firstWindow();
  await expect(window).toHaveScreenshot('startup.png');

  await electronApp.close();
});
