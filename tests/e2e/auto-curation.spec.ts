/**
 * E2E tests for automated curation features:
 *   - Auto cut command in palette
 *   - Auto sort command in palette
 *   - Undo-all commands in palette
 *   - Run auto cut on demo data
 *   - Run auto sort on demo data
 *
 * Uses demo data (synthetic map with 12 contigs) so no external
 * file dependency is required.
 */

import { test, expect } from '@playwright/test';

/** Load demo data and wait for the app to be ready. */
async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#btn-demo').click();
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

/** Open the command palette with Cmd+K. */
async function openCommandPalette(page: import('@playwright/test').Page) {
  await page.keyboard.press('Meta+k');
  await expect(page.locator('#command-palette')).toHaveClass(/visible/);
}

// ---------------------------------------------------------------------------
// 1. Auto cut command in palette
// ---------------------------------------------------------------------------

test.describe('Auto curation commands', () => {
  test('Auto cut command appears in command palette', async ({ page }) => {
    await loadDemo(page);
    await openCommandPalette(page);

    const input = page.locator('#command-input');
    await input.fill('Auto cut');

    const results = page.locator('#command-results .result-item');
    const texts = await results.allTextContents();
    const hasAutoCut = texts.some(t => t.toLowerCase().includes('auto cut'));
    expect(hasAutoCut).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. Auto sort command in palette
  // ---------------------------------------------------------------------------

  test('Auto sort command appears in command palette', async ({ page }) => {
    await loadDemo(page);
    await openCommandPalette(page);

    const input = page.locator('#command-input');
    await input.fill('Auto sort');

    const results = page.locator('#command-results .result-item');
    const texts = await results.allTextContents();
    const hasAutoSort = texts.some(t => t.toLowerCase().includes('auto sort'));
    expect(hasAutoSort).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. Undo-all commands in palette
  // ---------------------------------------------------------------------------

  test('Undo all commands appear in command palette', async ({ page }) => {
    await loadDemo(page);
    await openCommandPalette(page);

    const input = page.locator('#command-input');
    await input.fill('Undo all');

    const results = page.locator('#command-results .result-item');
    const texts = await results.allTextContents();
    const hasUndoCut = texts.some(t => t.toLowerCase().includes('undo all auto-cut'));
    const hasUndoSort = texts.some(t => t.toLowerCase().includes('undo all auto-sort'));
    expect(hasUndoCut).toBe(true);
    expect(hasUndoSort).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Run auto cut on demo data
  // ---------------------------------------------------------------------------

  test('Run auto cut on demo data via command palette', async ({ page }) => {
    await loadDemo(page);

    // Register dialog handler BEFORE triggering the command
    page.on('dialog', async dialog => {
      await dialog.accept('');  // Accept with empty = use defaults
    });

    await openCommandPalette(page);
    const input = page.locator('#command-input');
    await input.fill('Auto cut');
    await page.keyboard.press('Enter');

    // Wait for the toast notification
    const toast = page.locator('.toast');
    await expect(toast.first()).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 5. Run auto sort on demo data
  // ---------------------------------------------------------------------------

  test('Run auto sort on demo data via command palette', async ({ page }) => {
    await loadDemo(page);

    // Register dialog handler BEFORE triggering the command
    page.on('dialog', async dialog => {
      await dialog.accept('');  // Accept with empty = use defaults
    });

    await openCommandPalette(page);
    const input = page.locator('#command-input');
    await input.fill('Auto sort');
    await page.keyboard.press('Enter');

    // Wait for the toast notification
    const toast = page.locator('.toast');
    await expect(toast.first()).toBeVisible({ timeout: 10_000 });
  });
});
