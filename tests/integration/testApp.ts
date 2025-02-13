import { type ElectronApplication, type TestInfo } from '@playwright/test';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-base-to-string
const executablePath = String(electronPath);

const isCI = !!process.env.CI;

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
  protected constructor(
    readonly app: ElectronApplication,
    readonly testInfo: TestInfo
  ) {}

  /** Async static factory */
  static async create(testInfo: TestInfo) {
    const app = await TestApp.launchElectron();
    return new TestApp(app, testInfo);
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
    });
    await localTestQoL(app);
    return app;
  }

  /** Attaches a screenshot to the test results. Prefer toHaveScreenshot() in tests. */
  async attachScreenshot(name: string) {
    const window = await this.firstWindow();
    const screenshot = await window.screenshot();
    await this.testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
  }

  /** Dispose: close the app. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.app[Symbol.asyncDispose]();
  }
}
