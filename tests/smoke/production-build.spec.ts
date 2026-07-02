import { test, expect } from '@playwright/test';

/**
 * Production-build smoke tests. Run against `vite preview` of dist/ at the real
 * deploy base (see playwright.smoke.config.ts). These guard the class of
 * failures the dev-server E2E suite cannot see: wrong asset paths under the
 * base, missing code-split chunks, broken worker URLs, and minification bugs.
 */

const BASE = '/openpretext/';

test('built app boots under the deploy base with no asset or console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    // The browser probes /favicon.ico at the domain root by default; that 404
    // is cosmetic and unrelated to the build. Everything else must resolve.
    if (url.endsWith('/favicon.ico')) return;
    badResponses.push(`${res.status()} ${url}`);
  });
  page.on('requestfailed', (req) => {
    badResponses.push(`${req.failure()?.errorText ?? 'failed'} ${req.url()}`);
  });

  await page.goto(BASE);

  // App booted from the built bundle.
  await expect(page).toHaveTitle(/OpenPretext/);
  await expect(page.locator('#welcome')).toBeVisible();

  // The entry module resolved under the deploy base (the classic subpath break).
  const scriptSrcs = await page.$$eval('script[src]', (els) =>
    els.map((e) => (e as HTMLScriptElement).src),
  );
  expect(scriptSrcs.some((s) => s.includes(`${BASE}assets/`))).toBe(true);

  // Renderer prerequisite.
  const webgl2 = await page.evaluate(
    () => !!document.createElement('canvas').getContext('webgl2'),
  );
  expect(webgl2).toBe(true);

  expect(badResponses, 'no failed asset requests').toEqual([]);
  expect(consoleErrors, 'no console errors on load').toEqual([]);
});

test('built bundle renders the demo map', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#welcome')).toBeVisible();

  // Synthetic demo — no network or parse worker needed — exercises the renderer
  // and DOM wiring in the minified build.
  await page.evaluate(() => document.getElementById('btn-demo')?.click());

  await expect(page.locator('#status-contigs')).toHaveText('12 contigs', { timeout: 15_000 });
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#map-canvas')).toBeVisible();
});
