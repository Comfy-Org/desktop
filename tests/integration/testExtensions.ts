import { type Page, type TestInfo, test as baseTest } from '@playwright/test';
import { pathExists } from 'tests/shared/utils';

import { AutoCleaningTestApp } from './autoCleaningTestApp';
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
  /** Test app that cleans up AppData and the install directory when disposed. */
  autoCleaningApp: AutoCleaningTestApp;
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
  autoCleaningApp: async ({}, use, testInfo) => {
    // Launch Electron app.
    await using app = await AutoCleaningTestApp.create(testInfo);
    await use(app);

    // After test
    const appEnv = app.testEnvironment;
    await attachIfExists(testInfo, appEnv.mainLogPath);
    await attachIfExists(testInfo, appEnv.comfyuiLogPath);
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
