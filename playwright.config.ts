import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  /* Run local instance before starting the tests */
  globalSetup: require.resolve('./playwright.setup'),
});
