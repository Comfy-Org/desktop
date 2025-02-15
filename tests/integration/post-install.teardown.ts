import { pathExists } from '../shared/utils';
import { TestEnvironment } from './testEnvironment';
import { expect, test as teardown } from './testExtensions';

// This "test" is a setup process.  Any failure here should break all post-install tests.
// After running, the test environment will contain an installed ComfyUI app, ready for other tests to use as a base.

teardown('Completely uninstalls the app', async ({}) => {
  const testEnvironment = new TestEnvironment();
  await testEnvironment.deleteAppData();
  await testEnvironment.deleteDefaultInstallLocation();

  await expect(pathExists(testEnvironment.appDataDir)).resolves.toBeFalsy();
  await expect(pathExists(testEnvironment.defaultInstallLocation)).resolves.toBeFalsy();
});
