import { getDefaultInstallLocation } from 'tests/shared/utils';

import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken install path', () => {
  test.beforeEach(async ({ app }) => {
    console.log('Troubleshooting.spec.ts: Breaking install path');
    await app.testEnvironment.breakInstallPath();
    console.log('Troubleshooting.spec.ts: Install path broken');
  });

  test('Troubleshooting page loads when base path is invalid', async ({ troubleshooting, window }) => {
    console.log('Troubleshooting.spec.ts: START Troubleshooting page loads when base path is invalid');
    await troubleshooting.expectReady();
    await expect(troubleshooting.basePathCard.rootEl).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting.png');
    console.log('Troubleshooting.spec.ts: END Troubleshooting page loads when base path is invalid');
  });

  test('Refresh button is disabled whilst refreshing', async ({ troubleshooting }) => {
    await troubleshooting.refresh();
    await expect(troubleshooting.refreshButton).toBeDisabled();

    // Wait for the refresh to complete
    await troubleshooting.expectReady();
  });

  test('Can fix install path', async ({ troubleshooting, app, serverStart, window }) => {
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
    await expect(basePathCard.isRunningIndicator).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting-base-path.png');

    // Base path fixed - server should start
    await serverStart.expectServerStarts();
  });
});
