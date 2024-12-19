import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vite.main.config.ts',
  },
  {
    extends: './vite.preload.config.ts',
  },
]);
