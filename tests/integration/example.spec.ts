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

  const getStartedButton = page.getByText("Get Started")

  await expect(getStartedButton).toBeVisible();
  await expect(getStartedButton).toBeEnabled();

  await page.screenshot({ path: 'screenshot-load.png' });  

  await getStartedButton.click();

  await expect(page.getByText("Choose Installation Location")).toBeVisible();
  
  await page.screenshot({ path: 'screenshot-get-started.png' });

  const nextButton = page.getByText("Next")

  await expect(nextButton).toBeVisible();
  await expect(nextButton).toBeEnabled();

  await nextButton.click();

  await expect(page.getByText("Migrate from Existing Installation")).toBeVisible();

  await page.screenshot({ path: 'screenshot-migrate.png' });

  await nextButton.click();

  await expect(page.getByText("Desktop App Settings")).toBeVisible();

  const installButton = page.getByText("Install")

  await expect(installButton).toBeVisible();
  await expect(installButton).toBeEnabled();

  await installButton.click();

  
});
