import { type Page, type TestInfo, test as baseTest } from '@playwright/test';
import { pathExists } from 'tests/shared/utils';

import { TestApp } from './testApp';
import { TestInstallWizard } from './testInstallWizard';

async function attachIfExists(testInfo: TestInfo, path: string) {
  if (await pathExists(path)) {
    await testInfo.attach('main.log', { path });
  }
}

interface DesktopTestFixtures {
  /** Regular test app, no clean up. */
  app: TestApp;
  /** Test app that attaches logs then performs a clean uninstall when disposed. */
  autoCleaningApp: TestApp;
  /** The main window of the app. */
  window: Page;
  /** The desktop install wizard. */
  installWizard: TestInstallWizard;
}

// Extend the base test
export const test = baseTest.extend<DesktopTestFixtures>({
  app: async ({}, use, testInfo) => {
    // Launch Electron app.
    await using app = await TestApp.create(testInfo);
    await use(app);
  },
  autoCleaningApp: async ({ app }, use, testInfo) => {
    app.shouldDisposeTestEnvironment = true;
    await use(app);

    // Attach logs after test
    await attachIfExists(testInfo, app.testEnvironment.mainLogPath);
    await attachIfExists(testInfo, app.testEnvironment.comfyuiLogPath);
  },
  window: async ({ app }, use) => {
    await using window = await app.firstWindow();
    await use(window);
  },
  installWizard: async ({ window }, use, testInfo) => {
    await using installWizard = new TestInstallWizard(window, testInfo);
    await use(installWizard);
  },
});
