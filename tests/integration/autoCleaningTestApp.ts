import type { TestInfo } from '@playwright/test';

import { TestApp } from './testApp';
import { TestEnvironment } from './testEnvironment';

/**
 * {@link TestApp} that cleans up AppData and the install directory when disposed.
 */
export class AutoCleaningTestApp extends TestApp implements AsyncDisposable {
  readonly testEnvironment: TestEnvironment = new TestEnvironment();

  static async create(testInfo: TestInfo) {
    const app = await TestApp.launchElectron();
    return new AutoCleaningTestApp(app, testInfo);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await super[Symbol.asyncDispose]();
    await this.testEnvironment[Symbol.asyncDispose]();
  }
}
