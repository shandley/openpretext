/**
 * E2E test for session persistence of analysis results.
 *
 * Verifies that all analysis results (Insulation, P(s) decay,
 * Compartments, ICE, Directionality, Quality, Saddle) survive
 * a save/load round-trip via the session system.
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadDemo(page: Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-demo')?.click());
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

async function openSidebar(page: Page) {
  const sidebar = page.locator('#sidebar');
  if (!(await sidebar.evaluate((el) => el.classList.contains('visible')))) {
    await page.keyboard.press('i');
  }
  await expect(sidebar).toHaveClass(/visible/);
}

async function waitForAutoAnalysis(page: Page) {
  const trackList = page.locator('#track-config-list');
  await expect(trackList).toContainText('Insulation Score', { timeout: 15_000 });
  await expect(trackList).toContainText('TAD Boundaries');
  await expect(trackList).toContainText('A/B Compartments');
}

/** Click an analysis panel button reliably.
 *
 *  Two problems prevent a plain page.click():
 *  1. The button lives inside the overflow-y:auto sidebar and may be outside
 *     Playwright's visibility check even after scrolling.
 *  2. After one computation completes and shows its toast, the function
 *     may keep running (e.g. ICE re-runs compartments + P(s) after its toast),
 *     keeping `computing=true` and the button disabled. A subsequent click on a
 *     disabled <button> fires no event.
 *
 *  Fix: wait for !disabled in-page, then scroll+click via native browser API. */
async function nativeClick(page: Page, id: string) {
  await page.waitForFunction(
    (elId) => {
      const el = document.getElementById(elId) as HTMLButtonElement | null;
      return !!el && !el.disabled;
    },
    id,
    { timeout: 30_000 },
  );
  await page.evaluate((elId) => {
    const el = document.getElementById(elId) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', behavior: 'instant' });
    el?.click();
  }, id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Session persistence of analysis results', () => {
  test('all analysis results survive save/load round-trip', async ({ page }) => {
    test.setTimeout(150_000);

    // Phase A: Load demo and wait for auto-analysis
    await loadDemo(page);
    await openSidebar(page);
    await waitForAutoAnalysis(page);

    // Phase B: Run additional analyses

    // ICE normalization
    await nativeClick(page, 'btn-normalize-ice');
    await expect(
      page.locator('.toast').filter({ hasText: /ICE:/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#track-config-list')).toContainText('ICE Bias', {
      timeout: 5_000,
    });

    // Directionality
    await nativeClick(page, 'btn-compute-directionality');
    await expect(
      page.locator('.toast').filter({ hasText: /Directionality:/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#track-config-list')).toContainText(
      'Directionality Index',
    );

    // Library Quality
    await nativeClick(page, 'btn-compute-quality');
    await expect(
      page.locator('.toast').filter({ hasText: /Library:/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#track-config-list')).toContainText(
      'Per-Contig Cis Ratio',
    );

    // Saddle Plot (button appears after compartments computed)
    await nativeClick(page, 'btn-compute-saddle');
    await expect(
      page.locator('.toast').filter({ hasText: /Saddle:/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.saddle-container')).toContainText('Strength:');

    // Phase C: Verify pre-save state
    const analysisResults = page.locator('#analysis-results');
    await expect(analysisResults).toContainText('ICE Normalization');
    await expect(analysisResults).toContainText('P(s) exponent');
    await expect(analysisResults).toContainText('Cis contacts');

    const trackList = page.locator('#track-config-list');
    for (const name of [
      'Insulation Score',
      'TAD Boundaries',
      'A/B Compartments',
      'ICE Bias',
      'Directionality Index',
      'DI Boundaries',
      'Per-Contig Cis Ratio',
    ]) {
      await expect(trackList).toContainText(name);
    }

    // Phase D: Save session (intercept download). Save Session now lives in the
    // File ▾ toolbar popover, so open it first.
    await page.click('#btn-file-menu');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-save-session'),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Phase E: Reload and load demo again (session requires pretext data)
    await loadDemo(page);
    await openSidebar(page);
    await waitForAutoAnalysis(page);

    // Phase F: Load saved session
    await page.locator('#session-file-input').setInputFiles(downloadPath!);
    await expect(
      page.locator('.toast').filter({ hasText: /Session restored/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Phase G: Verify restored analysis tracks
    const restoredTrackList = page.locator('#track-config-list');
    for (const name of [
      'Insulation Score',
      'TAD Boundaries',
      'A/B Compartments',
      'ICE Bias',
      'Directionality Index',
      'DI Boundaries',
      'Per-Contig Cis Ratio',
    ]) {
      await expect(restoredTrackList).toContainText(name);
    }

    // Phase H: Verify restored analysis stats
    const restoredResults = page.locator('#analysis-results');
    await expect(restoredResults).toContainText('ICE Normalization');
    await expect(restoredResults).toContainText('P(s) exponent');
    await expect(restoredResults).toContainText('Cis contacts');
    await expect(restoredResults).toContainText('Contact density');
    await expect(page.locator('.saddle-container')).toContainText('Strength:');
  });
});
