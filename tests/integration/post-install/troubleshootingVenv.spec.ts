import { expect, test } from '../testExtensions';

test.describe('Troubleshooting - broken venv', () => {
  test.beforeEach(async ({ testEnvironment }) => {
    await testEnvironment.breakVenv();
  });

  test('Troubleshooting page loads when venv is broken', async ({ troubleshooting, window }) => {
    await troubleshooting.expectReady();
    await expect(troubleshooting.resetVenvCard.rootEl).toBeVisible();
    await expect(window).toHaveScreenshot('troubleshooting-venv.png');
  });

  test('Can fix venv', async ({ troubleshooting, installedApp, window }) => {
    test.slow();

    await troubleshooting.expectReady();
    const { resetVenvCard } = troubleshooting;
    await expect(resetVenvCard.rootEl).toBeVisible();

    await resetVenvCard.button.click();
    await troubleshooting.confirmRecreateVenvButton.click();
    await expect(resetVenvCard.isRunningIndicator).toBeVisible();

    await expect(window.getByRole('heading', { name: 'Updating ComfyUI Desktop' })).toBeVisible({
      timeout: 60 * 1000,
    });

    // Venv fixed - server should start
    await installedApp.waitUntilLoaded(3 * 60 * 1000);
  });
});
