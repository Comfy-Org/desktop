import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 5 * 60 * 1000,
  testMatch: 'src/__tests__/e2e/*.test.ts',
});
