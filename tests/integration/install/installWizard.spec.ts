import { expect, test } from '../testExtensions';

test.describe('Install Wizard', () => {
  test('can click through first time installer', async ({ installWizard, window, attachScreenshot }) => {
    await attachScreenshot('screenshot-app-start');

    const getStartedButton = window.getByText('Get Started');
    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();
    await expect(window).toHaveScreenshot('get-started.png');
    await installWizard.clickGetStarted();

    // Select GPU screen
    await expect(installWizard.selectGpuTitle).toBeVisible();
    await expect(installWizard.cpuToggle).toBeVisible();
    await expect(window).toHaveScreenshot('select-gpu.png');
    await installWizard.cpuToggle.click();

    await expect(window).toHaveScreenshot('cpu-clicked.png');
    await installWizard.clickNext();

    // Install stepper screens
    await expect(installWizard.installLocationTitle).toBeVisible();
    await expect.soft(window).toHaveScreenshot('choose-installation-location.png');
    await installWizard.clickNext();

    await expect(installWizard.migrateTitle).toBeVisible();
    await expect(window).toHaveScreenshot('migrate-from-existing-installation.png');
    await installWizard.clickNext();

    await expect(installWizard.desktopSettingsTitle).toBeVisible();
    await expect(window).toHaveScreenshot('desktop-app-settings.png');
  });
});
