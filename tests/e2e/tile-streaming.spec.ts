/**
 * E2E test: tile streaming with a real .pretext file.
 *
 * Loads the app in a real browser, uploads bTaeGut2.mat.pretext,
 * verifies the overview renders, zooms in, waits for detail tiles
 * to load, and validates that zoomed-in rendering is visually
 * different from the overview (proving tiles actually rendered).
 */

import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_FILE = resolve(__dirname, '../../test-data/bTaeGut2.mat.pretext');
const HAS_TEST_FILE = existsSync(TEST_FILE);

/**
 * Helper: zoom into the map center by dispatching wheel events directly on
 * the canvas element. More reliable than page.mouse.wheel in headless mode.
 */
async function zoomIn(page: import('@playwright/test').Page, steps: number = 20) {
  await page.evaluate((n) => {
    const canvas = document.getElementById('map-canvas')!;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < n; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      }));
    }
  }, steps);
}

/**
 * Helper: sample a block of pixels from the center of the WebGL canvas.
 */
async function sampleCenterPixels(page: import('@playwright/test').Page, size = 4) {
  return page.evaluate((s) => {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    if (!gl) return null;
    const cx = Math.floor(gl.drawingBufferWidth / 2);
    const cy = Math.floor(gl.drawingBufferHeight / 2);
    const half = Math.floor(s / 2);
    const pixels = new Uint8Array(s * s * 4);
    gl.readPixels(cx - half, cy - half, s, s, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  }, size);
}

test.describe('Tile streaming with real .pretext file', () => {
  test.skip(!HAS_TEST_FILE, 'Requires test-data/bTaeGut2.mat.pretext (not committed to repo)');

  test('should load file, render overview, zoom in, and render detail tiles', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to initialize
    await expect(page.locator('#welcome')).toBeVisible();

    // Upload the .pretext file
    await page.locator('#file-input').setInputFiles(TEST_FILE);

    // Wait for the file to load
    await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#status-file')).not.toHaveText('No file loaded');

    // Verify status bar
    const statusFile = await page.locator('#status-file').textContent();
    expect(statusFile).toContain('bTaeGut2');
    const statusContigs = await page.locator('#status-contigs').textContent();
    expect(statusContigs).toMatch(/\d+ contigs/);

    // Wait for overview to render
    await page.waitForTimeout(500);

    // Screenshot and sample at overview zoom
    await page.locator('#map-canvas').screenshot({ path: 'test-results/overview.png' });
    const overviewSample = await sampleCenterPixels(page);
    expect(overviewSample).not.toBeNull();

    // Zoom into center
    await zoomIn(page, 25);

    // Wait for zoom + detail tile decode
    await page.waitForTimeout(2000);

    // Verify we actually zoomed in
    const zoomText = await page.locator('#status-zoom').textContent();
    const zoomPercent = parseInt(zoomText?.replace('%', '') ?? '100');
    expect(zoomPercent).toBeGreaterThan(150);

    // Screenshot and sample at high zoom
    await page.locator('#map-canvas').screenshot({ path: 'test-results/zoomed-detail.png' });
    const zoomedSample = await sampleCenterPixels(page);
    expect(zoomedSample).not.toBeNull();

    // Pixels should differ between overview and zoomed view
    const pixelsDiffer = overviewSample!.some((v, i) => v !== zoomedSample![i]);
    expect(pixelsDiffer).toBe(true);
  });

  test('should render non-black pixels at high zoom (tiles have data)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_FILE);
    await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });

    // Zoom in
    await zoomIn(page, 20);
    await page.waitForTimeout(2000);

    // Read pixel statistics
    const stats = await page.evaluate(() => {
      const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2');
      if (!gl) return null;

      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const size = 10;
      const sx = Math.floor(w / 2) - Math.floor(size / 2);
      const sy = Math.floor(h / 2) - Math.floor(size / 2);
      const pixels = new Uint8Array(size * size * 4);
      gl.readPixels(sx, sy, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let min = 255, max = 0, sum = 0;
      const numPixels = size * size;
      for (let i = 0; i < numPixels; i++) {
        const r = pixels[i * 4];
        if (r < min) min = r;
        if (r > max) max = r;
        sum += r;
      }

      return { min, max, mean: sum / numPixels, range: max - min, numPixels };
    });

    expect(stats).not.toBeNull();
    // The map center should have visible contact data (not all black)
    expect(stats!.max).toBeGreaterThan(0);
  });

  test('should clean up tile state when loading a new file', async ({ page }) => {
    await page.goto('/');

    // Load the .pretext file
    await page.locator('#file-input').setInputFiles(TEST_FILE);
    await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });

    // Zoom in to trigger tile loading
    await zoomIn(page, 10);
    await page.waitForTimeout(1000);

    // Load synthetic demo data via command palette — should clean up tile manager
    await page.keyboard.press('Meta+k');
    await page.locator('#command-input').fill('Load synthetic demo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Verify demo data loaded
    const statusFile = await page.locator('#status-file').textContent();
    expect(statusFile).toBe('Demo data');

    // App should not crash — GL context still valid
    const canvasOk = await page.evaluate(() => {
      const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
      return canvas.getContext('webgl2') !== null;
    });
    expect(canvasOk).toBe(true);
  });
});
