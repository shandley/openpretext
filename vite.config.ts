import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: process.env.CI ? '/openpretext/' : '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
