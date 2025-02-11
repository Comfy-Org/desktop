import { type ElectronApplication, test as baseTest } from '@playwright/test';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-base-to-string
const executablePath = String(electronPath);

const isCI = !!process.env.CI;

export const test = baseTest.extend<{ testApp: TestApp }>({
  testApp: async ({}, use) => {
    // Launch Electron app.
    await using testApp = await TestApp.create();
    await use(testApp);
  },
});

export class TestApp implements AsyncDisposable {
  private constructor(readonly app: ElectronApplication) {}

  static async create() {
    const app = await electron.launch({
      args: ['.'],
      executablePath,
      cwd: '.',
      env: {},
    });
    const testApp = new TestApp(app);

    // Local testing QoL
    if (!isCI) {
      // Get the first window that the app opens, wait if necessary.
      const window = await testApp.firstWindow();
      // Direct Electron console to Node terminal.
      window.on('console', console.log);
    }

    return testApp;
  }

  async firstWindow() {
    return this.app.firstWindow();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.app[Symbol.asyncDispose]();
  }
}
