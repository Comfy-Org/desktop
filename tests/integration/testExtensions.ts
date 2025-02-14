import { type Page, type TestInfo, test as baseTest } from '@playwright/test';
import { pathExists } from 'tests/shared/utils';

import { TestApp } from './testApp';
import { TestGraphCanvas } from './testGraphCanvas';
import { TestInstallWizard } from './testInstallWizard';
import { TestInstalledApp } from './testInstalledApp';
import { TestServerStart } from './testServerStart';

async function attachIfExists(testInfo: TestInfo, path: string) {
  if (await pathExists(path)) {
    await testInfo.attach('main.log', { path });
  }
}

interface DesktopTestOptions {
  /** Whether to dispose the test environment when the test is finished. */
  disposeTestEnvironment: boolean;
}

interface DesktopTestFixtures {
  /** Test app - represents the electron executable. */
  app: TestApp;
  /** The main window of the app. A normal Playwright page. */
  window: Page;
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
  app: async ({ disposeTestEnvironment }, use, testInfo) => {
    // Launch Electron app.
    await using app = await TestApp.create();
    app.shouldDisposeTestEnvironment = disposeTestEnvironment;
    await use(app);

    if (!disposeTestEnvironment) return;

    // Attach logs after test
    await attachIfExists(testInfo, app.testEnvironment.mainLogPath);
    await attachIfExists(testInfo, app.testEnvironment.comfyuiLogPath);
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await use(window);
  },
  installedApp: async ({ window }, use) => {
    const installedApp = new TestInstalledApp(window);
    await use(installedApp);
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
  },
});
