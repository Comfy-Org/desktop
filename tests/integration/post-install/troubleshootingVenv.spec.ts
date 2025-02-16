import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken venv', () => {
  test.beforeEach(async ({ app }) => {
    await app.testEnvironment.breakVenv();
  });

  test('Troubleshooting page loads when venv is broken', async ({ troubleshooting, window }) => {
    await troubleshooting.expectReady();
    await expect(troubleshooting.resetVenvCard.rootEl).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting-venv.png');
  });

  test('Can fix venv', async ({ troubleshooting, serverStart, installedApp }) => {
    await troubleshooting.expectReady();
    const { resetVenvCard, installPythonPackagesCard } = troubleshooting;
    await expect(resetVenvCard.rootEl).toBeVisible();

    await resetVenvCard.button.click();
    await troubleshooting.confirmRecreateVenvButton.click();
    await expect(resetVenvCard.isRunningIndicator).toBeVisible();

    await expect(installPythonPackagesCard.rootEl).toBeVisible({ timeout: 30 * 1000 });
    await installPythonPackagesCard.button.click();
    await troubleshooting.confirmInstallPythonPackagesButton.click();
    await expect(installPythonPackagesCard.isRunningIndicator).toBeVisible();

    // Venv fixed - server should start
    await serverStart.expectServerStarts();

    await installedApp.waitUntilLoaded();
  });
});
