import { expect } from '@playwright/test';

import { test } from './testApp';

test('App window has title', async ({ app }) => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle('ComfyUI');
});

test('App quits when window is closed', async ({ app }) => {
  const window = await app.firstWindow();

  await window.close();
  await app.app.waitForEvent('close');
});
