import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { cwd, env } from 'node:process';
import type { DesktopTestOptions } from 'tests/integration/testExtensions';

const envOverrides = path.resolve(cwd(), '.env.test');
dotenv.config({ path: envOverrides });

export default defineConfig<DesktopTestOptions>({
  testDir: './tests/integration',
  // Backs up app data - in case this was run on a non-ephemeral machine.
  globalSetup: './playwright.setup',
  // Entire test suite timeout - 1 hour
  globalTimeout: 60 * 60 * 1000,
  // Per-test timeout - 60 sec
  timeout: 60_000,
  // This is a desktop app; sharding is required to run tests in parallel.
  workers: 1,
  // GitHub reporter in CI, dot reporter for local development.
  reporter: env.CI ? 'github' : 'dot',
  // Test times are already recorded. This feature does not allow exceptions.
  reportSlowTests: null,
  // Capture trace, screenshots, and video on first retry in CI.
  retries: env.CI ? 1 : 0,
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      // All tests that should start from an uninstalled state
      name: 'install',
      testMatch: ['install/**/*.spec.ts', 'shared/**/*.spec.ts'],
      use: { disposeTestEnvironment: true },
    },
    {
      // Setup project: this installs the app with default settings, providing a common base state for post-install tests
      name: 'post-install-setup',
      testMatch: ['post-install.setup.ts'],
      dependencies: ['install'],
    },
    {
      // Tests that run after the post-install setup
      name: 'post-install',
      testMatch: ['post-install/**/*.spec.ts', 'shared/**/*.spec.ts'],
      dependencies: ['post-install-setup'],
    },
  ],
});
