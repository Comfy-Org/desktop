import { pathExists } from '../shared/utils';
import { TestEnvironment } from './testEnvironment';
import { assertPlaywrightEnabled, expect, test as teardown } from './testExtensions';

// This "test" is a setup process.
// After running, the test environment should be completely uninstalled.

teardown('Completely uninstalls the app', async ({}) => {
  assertPlaywrightEnabled();

  const testEnvironment = new TestEnvironment();
  await testEnvironment.deleteAppData();
  await testEnvironment.deleteDefaultInstallLocation();

  await expect(pathExists(testEnvironment.appDataDir)).resolves.toBeFalsy();
  await expect(pathExists(testEnvironment.defaultInstallLocation)).resolves.toBeFalsy();
});
