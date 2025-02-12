import { type ElectronApplication, test as baseTest } from '@playwright/test';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-base-to-string
const executablePath = String(electronPath);

const isCI = !!process.env.CI;

// Extend the base test
export const test = baseTest.extend<{ app: TestApp }>({
  app: async ({}, use) => {
    // Launch Electron app.
    await using app = await TestApp.create();
    await use(app);
  },
});

// Local testing QoL
async function localTestQoL(app: ElectronApplication) {
  if (isCI) return;

  // Get the first window that the app opens, wait if necessary.
  const window = await app.firstWindow();
  // Direct Electron console to Node terminal.
  window.on('console', console.log);
}

/**
 * Base class for desktop e2e tests.
 */
export class TestApp implements AsyncDisposable {
  protected constructor(readonly app: ElectronApplication) {}

  /** Async static factory */
  static async create() {
    const app = await TestApp.launchElectron();
    return new TestApp(app);
  }

  /** Get the first window that the app opens.  Wait if necessary. */
  async firstWindow() {
    return await this.app.firstWindow();
  }

  /** Executes the Electron app. If not in CI, logs browser console via `console.log()`. */
  protected static async launchElectron() {
    const app = await electron.launch({
      args: ['.'],
      executablePath,
      cwd: '.',
      env: {},
    });
    await localTestQoL(app);
    return app;
  }

  /** Dispose: close the app. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.app[Symbol.asyncDispose]();
  }
}
