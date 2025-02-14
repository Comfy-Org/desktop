import { expect } from '@playwright/test';

import { test } from '../testExtensions';

test.use({ disposeTestEnvironment: true });

test.describe('Install App', () => {
  test('Can install app', async ({ installWizard, installedApp, serverStart, window, app }) => {
    test.slow();

    await installWizard.clickGetStarted();

    // Select CPU as torch device
    await installWizard.cpuToggle.click();
    await installWizard.clickNext();

    // Install to temp dir
    const { installLocation } = app.testEnvironment;
    await expect(installWizard.installLocationInput).toBeVisible();
    await installWizard.installLocationInput.fill(installLocation.path);
    await installWizard.clickNext();

    // Install stepper screens
    await expect(window.getByText('Migrate from Existing Installation')).toBeVisible();
    await installWizard.clickNext();

    await expect(window.getByText('Desktop App Settings')).toBeVisible();
    await installWizard.getButton('Install').click();

    const status = await serverStart.status.get();
    expect(['loading', 'setting up python']).toContain(status);

    // When the terminal is hidden and no error is shown, the install is successful
    await expect(serverStart.terminal).not.toBeVisible({ timeout: 5 * 60 * 1000 });
    await expect(serverStart.status.error).not.toBeVisible();
    await expect(serverStart.showTerminalButton).not.toBeVisible();

    await installedApp.waitUntilLoaded();
  });
});
