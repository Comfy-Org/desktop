import { type ElectronApplication, type TestInfo } from '@playwright/test';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';

import { TestEnvironment } from './testEnvironment';

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
  /** The test environment. */
  readonly testEnvironment: TestEnvironment = new TestEnvironment();

  /** Remove the install directory when disposed. */
  shouldDisposeTestEnvironment: boolean = false;

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

  async close() {
    const windows = this.app.windows();
    if (windows.length === 0) return;

    const close = this.app.waitForEvent('close');
    await Promise.all(windows.map((x) => x.close()));
    await close;
  }

  /** Ensure the app is disposed only once. */
  #disposed = false;

  /** Dispose: close the app and all disposable objects. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    await this.close();
    if (this.shouldDisposeTestEnvironment) await this.testEnvironment[Symbol.asyncDispose]();
  }
}
