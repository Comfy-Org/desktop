import { type Locator, expect } from '@playwright/test';

import { test } from './autoCleaningTestApp';

test.describe('App Lifecycle', () => {
  test('can click through first time installer', async ({ autoCleaningApp }) => {
    const window = await autoCleaningApp.firstWindow();
    await autoCleaningApp.attachScreenshot('screenshot-app-start');

    const getStartedButton = window.getByText('Get Started');

    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();

    await autoCleaningApp.attachScreenshot('screenshot-load');

    await getStartedButton.click();

    // Select GPU screen
    await expect(window.getByText('Select GPU')).toBeVisible();

    const nextButton = window.getByRole('button', { name: 'Next' });
    const cpuToggle = window.locator('#cpu-mode');

    await expect(cpuToggle).toBeVisible();
    await cpuToggle.click();

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Choose Installation Location')).toBeVisible();
    await autoCleaningApp.attachScreenshot('screenshot-get-started');

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await autoCleaningApp.attachScreenshot('screenshot-migrate');

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await autoCleaningApp.attachScreenshot('screenshot-install');

    /** Ensure a button is enabled, then click it. */
    async function clickEnabledButton(button: Locator) {
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
    }
  });
});
