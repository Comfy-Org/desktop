import { type Page, type TestInfo, test as baseTest } from '@playwright/test';
import path from 'node:path';
import { env } from 'node:process';
import { pathExists } from 'tests/shared/utils';

import { TestApp } from './testApp';
import { TestEnvironment } from './testEnvironment';
import { TestGraphCanvas } from './testGraphCanvas';
import { TestInstallWizard } from './testInstallWizard';
import { TestInstalledApp } from './testInstalledApp';
import { TestServerStart } from './testServerStart';
import { TestTroubleshooting } from './testTroubleshooting';

export { expect } from '@playwright/test';

export function assertPlaywrightEnabled() {
  if (env.CI || env.COMFYUI_ENABLE_VOLATILE_TESTS === '1') return;

  throw new Error('COMFYUI_ENABLE_VOLATILE_TESTS must be set to "1"  to run tests.');
}

async function attachIfExists(testInfo: TestInfo, fullPath: string) {
  if (await pathExists(fullPath)) {
    await testInfo.attach(path.basename(fullPath), { path: fullPath });
  }
}

export interface DesktopTestOptions {
  /** Whether to dispose the test environment when the test is finished. Default: `false` */
  disposeTestEnvironment: boolean;
}

interface DesktopTestFixtures {
  /** Test app - represents the electron executable. */
  app: TestApp;
  /** The test environment - direct access to config files, venv, etc. */
  testEnvironment: TestEnvironment;
  /** The main window of the app. A normal Playwright page. */
  window: Page;
  /** The desktop troubleshooting screen. */
  troubleshooting: TestTroubleshooting;
  /** The desktop install wizard. */
  installWizard: TestInstallWizard;
  /** The server start screen. */
  serverStart: TestServerStart;
  /** The app when started up and running normally. Logical container for components like GraphCanvas. */
  installedApp: TestInstalledApp;
  /** Frontend GraphCanvas component. */
  graphCanvas: TestGraphCanvas;
  /** Attach a screenshot to the test results, for archival/manual review. Prefer toHaveScreenshot() in tests. */
  attachScreenshot: (name: string) => Promise<void>;
}

// Extend the base test
export const test = baseTest.extend<DesktopTestOptions & DesktopTestFixtures>({
  disposeTestEnvironment: [false, { option: true }],

  // Fixtures
  app: async ({ testEnvironment }, use, testInfo) => {
    // Launch Electron app.
    await using app = await TestApp.create(testInfo);
    await use(app);

    // Attach logs after test
    await attachIfExists(testInfo, testEnvironment.mainLogPath);
    await attachIfExists(testInfo, testEnvironment.comfyuiLogPath);

    // Delete logs if present
    await testEnvironment.deleteLogsIfPresent();
  },
  testEnvironment: async ({ disposeTestEnvironment }, use) => {
    await using testEnvironment = new TestEnvironment(disposeTestEnvironment);
    await use(testEnvironment);
  },
  window: async ({ app }, use, testInfo) => {
    const window = await app.firstWindow();
    await use(window);

    // Attach a screenshot if any errors occurred
    if (testInfo.error) {
      const screenshot = await window.screenshot();
      await testInfo.attach('Tear-down screenshot.png', { body: screenshot, contentType: 'image/png' });
    }
  },
  installedApp: async ({ window }, use) => {
    const installedApp = new TestInstalledApp(window);
    await use(installedApp);
  },
  troubleshooting: async ({ window }, use) => {
    const troubleshooting = new TestTroubleshooting(window);
    await use(troubleshooting);
  },

  // Views
  installWizard: async ({ window }, use) => {
    const installWizard = new TestInstallWizard(window);
    await use(installWizard);
  },
  serverStart: async ({ window }, use) => {
    const serverStart = new TestServerStart(window);
    await use(serverStart);
  },
  graphCanvas: async ({ installedApp }, use) => {
    await use(installedApp.graphCanvas);
  },

  // Functions
  attachScreenshot: async ({ window }, use, testInfo) => {
    const attachScreenshot = async (name: string) => {
      const screenshot = await window.screenshot();
      await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
    };
    await use(attachScreenshot);

    // When this fixture is requested but no screenshot is attached, attach a fallback
    if (!testInfo.attachments.some((a) => a.contentType === 'image/png')) {
      await attachScreenshot('Fallback screenshot.png');
    }
  },
});
