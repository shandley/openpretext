import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Deploy base path. GitHub Pages serves the project site under /openpretext/.
  // DEPLOY_BASE lets the production smoke test build + preview at the real base
  // regardless of the CI env var; falls back to the CI-detection default.
  base: process.env.DEPLOY_BASE || (process.env.CI ? '/openpretext/' : '/'),
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
    // Disable prod sourcemaps: they added a ~1.5 MB artifact and exposed source.
    sourcemap: false,
  },
});
