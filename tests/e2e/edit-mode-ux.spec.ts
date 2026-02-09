/**
 * E2E tests for edit-mode UX improvements:
 *   - Edit mode onboarding tooltip
 *   - Mode switching updates sidebar (draggable attribute)
 *   - Sidebar contig selection
 *   - Keyboard shortcuts in edit mode (Escape)
 *
 * Uses demo data (synthetic map with 12 contigs) so no external
 * file dependency is required.
 */

import { test, expect } from '@playwright/test';

/** Load synthetic demo data and wait for the app to be ready. */
async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-demo')?.click());
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

// ---------------------------------------------------------------------------
// 1. Edit mode onboarding tooltip
// ---------------------------------------------------------------------------

test.describe('Edit mode onboarding tooltip', () => {
  test('pressing E shows onboarding toast the first time', async ({ page }) => {
    await loadDemo(page);

    // Enter edit mode for the first time
    await enterEditMode(page);

    // The onboarding toast should appear with the expected message
    const toast = page.locator('.toast').filter({
      hasText: 'Edit mode: Click to select contigs, then drag to reorder. C=cut, F=flip, J=join',
    });
    await expect(toast).toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Mode switching updates sidebar
// ---------------------------------------------------------------------------

test.describe('Mode switching updates sidebar', () => {
  test('contig items get draggable attribute in edit mode and lose it in navigate mode', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);

    // In navigate mode, contig items should NOT have draggable attribute
    const contigItems = page.locator('#contig-list .contig-item');
    await expect(contigItems.first()).toBeVisible();

    const draggableBefore = await contigItems.first().getAttribute('draggable');
    expect(draggableBefore).toBeNull();

    // Enter edit mode -- sidebar should re-render with draggable
    await enterEditMode(page);
    await page.waitForTimeout(200);

    const contigItemsEdit = page.locator('#contig-list .contig-item');
    await expect(contigItemsEdit.first()).toBeVisible();
    const draggableAfter = await contigItemsEdit.first().getAttribute('draggable');
    expect(draggableAfter).toBe('true');

    // Switch back to navigate mode with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#status-mode')).toHaveText('Navigate');
    await page.waitForTimeout(200);

    const contigItemsNav = page.locator('#contig-list .contig-item');
    await expect(contigItemsNav.first()).toBeVisible();
    const draggableRestored = await contigItemsNav.first().getAttribute('draggable');
    expect(draggableRestored).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Sidebar contig selection
// ---------------------------------------------------------------------------

test.describe('Sidebar contig selection', () => {
  test('clicking a contig in the sidebar selects it with the selected class', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);
    await enterEditMode(page);

    const contigItems = page.locator('#contig-list .contig-item');
    await expect(contigItems.first()).toBeVisible();

    // Click the first contig item in the sidebar
    await contigItems.first().click();
    await page.waitForTimeout(200);

    // The clicked item should now have the 'selected' class
    const firstItem = page.locator('#contig-list .contig-item').first();
    await expect(firstItem).toHaveClass(/selected/);
  });
});

// ---------------------------------------------------------------------------
// 4. Keyboard shortcuts in edit mode
// ---------------------------------------------------------------------------

test.describe('Keyboard shortcuts in edit mode', () => {
  test('pressing Escape clears selection and returns to navigate mode', async ({ page }) => {
    await loadDemo(page);
    await openSidebar(page);
    await enterEditMode(page);

    // Select a contig by clicking in the sidebar
    const contigItems = page.locator('#contig-list .contig-item');
    await expect(contigItems.first()).toBeVisible();
    await contigItems.first().click();
    await page.waitForTimeout(200);

    // Verify the contig is selected
    await expect(page.locator('#contig-list .contig-item').first()).toHaveClass(/selected/);

    // Press Escape to clear selection and return to navigate mode
    await page.keyboard.press('Escape');
    await expect(page.locator('#status-mode')).toHaveText('Navigate');

    // Selection should be cleared -- no contig items with 'selected' class
    const selectedItems = page.locator('#contig-list .contig-item.selected');
    await expect(selectedItems).toHaveCount(0);
  });
});
