/**
 * E2E tests for the script console: the DSL reference (help), running commands,
 * and view navigation actually moving the camera (a regression guard for the
 * bug where zoom/goto were silent no-ops).
 *
 * Uses demo data (synthetic map, 12 contigs chr1..chr12) so no external file
 * is required.
 */

import { test, expect } from '@playwright/test';

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-demo')?.click());
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

async function openConsole(page: import('@playwright/test').Page) {
  const consoleEl = page.locator('#script-console');
  if (!(await consoleEl.evaluate((el) => el.classList.contains('visible')))) {
    await page.evaluate(() => document.getElementById('btn-console')?.click());
  }
  await expect(consoleEl).toHaveClass(/visible/);
}

async function runScript(page: import('@playwright/test').Page, text: string) {
  await page.locator('#script-input').fill(text);
  await page.evaluate(() => document.getElementById('btn-run-script')?.click());
}

test.describe('Script console', () => {
  test('Help shows the DSL command reference', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    await page.evaluate(() => document.getElementById('btn-help-script')?.click());

    const output = page.locator('#script-output');
    // Category headers and command syntax from the reference are rendered.
    await expect(output.locator('.script-help-cat').first()).toBeVisible();
    await expect(output).toContainText('Curation');
    await expect(output).toContainText('invert');
  });

  test('echo runs and reports success', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    await runScript(page, 'echo hello world');

    const output = page.locator('#script-output');
    await expect(output).toContainText('hello world');
    await expect(output).toContainText('1 succeeded, 0 failed');
  });

  test('zoom and zoom reset actually move the camera', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    const zoom = page.locator('#zoom-level');
    await expect(zoom).toHaveText('100%');

    await runScript(page, 'zoom #5');
    // The view should zoom well past 100% to frame a single contig.
    await expect
      .poll(async () => parseInt((await zoom.textContent())?.replace('%', '') ?? '0', 10))
      .toBeGreaterThan(200);

    await runScript(page, 'zoom reset');
    await expect(zoom).toHaveText('100%', { timeout: 5_000 });
  });

  test('a multi-op script reverts with a single undo', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');

    // Two cuts add two contigs (14 total).
    await runScript(page, 'cut #0 20\ncut #1 20');
    await expect(page.locator('#status-contigs')).toHaveText('14 contigs');

    // A single undo action reverts the whole script batch back to 12.
    await page.evaluate(() => document.getElementById('btn-undo')?.click());
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
  });

  test('Preview effects reports the result without keeping it', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');

    await page.locator('#script-input').fill('cut #0 20\ncut #1 20');
    await page.evaluate(() => document.getElementById('btn-preview-effects')?.click());

    const output = page.locator('#script-output');
    await expect(output).toContainText('ran and reverted');
    await expect(output).toContainText('12 → 14');
    // The assembly itself is untouched.
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
  });

  test('Preview validates without applying', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    await page.locator('#script-input').fill('invert chr1\ninvert nope');
    await page.evaluate(() => document.getElementById('btn-preview-script')?.click());

    const output = page.locator('#script-output');
    await expect(output).toContainText('nothing applied');
    await expect(output).toContainText('not found');
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
  });

  test('a failing assert halts the script before later commands run', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');

    // The assert fails, so the cut on the next line must not run.
    await runScript(page, 'assert contigs == 99\ncut #0 20');

    await expect(page.locator('#script-output')).toContainText('Assertion FAILED');
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
  });

  test('predicate selection selects matching contigs', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    // Demo contigs are all unscaffolded, so this selects all 12.
    await runScript(page, 'select where unscaffolded');
    await expect(page.locator('#script-output')).toContainText('Selected 12');
  });

  test('a malformed line reports a parse error', async ({ page }) => {
    await loadDemo(page);
    await openConsole(page);

    await runScript(page, 'boguscommand chr1');

    await expect(page.locator('#script-output')).toContainText('Parse error');
  });
});
