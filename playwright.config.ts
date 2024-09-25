import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: /.*\/src\/__tests__\/playwright\.e2e\.test\.ts$/,
  snapshotDir: './src/__tests__/snapshots',
});
