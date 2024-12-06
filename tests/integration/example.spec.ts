import { test, expect } from '@playwright/test';
import { chromium } from '@playwright/test';

test('has title', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9000');

  console.log(browser.isConnected() && 'Connected to Chrome.');
  console.log(`Contexts in CDP session: ${browser.contexts().length}.`);

  const context = browser.contexts()[0];
  const pages = context.pages();

  console.log(`Pages in context: ${pages.length}.`);
  const page = pages[0];

  console.info(await page.title());

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/ComfyUI/);

  await page.screenshot({ path: 'screenshot-load.png' });

  const getStartedButton = await page.$("button[data-testid='get-started-button']");
  
  expect(getStartedButton).toBeDefined();

  getStartedButton?.click();


  await page.screenshot({ path: 'screenshot-get-started.png' });
});
