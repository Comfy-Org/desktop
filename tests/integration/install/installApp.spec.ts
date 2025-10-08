import { expect, test } from '../testExtensions';

test.describe('Install App', () => {
  test('Can install app', async ({ installWizard, installedApp, serverStart, testEnvironment, window }) => {
    test.slow();

    await installWizard.clickGetStarted();

    // Select CPU as torch device
    await installWizard.cpuToggle.click();
    await installWizard.clickNext();

    // Install to temp dir
    const { installLocation } = testEnvironment;
    await expect(installWizard.installLocationTitle).toBeVisible();
    await installWizard.installLocationInput.fill(installLocation.path);
    await installWizard.clickNext();

    // Install stepper screens (migration is part of install location now)
    await expect(installWizard.desktopSettingsTitle).toBeVisible();
    await installWizard.installButton.click();

    const status = await serverStart.status.get();
    expect(['loading', 'setting up python']).toContain(status);

    // When the terminal is hidden and no error is shown, the install is successful
    await expect(serverStart.terminal).not.toBeVisible({ timeout: 5 * 60 * 1000 });
    await expect(serverStart.status.error).not.toBeVisible();
    await expect(serverStart.showTerminalButton).not.toBeVisible();

    // Wait for the progress spinner to disappear
    await installedApp.waitUntilLoaded();

    // Confirm post-install app state is as expected
    await expect(installedApp.firstTimeTemplateWorkflowText).toBeVisible({ timeout: 30 * 1000 });
    await expect(window).toHaveScreenshot('installApp.png');
  });
});
