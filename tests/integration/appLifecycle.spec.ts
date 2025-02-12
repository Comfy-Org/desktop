import { type Locator, expect } from '@playwright/test';

import { test } from './testApp';

test.describe('App Lifecycle', () => {
  test('does all app startup things from previous test', async ({ testApp }) => {
    const window = await testApp.firstWindow();

    const getStartedButton = window.getByText('Get Started');

    await expect(getStartedButton).toBeVisible();
    await expect(getStartedButton).toBeEnabled();

    await window.screenshot({ path: 'screenshot-load.png' });

    await getStartedButton.click();

    // Select GPU screen
    await expect(window.getByText('Select GPU')).toBeVisible();

    const nextButton = window.getByRole('button', { name: 'Next' });
    const cpuToggle = window.locator('#cpu-mode');

    await expect(cpuToggle).toBeVisible();
    await cpuToggle.click();

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Choose Installation Location')).toBeVisible();
    await window.screenshot({ path: 'screenshot-get-started.png' });

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await window.screenshot({ path: 'screenshot-migrate.png' });

    await clickEnabledButton(nextButton);

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await window.screenshot({ path: 'screenshot-install.png' });

    /** Ensure a button is enabled, then click it. */
    async function clickEnabledButton(button: Locator) {
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
    }
  });
});
