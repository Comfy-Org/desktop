import { type Locator, expect, test } from '@playwright/test';
import { chromium } from '@playwright/test';

test('has title', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9000');

  expect(browser.isConnected()).toBeTruthy();
  expect(browser.contexts().length).toBeGreaterThan(0);

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
