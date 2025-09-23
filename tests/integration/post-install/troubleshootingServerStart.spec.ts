import { expect, test } from '../testExtensions';

// - Causes server start to fail
// - Accesses troubleshooting page
// - Verifies screenshot
// - Only works on CPU runner

test.describe('Troubleshooting - cannot start server', () => {
  test.beforeEach(async ({ testEnvironment }) => {
    await testEnvironment.breakServerStart();
  });

  test('Troubleshooting page is offered when server cannot start', async ({ serverStart, troubleshooting, window }) => {
    await serverStart.expectServerStarts();

    await expect(serverStart.troubleshootButton).toBeVisible({ timeout: 30 * 1000 });
    await expect(window).toHaveScreenshot('cannot-start-server-troubleshoot.png', {
      mask: [serverStart.status.errorDesktopVersion],
    });
    await serverStart.troubleshootButton.click();

    // No detected error - should see all cards
    await expect(troubleshooting.basePathCard.rootEl).toBeVisible();
    await expect(troubleshooting.vcRedistCard.rootEl).toBeVisible();
    await expect(troubleshooting.installPythonPackagesCard.rootEl).toBeVisible();
    await expect(troubleshooting.resetVenvCard.rootEl).toBeVisible();

    await expect(window).toHaveScreenshot('cannot-start-server-troubleshoot-cards.png');
  });
});
