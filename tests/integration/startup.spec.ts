import { test, expect } from '@playwright/test';
import { chromium } from '@playwright/test';

test('has title', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9000');

  expect(browser.isConnected()).toBeTruthy();  
  expect(browser.contexts()).toBeGreaterThan(0);

  const context = browser.contexts()[0];  
  const pages = context.pages();

  expect(pages).toHaveLength(1);
  const page = pages[0];

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/ComfyUI/);

  const getStartedButton = page.getByText('Get Started');

  await expect(getStartedButton).toBeVisible();
  await expect(getStartedButton).toBeEnabled();

  await page.screenshot({ path: 'screenshot-load.png' });

  await getStartedButton.click();

  await expect(page.getByText('Choose Installation Location')).toBeVisible();

  await page.screenshot({ path: 'screenshot-get-started.png' });

  let nextButton = page.getByRole('button', { name: 'Next' });

  await expect(nextButton).toBeVisible();
  await expect(nextButton).toBeEnabled();

  await nextButton.click();

  await expect(page.getByText('Migrate from Existing Installation')).toBeVisible();

  await page.screenshot({ path: 'screenshot-migrate.png' });

  nextButton = page.getByRole('button', { name: 'Next' });

  await nextButton.click();

  await expect(page.getByText('Desktop App Settings')).toBeVisible();

  await page.screenshot({ path: 'screenshot-install.png' });
});
