/**
 * E2E tests for contig cut and join curation operations.
 *
 * Uses demo data (synthetic map with 12 contigs) so no external
 * file dependency is required.
 */

import { test, expect } from '@playwright/test';

/** Load synthetic demo data and wait for the app to be ready. */
async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#btn-demo').click({ force: true });
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

/** Enter edit mode by pressing E. */
async function enterEditMode(page: import('@playwright/test').Page) {
  await page.keyboard.press('e');
  await expect(page.locator('#status-mode')).toHaveText('Edit');
}

/** Read the current contig count from the status bar. */
async function getContigCount(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.locator('#status-contigs').textContent();
  const match = text?.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * Move the mouse to the center of the canvas (hovering over the diagonal),
 * which will reliably land on a contig in the demo map.
 */
async function hoverCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  // Move to center of the canvas — on the diagonal this hits a contig
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Small wait for hover tracking
  await page.waitForTimeout(100);
}

/**
 * Click on the canvas center to select the hovered contig.
 */
async function clickCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
}

test.describe('Curation: Cut and Join', () => {
  test('Cut: pressing C in edit mode while hovering splits a contig', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    const before = await getContigCount(page);
    expect(before).toBe(12);

    await page.keyboard.press('c');
    // Allow curation event to propagate and UI to refresh
    await page.waitForTimeout(200);

    const after = await getContigCount(page);
    expect(after).toBe(before + 1);
  });

  test('Cut: shows toast notification', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    await page.keyboard.press('c');

    // Toast should appear with "Cut:" text
    await expect(page.locator('.toast').filter({ hasText: 'Cut:' })).toBeVisible({ timeout: 3000 });
  });

  test('Cut: C key does nothing outside edit mode', async ({ page }) => {
    await loadDemo(page);
    // Stay in navigate mode
    await expect(page.locator('#status-mode')).toHaveText('Navigate');

    const before = await getContigCount(page);
    await hoverCanvasCenter(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(200);

    const after = await getContigCount(page);
    expect(after).toBe(before);
  });

  test('Join: pressing J with one selected contig joins with right neighbor', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);

    // Click to select a contig at center
    await clickCanvasCenter(page);

    const before = await getContigCount(page);
    expect(before).toBe(12);

    await page.keyboard.press('j');
    await page.waitForTimeout(200);

    const after = await getContigCount(page);
    expect(after).toBe(before - 1);
  });

  test('Join: shows toast notification', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await clickCanvasCenter(page);

    await page.keyboard.press('j');

    await expect(page.locator('.toast').filter({ hasText: 'Joined contigs' })).toBeVisible({ timeout: 3000 });
  });

  test('Cut then Undo restores original contig count', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    const before = await getContigCount(page);
    expect(before).toBe(12);

    await page.keyboard.press('c');
    await page.waitForTimeout(200);
    expect(await getContigCount(page)).toBe(before + 1);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    expect(await getContigCount(page)).toBe(before);
  });

  test('Join then Undo restores original contig count', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await clickCanvasCenter(page);

    const before = await getContigCount(page);
    expect(before).toBe(12);

    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    expect(await getContigCount(page)).toBe(before - 1);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    expect(await getContigCount(page)).toBe(before);
  });
});
