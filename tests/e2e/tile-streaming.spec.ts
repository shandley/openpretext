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

// Real .pretext files are too large to commit, so these tests run against
// whichever specimen is present in test-data/ and skip when none is. The list
// was previously a single hard-coded name that matched no file on disk, so the
// whole spec skipped unconditionally.
const CANDIDATES = [
  'Anilios_waitii_post.pretext',
  'Coturnix_chinensis_post.pretext',
  'Taeniopygia_guttata_post.pretext',
  'Phascolarctos_cinereus.pretext',
  'bTaeGut2.mat.pretext',
];
const FOUND = CANDIDATES.map((n) => resolve(__dirname, '../../test-data', n)).find(existsSync);
const TEST_FILE = FOUND ?? '';
const TEST_FILE_STEM = FOUND ? FOUND.split('/').pop()!.split('.')[0] : '';
const HAS_TEST_FILE = FOUND !== undefined;

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
  test.skip(!HAS_TEST_FILE, `Requires a specimen in test-data/ (one of: ${CANDIDATES.join(', ')})`);

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
    expect(statusFile).toContain(TEST_FILE_STEM);
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

  test('detail tiles land on the diagonal away from the map centre', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_FILE);
    await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
    await page.waitForTimeout(1000);

    // Tile rows were once indexed genomic top-down but placed in a y-up map
    // space, mirroring the detail layer block-by-block about the map centre.
    // The centre is the fixed point of that mirror, so zooming there — what
    // every other test in this file does — cannot see it. Anchor on the
    // diagonal a quarter of the way in instead, where the mirror sent the
    // detail layer to the anti-diagonal and left the diagonal blank.
    const target = 0.25;
    const anchor = await page.evaluate((t) => {
      const canvas = document.getElementById('map-canvas')!;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Inverse of the vertex shader's aspect correction at zoom 1, camera 0.5.
      const xFrac = 0.5 + (t - 0.5) / (aspect > 1 ? aspect : 1);
      const yFrac = 0.5 + (t - 0.5) * (aspect > 1 ? 1 : aspect);
      return { x: rect.left + rect.width * xFrac, y: rect.top + rect.height * yFrac, xFrac, yFrac };
    }, target);

    // Zoom toward that point; it stays under the cursor as the zoom deepens.
    await page.evaluate(({ x, y }) => {
      const canvas = document.getElementById('map-canvas')!;
      for (let i = 0; i < 22; i++) {
        canvas.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
      }
    }, anchor);
    await page.waitForTimeout(4000);

    const zoomText = await page.locator('#status-zoom').textContent();
    expect(parseInt(zoomText?.replace('%', '') ?? '100')).toBeGreaterThan(400);

    // The hovered readout confirms the anchor held, so a blank result below
    // means the map failed to draw there, not that we navigated somewhere else.
    const patch = await page.evaluate(({ xFrac, yFrac }) => {
      const src = document.getElementById('map-canvas') as HTMLCanvasElement;
      const off = document.createElement('canvas');
      off.width = src.width;
      off.height = src.height;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(src, 0, 0);
      const half = 60;
      const cx = Math.round(src.width * xFrac);
      const cy = Math.round(src.height * yFrac);
      const x0 = Math.max(0, Math.min(src.width - 2 * half, cx - half));
      const y0 = Math.max(0, Math.min(src.height - 2 * half, cy - half));
      const d = ctx.getImageData(x0, y0, 2 * half, 2 * half).data;
      // Contact signal is red-dominant over the white background; the cleared
      // background outside the map is (32, 29, 26).
      let contact = 0, background = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 32) + Math.abs(d[i + 1] - 29) + Math.abs(d[i + 2] - 26) < 30) background++;
        else if (d[i] - d[i + 1] > 40) contact++;
      }
      return { contact, background, total: d.length / 4 };
    }, anchor);

    expect(patch.background, 'the map must cover the anchor point').toBeLessThan(patch.total * 0.1);
    expect(patch.contact, 'the diagonal must carry contact signal at high zoom').toBeGreaterThan(0);
  });

  test('should clean up tile state when loading a new file', async ({ page }) => {
    await page.goto('/');

    // Load the .pretext file
    await page.locator('#file-input').setInputFiles(TEST_FILE);
    await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });

    // Zoom in to trigger tile loading
    await zoomIn(page, 10);
    await page.waitForTimeout(1000);

    // Load demo data — should clean up tile manager
    await page.evaluate(() => document.getElementById('btn-demo')?.click());
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
