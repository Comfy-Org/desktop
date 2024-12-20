import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vite.config.ts',
  },
  {
    extends: './vite.preload.config.ts',
  },
]);
