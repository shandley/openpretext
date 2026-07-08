/**
 * E2E test for the Script Console macro recorder.
 *
 * Records a manual cut (driven through the real edit-mode keyboard flow, NOT
 * the DSL — recording must capture hands-on curation) and asserts the recorder
 * writes a `cut` line into #script-input, both live while recording and after
 * recording stops.
 */

import { test, expect } from '@playwright/test';

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-demo')?.click());
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

async function hoverCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
}

async function clickCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
}

test.describe('Macro recorder', () => {
  test('records a manual cut into the script input', async ({ page }) => {
    await loadDemo(page);

    // Open the console, then start recording.
    await page.evaluate(() => document.getElementById('btn-console')?.click());
    await expect(page.locator('#script-console')).toHaveClass(/visible/);
    await page.locator('#btn-record-macro').click();
    await expect(page.locator('#btn-record-macro')).toHaveClass(/recording/);

    // Move focus off the console textarea so keyboard shortcuts reach the app,
    // then perform a manual cut via edit mode (press E, hover center, press C).
    await clickCanvasCenter(page);
    await page.keyboard.press('e');
    await expect(page.locator('#status-mode')).toHaveText('Edit');
    await hoverCanvasCenter(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    // The recorder should have written the cut into the input live.
    await expect(page.locator('#script-input')).toHaveValue(/cut/i);

    // Stop recording; the finalized script still contains the cut line.
    await page.locator('#btn-record-macro').click();
    await expect(page.locator('#btn-record-macro')).not.toHaveClass(/recording/);
    await expect(page.locator('#script-input')).toHaveValue(/cut/i);
  });
});
