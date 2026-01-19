import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from 'tests/shared/utils';

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

    // Install stepper screens
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
    await expect(installedApp.templatesGrid).toBeVisible({ timeout: 30 * 1000 });

    const dbPath = path.join(testEnvironment.installLocation.path, 'user', 'comfyui.db');
    await expect.poll(async () => await pathExists(dbPath), { timeout: 30 * 1000 }).toBe(true);
    await expect
      .poll(
        async () => {
          try {
            const fileStat = await stat(dbPath);
            return fileStat.size;
          } catch {
            return 0;
          }
        },
        { timeout: 30 * 1000 }
      )
      .toBeGreaterThan(0);
    const appUrl = new URL(window.url());
    const response = await window.request.get(`${appUrl.origin}/object_info`);
    expect(response.ok()).toBe(true);
  });
});
