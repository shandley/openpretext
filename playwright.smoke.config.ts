import { defineConfig } from '@playwright/test';

/**
 * Smoke test for the PRODUCTION BUILD.
 *
 * The main E2E suite (playwright.config.ts) runs against `vite dev`, so it never
 * exercises the minified, code-split, base-pathed artifact that actually ships.
 * This config serves the built `dist/` via `vite preview` at the real deploy
 * base (/openpretext/) and runs tests/smoke against it, catching base-path,
 * asset-resolution, worker-URL, and minification breakages before deploy.
 *
 * Requires a production-base build first (DEPLOY_BASE=/openpretext/ vite build,
 * or a CI build where CI=true). `npm run test:smoke` does both.
 */
export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    // Navigate with the explicit /openpretext/ path in the spec; keep the
    // origin here so a stray absolute goto('/…') is obviously wrong.
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // Preview the already-built dist at the deploy base. DEPLOY_BASE guarantees
    // the preview server mounts at /openpretext/ to match the baked asset paths,
    // independent of the CI env var.
    command: 'DEPLOY_BASE=/openpretext/ npx vite preview --port 4173 --strictPort',
    port: 4173,
    // Never reuse an existing server: a smoke test must serve the just-built
    // dist at the deploy base, not a stale preview left on the port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
        },
      },
    },
  ],
});
