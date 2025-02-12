import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  /* Run local instance before starting the tests */
  globalSetup: './playwright.setup',
  // Per-test timeout - 60 sec
  timeout: 60_000,
  // Entire test suite timeout - 1 hour
  globalTimeout: 60 * 60 * 1000,
  // This is a desktop app; sharding is required to run tests in parallel.
  workers: 1,
  // GitHub reporter in CI, dot reporter for local development.
  reporter: process.env.CI ? 'github' : 'dot',
  // Capture trace, screenshots, and video on first retry in CI.
  retries: process.env.CI ? 1 : 0,
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
});
