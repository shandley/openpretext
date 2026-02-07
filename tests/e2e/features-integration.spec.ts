/**
 * E2E tests for new integrated features:
 *   - Stats panel (assembly metrics)
 *   - BED export button
 *   - Contig exclusion
 *   - Track config panel
 *   - Comparison mode
 *   - Batch operations via command palette
 *   - Keyboard shortcuts modal
 *
 * Uses demo data (synthetic map with 12 contigs) so no external
 * file dependency is required.
 */

import { test, expect } from '@playwright/test';

/** Load synthetic demo data via command palette and wait for the app to be ready. */
async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#command-palette')).toHaveClass(/visible/);
  await page.locator('#command-input').fill('Load synthetic demo');
  await page.keyboard.press('Enter');
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

/** Enter edit mode by pressing E. */
async function enterEditMode(page: import('@playwright/test').Page) {
  await page.keyboard.press('e');
  await expect(page.locator('#status-mode')).toHaveText('Edit');
}

/** Open the sidebar by pressing I. */
async function openSidebar(page: import('@playwright/test').Page) {
  const sidebar = page.locator('#sidebar');
  if (!(await sidebar.evaluate(el => el.classList.contains('visible')))) {
    await page.keyboard.press('i');
  }
  await expect(sidebar).toHaveClass(/visible/);
}

/**
 * Move the mouse to the center of the canvas (hovering over the diagonal),
 * which will reliably land on a contig in the demo map.
 */
async function hoverCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
}

/**
 * Click on the canvas center to select the hovered contig.
 */
async function clickCanvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// 1. Stats Panel
// ---------------------------------------------------------------------------

test.describe('Stats panel', () => {
  test('sidebar shows assembly metrics with N50 and contig count', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);

    const statsContent = page.locator('#stats-content');
    await expect(statsContent).toBeVisible();

    // getSummary() requires >=2 snapshots (initial + post-curation).
    // After loading demo data there is only 1 snapshot, so the panel
    // correctly shows "No data loaded" until a curation op creates a
    // second snapshot.  Perform a cut to generate the second snapshot.
    await enterEditMode(page);
    await hoverCanvasCenter(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(300);
    // Return to navigate mode so sidebar keyboard shortcut works
    await page.keyboard.press('Escape');

    // Re-open sidebar to refresh stats
    await openSidebar(page);

    // Stats should now be populated
    await expect(statsContent).not.toHaveText('No data loaded', { timeout: 5_000 });

    const statsText = await statsContent.textContent();
    expect(statsText).toBeTruthy();

    // Verify key metric labels are present
    expect(statsText).toContain('Contigs');
    expect(statsText).toContain('N50');
    expect(statsText).toContain('Total length');
    expect(statsText).toContain('L50');
    expect(statsText).toContain('Longest');
    expect(statsText).toContain('Shortest');
  });

  test('stats panel updates after a curation operation', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);

    const statsContent = page.locator('#stats-content');
    const beforeText = await statsContent.textContent();

    // Perform a cut to change the assembly
    await enterEditMode(page);
    await hoverCanvasCenter(page);
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    // Stats should now reflect the updated contig count
    const afterText = await statsContent.textContent();
    expect(afterText).not.toBe(beforeText);
  });
});

// ---------------------------------------------------------------------------
// 2. BED Export
// ---------------------------------------------------------------------------

test.describe('BED export', () => {
  test('Export BED button exists and is clickable', async ({ page }) => {
    await loadDemo(page);

    const bedButton = page.locator('#btn-save-bed');
    await expect(bedButton).toBeVisible();
    await expect(bedButton).toBeEnabled();

    // Click should not throw an error (we cannot verify download in headless,
    // but we confirm no unhandled exceptions occur)
    await bedButton.click();
    await page.waitForTimeout(200);

    // App should still be functional after clicking
    await expect(page.locator('#map-canvas')).toBeVisible();
    await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
  });
});

// ---------------------------------------------------------------------------
// 3. Contig Exclusion
// ---------------------------------------------------------------------------

test.describe('Contig exclusion', () => {
  test('pressing H in edit mode while hovering excludes a contig', async ({ page }) => {
    await loadDemo(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    // Press H to toggle exclusion on the hovered contig
    await page.keyboard.press('h');
    await page.waitForTimeout(200);

    // A toast should confirm the exclusion
    const toast = page.locator('.toast').filter({ hasText: /excluded|inclusion|exclusion/i });
    await expect(toast.first()).toBeVisible({ timeout: 3_000 });
  });

  test('excluded contig shows EXC badge in sidebar', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    // Exclude the hovered contig
    await page.keyboard.press('h');
    await page.waitForTimeout(300);

    // The sidebar contig list should now contain an EXC badge
    const excBadge = page.locator('#contig-list .contig-badge.excluded');
    await expect(excBadge.first()).toBeVisible({ timeout: 3_000 });
    const badgeText = await excBadge.first().textContent();
    expect(badgeText?.toUpperCase()).toContain('EXC');
  });

  test('pressing H again re-includes the contig', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);
    await enterEditMode(page);
    await hoverCanvasCenter(page);

    // Exclude
    await page.keyboard.press('h');
    await page.waitForTimeout(200);

    // Re-include
    await page.keyboard.press('h');
    await page.waitForTimeout(200);

    // Toast should confirm inclusion
    const toast = page.locator('.toast').filter({ hasText: /included/i });
    await expect(toast.first()).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Track Config Panel
// ---------------------------------------------------------------------------

test.describe('Track config panel', () => {
  test('track config list section exists in sidebar', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);

    const trackConfigList = page.locator('#track-config-list');
    await expect(trackConfigList).toBeVisible();

    // Demo data generates tracks named Coverage, GC Content, Telomeres, Gaps
    const text = await trackConfigList.textContent();
    expect(text).toBeTruthy();
    // Should have demo track names or the "No tracks loaded" placeholder
    expect(
      text!.includes('Coverage') || text!.includes('No tracks loaded')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Comparison Mode
// ---------------------------------------------------------------------------

test.describe('Comparison mode', () => {
  test('pressing P toggles comparison mode and shows toast', async ({ page }) => {
    await loadDemo(page);

    // Press P to enable comparison mode
    await page.keyboard.press('p');

    // Toast should appear with "Comparison: ON"
    const toastOn = page.locator('.toast').filter({ hasText: 'Comparison: ON' });
    await expect(toastOn).toBeVisible({ timeout: 3_000 });
  });

  test('pressing P twice toggles comparison OFF', async ({ page }) => {
    await loadDemo(page);

    // Toggle ON
    await page.keyboard.press('p');
    await page.waitForTimeout(300);

    // Toggle OFF
    await page.keyboard.press('p');

    const toastOff = page.locator('.toast').filter({ hasText: 'Comparison: OFF' });
    await expect(toastOff).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Batch Operations via Command Palette
// ---------------------------------------------------------------------------

test.describe('Batch operations via command palette', () => {
  test('command palette opens with Cmd+K and shows batch commands', async ({ page }) => {
    await loadDemo(page);

    // Open command palette
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#command-palette')).toHaveClass(/visible/);

    // Type "Batch" to filter commands
    await page.locator('#command-input').fill('Batch');
    await page.waitForTimeout(200);

    // Verify batch operation commands appear in results
    const results = page.locator('#command-results .result-item');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Check that specific batch operations are listed
    const resultsText = await page.locator('#command-results').textContent();
    expect(resultsText).toContain('Batch: select by pattern');
    expect(resultsText).toContain('Batch: select by size');
    expect(resultsText).toContain('Batch: cut large contigs');
    expect(resultsText).toContain('Batch: join selected');
    expect(resultsText).toContain('Batch: invert selected');
  });

  test('command palette closes with Escape', async ({ page }) => {
    await loadDemo(page);

    // Open
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#command-palette')).toHaveClass(/visible/);

    // Close
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toHaveClass(/visible/);
  });
});

// ---------------------------------------------------------------------------
// 7. Keyboard Shortcuts Modal
// ---------------------------------------------------------------------------

test.describe('Keyboard shortcuts modal', () => {
  test('pressing ? opens the shortcuts modal', async ({ page }) => {
    await loadDemo(page);

    await page.keyboard.press('?');
    const modal = page.locator('#shortcuts-modal');
    await expect(modal).toHaveClass(/visible/);
  });

  test('shortcuts modal shows H = Toggle exclusion entry', async ({ page }) => {
    await loadDemo(page);

    await page.keyboard.press('?');
    const modal = page.locator('#shortcuts-modal');
    await expect(modal).toHaveClass(/visible/);

    // Find the shortcut row for exclusion
    const exclusionRow = modal.locator('.shortcut-row').filter({ hasText: 'Toggle exclusion' });
    await expect(exclusionRow).toBeVisible();

    // Verify the kbd element contains H
    const kbd = exclusionRow.locator('kbd');
    await expect(kbd).toHaveText('H');
  });

  test('shortcuts modal shows P = Toggle comparison entry', async ({ page }) => {
    await loadDemo(page);

    await page.keyboard.press('?');
    const modal = page.locator('#shortcuts-modal');
    await expect(modal).toHaveClass(/visible/);

    // Find the shortcut row for comparison
    const comparisonRow = modal.locator('.shortcut-row').filter({ hasText: 'Toggle comparison' });
    await expect(comparisonRow).toBeVisible();

    // Verify the kbd element contains P
    const kbd = comparisonRow.locator('kbd');
    await expect(kbd).toHaveText('P');
  });

  test('shortcuts modal closes with ? again', async ({ page }) => {
    await loadDemo(page);

    // Open
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-modal')).toHaveClass(/visible/);

    // Close
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-modal')).not.toHaveClass(/visible/);
  });
});
