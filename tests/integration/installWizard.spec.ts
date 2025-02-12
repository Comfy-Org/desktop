import { type Locator, expect } from '@playwright/test';

import { test } from './autoCleaningTestApp';

test.describe('Install Wizard', () => {
  test('can click through first time installer', async ({ autoCleaningApp }) => {
    const window = await autoCleaningApp.firstWindow();
    await autoCleaningApp.attachScreenshot('screenshot-app-start');

    const getStartedButton = window.getByText('Get Started');
    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();
    await expect(window).toHaveScreenshot('get-started');
    await getStartedButton.click();

    const nextButton = window.getByRole('button', { name: 'Next' });
    const cpuToggle = window.locator('#cpu-mode');

    // Select GPU screen
    await expect(window.getByText('Select GPU')).toBeVisible();
    await expect(cpuToggle).toBeVisible();
    await expect(window).toHaveScreenshot('select-gpu');
    await cpuToggle.click();

    await expect(window).toHaveScreenshot('cpu-clicked');
    await clickEnabledButton(nextButton);

    // Install stepper screens
    await expect(window.getByText('Choose Installation Location')).toBeVisible();
    await expect(window).toHaveScreenshot('choose-installation-location');
    await clickEnabledButton(nextButton);

    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await expect(window).toHaveScreenshot('migrate-from-existing-installation');
    await clickEnabledButton(nextButton);

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await expect(window).toHaveScreenshot('desktop-app-settings');

    /** Ensure a button is enabled, then click it. */
    async function clickEnabledButton(button: Locator) {
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
    }
  });
});
