import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    minify: false,
    sourcemap: false,

    lib: {
      name: 'index',
      entry: 'src/index.ts',
      formats: ['iife'],
      fileName: 'index',
    },
    polyfillModulePreload: false,
  },
});
