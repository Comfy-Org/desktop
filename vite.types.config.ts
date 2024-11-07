import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main_types.ts'),
      name: 'comfyui-electron-api',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});
