import { expect } from '@playwright/test';

import { test } from './testExtensions';

test.describe('Install Wizard', () => {
  test('can click through first time installer', async ({ autoCleaningApp, window }) => {
    await autoCleaningApp.attachScreenshot('screenshot-app-start');

    const getStartedButton = window.getByText('Get Started');
    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();
    await expect(window).toHaveScreenshot('get-started.png');
    await getStartedButton.click();

    const nextButton = window.getByRole('button', { name: 'Next' });
    const cpuToggle = window.locator('#cpu-mode');

    // Select GPU screen
    await expect(window.getByText('Select GPU')).toBeVisible();
    await expect(cpuToggle).toBeVisible();
    await expect(window).toHaveScreenshot('select-gpu.png');
    await cpuToggle.click();

    await expect(window).toHaveScreenshot('cpu-clicked.png');
    await nextButton.click();

    // Install stepper screens
    await expect(window.getByText('Choose Installation Location')).toBeVisible();
    await expect(window).toHaveScreenshot('choose-installation-location.png');
    await nextButton.click();

    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await expect(window).toHaveScreenshot('migrate-from-existing-installation.png');
    await nextButton.click();

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await expect(window).toHaveScreenshot('desktop-app-settings.png');
  });
});
