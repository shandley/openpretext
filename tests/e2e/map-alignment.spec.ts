/**
 * E2E: the rendered contact map moves with the drag that pans it.
 *
 * The WebGL layer and the 2D overlays (tracks, labels, minimap) each convert
 * map coordinates to screen coordinates independently, and the camera's own
 * pan math is in overlay coordinates. They agreed only at camera.y == 0.5
 * until the vertex shaders were given the y flip that map space (genomic,
 * y-down) needs on the way to clip space (y-up). Dragging up then moved the
 * map down while the left-edge tracks moved up — Carlos reported it as the
 * left tracks not being anchored to the map.
 *
 * Dragging by N pixels must move the map by N pixels in the same direction.
 * That is both what a user checks and exactly what the overlay transform
 * predicts, so a map that satisfies it agrees with the tracks by construction.
 * The horizontal case is the control: x was never flipped, so it passes either
 * way and proves the measurement itself is sound.
 *
 * Uses demo data (synthetic map, 12 contigs) so no external file is required.
 */

import { test, expect } from '@playwright/test';

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(() => document.getElementById('btn-demo')?.click());
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('12 contigs');
}

/**
 * Locate the map's rendered edges on the WebGL canvas, in CSS pixels relative
 * to the canvas, by scanning inward for map content.
 *
 * A pixel counts as map content when it differs from the canvas clear colour.
 * Testing against the clear colour rather than a brightness threshold keeps
 * the semi-transparent contig grid lines — which are darker than the white
 * map interior but still nowhere near the background — on the map side of the
 * line, wherever they happen to land.
 *
 * Returns -1 for an edge that is off-screen.
 */
async function mapEdges(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const src = document.getElementById('map-canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const scaleY = src.clientHeight / src.height;
    const scaleX = src.clientWidth / src.width;
    const CLEAR = [32, 29, 26]; // gl.clearColor(0.125, 0.114, 0.102)

    const midX = Math.round(src.width / 2);
    const midY = Math.round(src.height / 2);
    const col = ctx.getImageData(midX, 0, 1, src.height).data;
    const row = ctx.getImageData(0, midY, src.width, 1).data;
    const lit = (d: Uint8ClampedArray, i: number) =>
      Math.abs(d[i] - CLEAR[0]) + Math.abs(d[i + 1] - CLEAR[1]) + Math.abs(d[i + 2] - CLEAR[2]) > 30;

    // Scan from each side for the first map pixel; -1 when the map covers the
    // whole span (edge off-screen) or nothing is drawn at all.
    let top = -1;
    for (let y = 0; y < src.height; y++) if (lit(col, y * 4)) { top = y; break; }
    let bottom = -1;
    for (let y = src.height - 1; y >= 0; y--) if (lit(col, y * 4)) { bottom = y; break; }
    let left = -1;
    for (let x = 0; x < src.width; x++) if (lit(row, x * 4)) { left = x; break; }
    let right = -1;
    for (let x = src.width - 1; x >= 0; x--) if (lit(row, x * 4)) { right = x; break; }

    const offScreen = (v: number, limit: number) => (v <= 0 || v >= limit - 1 ? -1 : v);
    return {
      top: offScreen(top, src.height) * scaleY,
      bottom: offScreen(bottom, src.height) * scaleY,
      left: offScreen(left, src.width) * scaleX,
      right: offScreen(right, src.width) * scaleX,
      height: src.clientHeight,
      width: src.clientWidth,
    };
  });
}

/** Drag on the map canvas to pan. */
async function drag(page: import('@playwright/test').Page, dx: number, dy: number) {
  const box = (await page.locator('#map-canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

/**
 * Read the map edges once the canvas has stopped changing.
 *
 * The render loop is dirty-gated on requestAnimationFrame, so a fixed wait
 * after a drag is a race: it held locally and failed under a loaded parallel
 * run. Polling until two consecutive reads agree ties the wait to the thing
 * being waited on.
 */
async function settledEdges(page: import('@playwright/test').Page) {
  let previous = await mapEdges(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const current = await mapEdges(page);
    if (
      current.top === previous.top && current.bottom === previous.bottom &&
      current.left === previous.left && current.right === previous.right
    ) {
      return current;
    }
    previous = current;
  }
  return previous;
}

const PAN = 150;
const TOLERANCE = 8; // px; covers rounding and the 1px edge-detection step

test.describe('Map / overlay alignment', () => {
  test('dragging up moves the map up by the same distance', async ({ page }) => {
    await loadDemo(page);

    // At zoom 1 the map exactly fills the canvas vertically, so no horizontal
    // edge is on screen to start with.
    const before = await settledEdges(page);
    expect(before.top, 'the map should fill the canvas vertically at reset').toBe(-1);
    expect(before.bottom).toBe(-1);

    await drag(page, 0, -PAN);

    // Dragging up pulls the map's bottom edge into view, PAN px above the
    // bottom of the canvas. Reading the y convention backwards pushes that
    // edge further off-screen and brings the TOP edge down into view instead.
    const after = await settledEdges(page);
    expect(after.top, 'the map top edge must stay off-screen when dragging up').toBe(-1);
    expect(after.bottom).toBeGreaterThan(0);
    expect(Math.abs(after.bottom - (after.height - PAN))).toBeLessThan(TOLERANCE);
  });

  test('dragging down moves the map down by the same distance', async ({ page }) => {
    await loadDemo(page);
    await drag(page, 0, PAN);

    const after = await settledEdges(page);
    expect(after.bottom, 'the map bottom edge must stay off-screen when dragging down').toBe(-1);
    expect(after.top).toBeGreaterThan(0);
    expect(Math.abs(after.top - PAN)).toBeLessThan(TOLERANCE);
  });

  test('dragging left moves the map left by the same distance (control)', async ({ page }) => {
    await loadDemo(page);

    // The map is letterboxed horizontally on a landscape window, so both
    // vertical edges are already visible.
    const before = await settledEdges(page);
    expect(before.left).toBeGreaterThan(0);
    expect(before.right).toBeGreaterThan(0);

    await drag(page, -PAN, 0);

    const after = await settledEdges(page);
    expect(Math.abs(after.left - (before.left - PAN))).toBeLessThan(TOLERANCE);
    expect(Math.abs(after.right - (before.right - PAN))).toBeLessThan(TOLERANCE);
  });
});
