import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: './src/__tests__/e2e/**/*.test.ts',
  snapshotDir: 'src/__tests__/e2e/snapshots',
});
