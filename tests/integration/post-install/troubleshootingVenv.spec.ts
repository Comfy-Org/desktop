import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken venv', () => {
  test.beforeEach(async ({ app }) => {
    await app.testEnvironment.breakVenv();
  });

  test.afterEach(async ({ app }) => {
    await app.testEnvironment.restoreVenv();
  });

  test('Troubleshooting page loads when venv is broken', async ({ troubleshooting, window }) => {
    await troubleshooting.expectReady();
    await expect(troubleshooting.resetVenvCard.rootEl).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting-venv.png');
  });

  test('Can fix venv', async ({ troubleshooting, serverStart, window }) => {
    await troubleshooting.expectReady();
    const { resetVenvCard } = troubleshooting;
    await expect(resetVenvCard.rootEl).toBeVisible();

    await resetVenvCard.button.click();
    await expect(resetVenvCard.isRunningIndicator).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting-reset-venv.png');

    // Venv fixed - server should start
    await serverStart.expectServerStarts();
  });
});
