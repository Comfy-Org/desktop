import { type Locator, expect } from '@playwright/test';

import { test } from './testApp';

test.describe('App Lifecycle', () => {
  test('has title', async ({ testApp }) => {
    const window = await testApp.firstWindow();
    await expect(window).toHaveTitle('ComfyUI');
  });

  test('does all app startup things from previous test', async ({ testApp }) => {
    const page = await testApp.firstWindow();

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/ComfyUI/);

    const getStartedButton = page.getByText('Get Started');

    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();

    await page.screenshot({ path: 'screenshot-load.png' });

    await getStartedButton.click();

    // Select GPU screen
    await expect(page.getByText('Select GPU')).toBeVisible();

    const nextButton = page.getByRole('button', { name: 'Next' });
    const cpuToggle = page.locator('#cpu-mode');

    await expect(cpuToggle).toBeVisible();
    await cpuToggle.click();

    await clickEnabledButton(nextButton);

    await expect(page.getByText('Choose Installation Location')).toBeVisible();
    await page.screenshot({ path: 'screenshot-get-started.png' });

    await clickEnabledButton(nextButton);

    await expect(page.getByText('Migrate from Existing Installation')).toBeVisible();
    await page.screenshot({ path: 'screenshot-migrate.png' });

    await clickEnabledButton(nextButton);

    await expect(page.getByText('Desktop App Settings')).toBeVisible();
    await page.screenshot({ path: 'screenshot-install.png' });

    /** Ensure a button is enabled, then click it. */
    async function clickEnabledButton(button: Locator) {
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
    }
  });

  test('app quits when window is closed', async ({ testApp }) => {
    const window = await testApp.firstWindow();

    await window.close();
    await testApp.app.waitForEvent('close');
  });
});
