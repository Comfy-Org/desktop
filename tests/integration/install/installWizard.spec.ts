import { expect } from '@playwright/test';

import { test } from '../testExtensions';

test.use({ disposeTestEnvironment: true });

test.describe('Install Wizard', () => {
  test('can click through first time installer', async ({ installWizard, window, attachScreenshot }) => {
    await attachScreenshot('screenshot-app-start');

    const getStartedButton = window.getByText('Get Started');
    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();
    await expect(window).toHaveScreenshot('get-started.png');
    await installWizard.clickGetStarted();

    // Select GPU screen
    await expect(window.getByText('Select GPU')).toBeVisible();
    await expect(installWizard.cpuToggle).toBeVisible();
    await expect(window).toHaveScreenshot('select-gpu.png');
    await installWizard.cpuToggle.click();

    await expect(window).toHaveScreenshot('cpu-clicked.png');
    await installWizard.clickNext();

    // Install stepper screens
    await expect(window.getByText('Choose Installation Location')).toBeVisible();
    await expect(window).toHaveScreenshot('choose-installation-location.png');
    await installWizard.clickNext();

    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await expect(window).toHaveScreenshot('migrate-from-existing-installation.png');
    await installWizard.clickNext();

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await expect(window).toHaveScreenshot('desktop-app-settings.png');
  });
});
