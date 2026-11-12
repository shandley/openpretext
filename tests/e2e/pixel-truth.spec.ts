/**
 * Pixel truth: what the canvas shows, against what the file contains.
 *
 * Loads a synthetic .pretext whose every texel at every mip level is known
 * (tests/helpers/pretextWriter.ts), sets the camera exactly, reads pixels
 * back from the WebGL canvas, and compares each one with the value computed
 * here from first principles:
 *
 *   screen pixel -> display coordinate   (inverse of the vertex transform)
 *                -> file coordinate      (core/DisplayMapping, on app state)
 *                -> texel value          (the pattern the file was built from)
 *                -> colour               (the grayscale colour map)
 *
 * It does this at an overview-only zoom and at detail-tile zooms, before and
 * after curation edits. This is the invariant the app exists to keep: every
 * pixel on screen traces back to a real matrix value at that coordinate.
 */

import { test, expect, type Page } from '@playwright/test';
import { buildSyntheticPretext, patternTexel } from '../helpers/pretextWriter';
import { buildDisplayRuns, displayToFileCoord } from '../../src/core/DisplayMapping';
import { getColorMapData } from '../../src/renderer/ColorMaps';
import type { ContigInfo } from '../../src/core/State';

// 16 x 16 tiles of 256 texels: a 4096-texel map with levels 4096, 2048, 1024
// and 512 texels across. Contig widths are deliberately not tile multiples.
const MAP = 4096;
const CONTIG_WIDTHS = [700, 1000, 300, 900, 596, 600];
let fileBytes: Buffer;

test.beforeAll(() => {
  fileBytes = Buffer.from(buildSyntheticPretext({
    textureResLog2: 8,
    tilesLog2: 4,
    mipMapLevels: 4,
    contigs: CONTIG_WIDTHS.map((texels, i) => ({ name: `ctg${i + 1}`, texels })),
    texel: patternTexel,
  }));
});

interface Snapshot {
  width: number;
  height: number;
  camera: { x: number; y: number; zoom: number };
  contigs: ContigInfo[];
  order: number[];
  detailLevel: number;
  allVisibleLoaded: boolean;
  visibleCount: number;
  mapTextureSize: number;
  pixels: number[]; // r, g, b per requested point
}

/** Put the app into a state where a canvas pixel is a pure function of a texel. */
async function prepare(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { ctx, state } = (window as any).__openpretext;
    state.update({ gamma: 1, signalFloor: 0, signalCeil: 1, showGrid: false });
    ctx.currentColorMap = 'grayscale';
    ctx.renderer.setColorMap('grayscale');
    ctx.tracksVisible = false;
    ctx.renderDirty = true;
  });
  // Keep the pointer off the map so no hover highlight is drawn.
  await page.mouse.move(5, 5);
}

/** Resolve once the app has drawn `n` more frames (it draws inside requestAnimationFrame). */
async function framesDrawn(page: Page, n = 2): Promise<void> {
  await page.evaluate((count) => new Promise<void>((resolve) => {
    (window as any).__openpretext.ctx.renderDirty = true;
    let left = count;
    const tick = () => {
      (window as any).__openpretext.ctx.renderDirty = true;
      if (--left <= 0) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), n);
}

/**
 * Move the camera and wait until it is there and the view has been redrawn.
 * Waits on the app's own state and frames, not on the clock, so a loaded
 * machine makes the test slower instead of making it read a stale canvas.
 */
async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(([cx, cy, cz]) => {
    (window as any).__openpretext.ctx.camera.animateTo({ x: cx, y: cy, zoom: cz }, 1);
  }, [x, y, zoom]);
  await page.waitForFunction(([cx, cy, cz]) => {
    const c = (window as any).__openpretext.ctx.camera.getState();
    return Math.abs(c.x - cx) < 1e-9 && Math.abs(c.y - cy) < 1e-9 && Math.abs(c.zoom - cz) < 1e-9;
  }, [x, y, zoom], { timeout: 20_000 });
  await framesDrawn(page, 3);
}

/** Wait until every tile the view asked for is loaded, or the view wants none. */
async function waitForTiles(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tm = (window as any).__openpretext.ctx.tileManager;
    if (!tm) return true;
    const keys = tm.visibleKeys as Array<{ level: number; col: number; row: number }>;
    return keys.every((k) => tm.getTile(k)?.state === 'loaded');
  }, null, { timeout: 20_000 });
  // Frames after the last tile arrived, so it is on screen.
  await framesDrawn(page, 3);
}

async function snapshot(page: Page, points: Array<[number, number]>): Promise<Snapshot> {
  return page.evaluate((pts) => {
    const { ctx, state } = (window as any).__openpretext;
    const src = document.getElementById('map-canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = src.width;
    off.height = src.height;
    const c2d = off.getContext('2d')!;
    c2d.drawImage(src, 0, 0);
    const img = c2d.getImageData(0, 0, src.width, src.height).data;
    const pixels: number[] = [];
    for (const [px, py] of pts) {
      const i = (py * src.width + px) * 4;
      pixels.push(img[i], img[i + 1], img[i + 2]);
    }
    const s = state.get();
    const tm = ctx.tileManager;
    const keys = (tm?.visibleKeys ?? []) as Array<{ level: number; col: number; row: number }>;
    return {
      width: src.width,
      height: src.height,
      camera: ctx.camera.getState(),
      contigs: s.map.contigs,
      order: s.contigOrder,
      detailLevel: tm ? tm.currentLevel : -1,
      allVisibleLoaded: keys.every((k) => tm.getTile(k)?.state === 'loaded'),
      visibleCount: keys.length,
      mapTextureSize: ctx.renderer.mapTextureSize,
      pixels,
    };
  }, points);
}

/** Display coordinate (0-1) of a device pixel's centre: inverse of the vertex shader. */
function pixelToDisplay(px: number, py: number, s: Pick<Snapshot, 'width' | 'height' | 'camera'>): [number, number] {
  const clipX = ((px + 0.5) / s.width) * 2 - 1;
  const clipY = 1 - ((py + 0.5) / s.height) * 2;
  const aspect = s.width / s.height;
  let posX = clipX / 2;
  let posY = clipY / 2;
  if (aspect > 1) posX *= aspect; else posY /= aspect;
  return [posX / s.camera.zoom + s.camera.x, -posY / s.camera.zoom + s.camera.y];
}

/** The colour the grayscale map gives a stored byte, as the GPU samples it. */
const LUT = getColorMapData('grayscale');
function expectedGray(value: number): number {
  // texture(u_colorMap, vec2(t, 0.5)) with linear filtering over 256 texels.
  const pos = (value / 255) * 256 - 0.5;
  const i0 = Math.max(0, Math.min(255, Math.floor(pos)));
  const i1 = Math.max(0, Math.min(255, i0 + 1));
  const f = Math.max(0, Math.min(1, pos - i0));
  return LUT[i0 * 4] * (1 - f) + LUT[i1 * 4] * f;
}

interface Verdict { checked: number; wrong: string[] }

/**
 * Compare sampled pixels with the texel each must show.
 * @param levelSize texels across the whole map at the level expected on screen
 * @param parserLevel that level's index in the file (0 = finest)
 */
function verify(snap: Snapshot, points: Array<[number, number]>, levelSize: number, parserLevel: number): Verdict {
  const runs = buildDisplayRuns(snap.contigs, snap.order);
  const scale = levelSize / MAP;
  const wrong: string[] = [];
  let checked = 0;
  points.forEach(([px, py], i) => {
    const [dx, dy] = pixelToDisplay(px, py, snap);
    if (dx <= 0 || dx >= 1 || dy <= 0 || dy >= 1) return; // off the map
    const fx = displayToFileCoord(runs, dx * MAP) * scale;
    const fy = displayToFileCoord(runs, dy * MAP) * scale;
    // Skip pixels whose centre lies within a hair of a texel edge, where the
    // GPU's interpolation and this arithmetic may legitimately round apart.
    const edge = (v: number) => Math.min(v - Math.floor(v), Math.ceil(v) - v) < 0.06;
    if (edge(fx) || edge(fy)) return;
    const want = expectedGray(patternTexel(parserLevel, Math.floor(fx), Math.floor(fy)));
    const got = snap.pixels[i * 3];
    checked++;
    if (Math.abs(got - want) > 2 || snap.pixels[i * 3 + 1] !== got || snap.pixels[i * 3 + 2] !== got) {
      if (wrong.length < 8) {
        wrong.push(`pixel (${px},${py}) display (${dx.toFixed(4)},${dy.toFixed(4)}) texel (${Math.floor(fx)},${Math.floor(fy)}): got ${got}, want ${want.toFixed(1)}`);
      } else {
        wrong.push('');
      }
    }
  });
  return { checked, wrong };
}

/** A fixed pseudo-random set of device pixels over the canvas. */
function samplePoints(width: number, height: number, n: number): Array<[number, number]> {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  return Array.from({ length: n }, () => [Math.floor(rnd() * width), Math.floor(rnd() * height)] as [number, number]);
}

async function checkView(
  page: Page, label: string, cam: { x: number; y: number; zoom: number }, expectDetail: boolean,
): Promise<void> {
  await setCamera(page, cam.x, cam.y, cam.zoom);
  if (expectDetail) await waitForTiles(page);
  else await framesDrawn(page, 3);

  const size = await page.evaluate(() => {
    const c = document.getElementById('map-canvas') as HTMLCanvasElement;
    return [c.width, c.height];
  });
  const points = samplePoints(size[0], size[1], 4000);
  const snap = await snapshot(page, points);

  expect(snap.camera.zoom, `${label}: camera reached the requested zoom`).toBeCloseTo(cam.zoom, 6);
  // The whole-map texture is the 2048-texel level (the default overview).
  expect(snap.mapTextureSize, `${label}: overview level`).toBe(2048);

  let verdict: Verdict;
  if (expectDetail) {
    expect(snap.visibleCount, `${label}: the view asks for detail tiles`).toBeGreaterThan(0);
    expect(snap.allVisibleLoaded, `${label}: every requested tile loaded`).toBe(true);
    expect(snap.detailLevel, `${label}: tiles are the finest level`).toBe(3);
    verdict = verify(snap, points, 4096, 0);
  } else {
    verdict = verify(snap, points, 2048, 1);
  }

  expect(verdict.checked, `${label}: enough pixels were checkable`).toBeGreaterThan(1500);
  expect(
    verdict.wrong.filter(Boolean),
    `${label}: ${verdict.wrong.length} of ${verdict.checked} pixels show the wrong texel`,
  ).toEqual([]);
}

// Zoom thresholds depend on the canvas size, so pin the viewport. The canvas
// is about 650 device pixels on its shorter side: the 2048-texel overview is
// magnified (one texel per pixel or more) above zoom ~3.2, and the finest
// level (4096) is called for above zoom ~6.3.
test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const OVERVIEW_VIEWS = [
  { x: 0.5, y: 0.5, zoom: 4.0 },
  { x: 0.21, y: 0.33, zoom: 5.5 },
];
const DETAIL_VIEWS = [
  { x: 0.5, y: 0.5, zoom: 7.0 },
  { x: 0.31, y: 0.62, zoom: 9.3 },
  { x: 0.74, y: 0.18, zoom: 24.0 },
  { x: 0.05, y: 0.05, zoom: 16.0 },
];

async function checkAllViews(page: Page, stage: string): Promise<void> {
  for (const cam of OVERVIEW_VIEWS) {
    await checkView(page, `${stage}, overview at ${cam.zoom}x`, cam, false);
  }
  for (const cam of DETAIL_VIEWS) {
    await checkView(page, `${stage}, detail at ${cam.zoom}x`, cam, true);
  }
}

test('every canvas pixel shows the file texel at its coordinate, before and after curation', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('#file-input').setInputFiles({
    name: 'synthetic.pretext', mimeType: 'application/octet-stream', buffer: fileBytes,
  });
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-contigs')).toHaveText('6 contigs');
  await page.waitForTimeout(1500);
  await prepare(page);

  await checkAllViews(page, 'as loaded');

  // Move, invert, cut an inverted contig, and join two contigs that are not
  // neighbours in the file: the cases that used to draw the wrong data.
  const order = await page.evaluate(() => {
    const { CurationEngine, state } = (window as any).__openpretext;
    CurationEngine.move(0, 3);   // ctg2 ctg3 ctg4 ctg1 ctg5 ctg6
    CurationEngine.invert(1);    // ctg3 reversed
    CurationEngine.invert(0);    // ctg2 reversed
    CurationEngine.cut(0, 137);  // cut the reversed ctg2
    CurationEngine.move(5, 1);   // bring ctg5 between the two halves
    CurationEngine.join(1);      // join ctg5 with the right half of ctg2
    const s = state.get();
    return s.contigOrder.map((id: number) => s.map.contigs[id].name);
  });
  expect(order).toEqual(['ctg2_R', 'ctg5+ctg2_L', 'ctg3', 'ctg4', 'ctg1', 'ctg6']);
  // Let the post-edit flash highlight expire before reading pixels.
  await page.waitForTimeout(1200);
  await prepare(page);

  await checkAllViews(page, 'after curation');

  // Edit while zoomed in, without moving the camera afterwards. The view now
  // shows a different part of the file; its tiles must be fetched and drawn.
  const zoomed = { x: 0.08, y: 0.08, zoom: 12.0 };
  await setCamera(page, zoomed.x, zoomed.y, zoomed.zoom);
  await waitForTiles(page);
  await page.evaluate(() => {
    const { CurationEngine } = (window as any).__openpretext;
    CurationEngine.move(5, 0); // ctg6 comes to the top-left corner, in view
    CurationEngine.invert(0);
  });
  await page.waitForTimeout(1200);
  await prepare(page);
  await waitForTiles(page);
  {
    const size = await page.evaluate(() => {
      const c = document.getElementById('map-canvas') as HTMLCanvasElement;
      return [c.width, c.height];
    });
    const points = samplePoints(size[0], size[1], 4000);
    const snap = await snapshot(page, points);
    expect(snap.camera.zoom).toBeCloseTo(zoomed.zoom, 6);
    expect(snap.contigs[snap.order[0]].name).toBe('ctg6');
    expect(snap.allVisibleLoaded, 'tiles for the edited view loaded without a camera move').toBe(true);
    expect(snap.detailLevel).toBe(3);
    const verdict = verify(snap, points, 4096, 0);
    expect(verdict.checked).toBeGreaterThan(1000);
    expect(verdict.wrong.filter(Boolean), `edit while zoomed: ${verdict.wrong.length} of ${verdict.checked} wrong`).toEqual([]);
  }

  // Undo everything: the display must return to the file's own layout.
  await page.evaluate(() => {
    const { CurationEngine, state } = (window as any).__openpretext;
    while (state.get().undoStack.length > 0) CurationEngine.undo();
  });
  await page.waitForTimeout(1200);
  await prepare(page);
  await checkAllViews(page, 'after undo');

  expect(errors, 'no page or console errors').toEqual([]);
});
