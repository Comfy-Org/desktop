import { getDefaultInstallLocation } from 'tests/shared/utils';

import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken install path', () => {
  test.beforeEach(async ({ testEnvironment }) => {
    await testEnvironment.breakInstallPath();
  });

  test('Troubleshooting page loads when base path is invalid', async ({ troubleshooting, window }) => {
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

  test('Can fix install path', async ({ troubleshooting, app, serverStart }) => {
    await troubleshooting.expectReady();
    const { basePathCard } = troubleshooting;
    await expect(basePathCard.rootEl).toBeVisible();

    const filePath = getDefaultInstallLocation();
    await app.app.evaluate((electron, filePath) => {
      // "Mock" the native dialog
      electron.dialog.showOpenDialog = async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { canceled: false, filePaths: [filePath] };
      };
    }, filePath);

    await basePathCard.button.click();

    // Wait for install to be valid via IPC
    await troubleshooting.expectInstallValid();

    // Base path fixed - server should start
    await serverStart.expectServerStarts();
  });
});
