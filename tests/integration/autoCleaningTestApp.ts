import { type TestInfo, test as testBase } from '@playwright/test';
import { pathExists } from 'tests/shared/utils';

import { TestApp } from './testApp';
import { TestEnvironment } from './testEnvironment';

async function attachIfExists(testInfo: TestInfo, path: string) {
  if (await pathExists(path)) {
    await testInfo.attach('main.log', { path });
  }
}

export const test = testBase.extend<{ autoCleaningApp: AutoCleaningTestApp }>({
  autoCleaningApp: async ({}, use, testInfo) => {
    // Launch Electron app.
    await using app = await AutoCleaningTestApp.create();
    await use(app);

    // After test
    const appEnv = app.testEnvironment;
    await attachIfExists(testInfo, appEnv.mainLogPath);
    await attachIfExists(testInfo, appEnv.comfyuiLogPath);
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
