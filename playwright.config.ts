import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  /* Run local instance before starting the tests */
  globalSetup: './playwright.setup',
  // Per-test timeout - 60 sec
  timeout: 60_000,
  // Entire test suite timeout - 1 hour
  globalTimeout: 60 * 60 * 1000,
  expect: {
    timeout: 10_000,
  },
  // This is a desktop app; sharding is required to run tests in parallel.
  workers: 1,
});
