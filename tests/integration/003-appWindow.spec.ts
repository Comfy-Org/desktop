import { expect } from '@playwright/test';

import { test } from './testExtensions';

test.describe('App Window', () => {
  test('App window has title', async ({ app }) => {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('ComfyUI');
  });

  test('App quits when window is closed', async ({ app }) => {
    const window = await app.firstWindow();

    await window.close();
    await app.app.waitForEvent('close');
  });

  test('beforeunload dialog should not block app quit with unsaved changes', async ({ installedApp }) => {
    await installedApp.waitUntilLoaded();

    // Create a workflow and add unsaved changes
    await installedApp.createBlankWorkflow();
    await installedApp.saveWorkflow();
    await installedApp.addFirstNodeResult();

    // Verify that closing with unsaved changes doesn't trigger beforeunload dialog
    // (https://github.com/Comfy-Org/desktop/issues/688)
    await installedApp.window.close({
      runBeforeUnload: true,
    });
    await installedApp.window.waitForEvent('close');
  });
});
