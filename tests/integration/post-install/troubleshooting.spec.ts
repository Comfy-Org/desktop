import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken install path', () => {
  test.beforeEach(async ({ app }) => {
    await app.testEnvironment.breakInstallPath();
  });

  test.afterEach(async ({ app }) => {
    await app.testEnvironment.restoreInstallPath();
  });

  test('Troubleshooting page loads when base path is invalid', async ({ troubleshooting, window }) => {
    await expect(troubleshooting.refreshButton).toBeVisible();
    await troubleshooting.expectReady();
    await expect(troubleshooting.basePathCard.rootEl).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting.png');
  });

  test('Refresh button is disabled whilst refreshing', async ({ troubleshooting }) => {
    await troubleshooting.refresh();
    await expect(troubleshooting.refreshButton).toBeDisabled();

    // Wait for the refresh to complete
    await troubleshooting.expectReady();
  });

  test('Can fix install path', async ({ troubleshooting, window }) => {
    await troubleshooting.expectReady();
    await troubleshooting.basePathCard.button.click();

    await expect(window).toHaveScreenshot('troubleshooting-base-path.png');
  });
});
