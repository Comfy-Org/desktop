import { test as testBase } from '@playwright/test';

import { TestApp } from './testApp';
import { TestEnvironment } from './testEnvironment';

export const test = testBase.extend<{ autoCleaningApp: AutoCleaningTestApp }>({
  autoCleaningApp: async ({}, use) => {
    // Launch Electron app.
    await using app = await AutoCleaningTestApp.create();
    await use(app);
  },
});

/**
 * {@link TestApp} that cleans up AppData and the install directory when disposed.
 */
export class AutoCleaningTestApp extends TestApp implements AsyncDisposable {
  readonly testEnvironment: TestEnvironment = new TestEnvironment();

  static async create() {
    const app = await TestApp.launchElectron();
    return new AutoCleaningTestApp(app);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await super[Symbol.asyncDispose]();
    await this.testEnvironment[Symbol.asyncDispose]();
  }
}
