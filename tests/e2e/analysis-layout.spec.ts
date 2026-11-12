/**
 * Analyses follow the curated layout.
 *
 * The overview matrix is stored in file order. After contigs are moved or
 * inverted, every analysis must read it in display order, and results
 * computed for the previous layout must be replaced. This checks the tracks
 * the app shows against the same analyses run here, in Node, on a matrix
 * reordered by core/DisplayMatrix.
 */

import { test, expect, type Page } from '@playwright/test';
import { buildSyntheticPretext, patternTexel } from '../helpers/pretextWriter';
import { buildDisplayMatrix } from '../../src/core/DisplayMatrix';
import { computeInsulation, insulationToTracks } from '../../src/analysis/InsulationScore';
import { computeCompartments, compartmentToTrack } from '../../src/analysis/CompartmentAnalysis';
import type { ContigInfo, MapData } from '../../src/core/State';

const WIDTHS = [200, 300, 124, 250, 150];
const FILE = Buffer.from(buildSyntheticPretext({
  textureResLog2: 8,
  tilesLog2: 2,
  mipMapLevels: 2,
  contigs: WIDTHS.map((texels, i) => ({ name: `a${i + 1}`, texels })),
  texel: patternTexel,
}));

interface Pulled {
  contactMap: number[];
  contigs: ContigInfo[];
  order: number[];
  textureSize: number;
  insulation: number[] | null;
  compartments: number[] | null;
}

async function pull(page: Page): Promise<Pulled> {
  return page.evaluate(() => {
    const { ctx, state } = (window as any).__openpretext;
    const s = state.get();
    const data = (name: string) => {
      const t = ctx.trackRenderer.getTrack(name);
      return t ? Array.from(t.data as Float32Array) : null;
    };
    return {
      contactMap: Array.from(s.map.contactMap as Float32Array),
      contigs: s.map.contigs,
      order: s.contigOrder,
      textureSize: s.map.textureSize,
      insulation: data('Insulation Score'),
      compartments: data('A/B Compartments'),
    };
  });
}

/** The tracks the app should be showing for this layout, computed independently. */
function expectedTracks(p: Pulled, order: number[]) {
  const contactMap = Float32Array.from(p.contactMap);
  const size = Math.round(Math.sqrt(contactMap.length));
  const map = { contigs: p.contigs, contactMap, textureSize: p.textureSize } as MapData;
  const matrix = buildDisplayMatrix(map, order)!;

  let acc = 0;
  const ranges = order.map((id, i) => {
    const c = p.contigs[id];
    const start = Math.round((acc / p.textureSize) * size);
    acc += c.pixelEnd - c.pixelStart;
    return { start, end: Math.round((acc / p.textureSize) * size), orderIndex: i };
  });

  const insulation = insulationToTracks(
    computeInsulation(matrix, size, { windowSize: 10 }, ranges), size, p.textureSize,
  ).insulationTrack.data;
  const compartments = compartmentToTrack(computeCompartments(matrix, size), size, p.textureSize).data;
  return { insulation: Array.from(insulation), compartments: Array.from(compartments) };
}

function maxDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!(d <= m)) m = Number.isNaN(d) ? (Number.isNaN(a[i]) && Number.isNaN(b[i]) ? m : Infinity) : d;
  }
  return m;
}

async function waitForRecompute(page: Page): Promise<void> {
  // The recompute is debounced by a second, then runs in a worker.
  await page.waitForTimeout(1300);
  await page.waitForFunction(() => {
    const el = document.getElementById('analysis-recomputing');
    return !el || el.style.display === 'none' || el.style.display === '';
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(200);
}

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

test('insulation and compartment tracks are those of the curated layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('#file-input').setInputFiles({
    name: 'layout.pretext', mimeType: 'application/octet-stream', buffer: FILE,
  });
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-contigs')).toHaveText('5 contigs');
  await expect.poll(async () => (await pull(page)).compartments !== null, { timeout: 20_000 }).toBe(true);
  await waitForRecompute(page);

  // As loaded: display order is file order.
  const loaded = await pull(page);
  const want0 = expectedTracks(loaded, loaded.order);
  expect(maxDiff(loaded.insulation!, want0.insulation)).toBeLessThan(1e-5);
  expect(maxDiff(loaded.compartments!, want0.compartments)).toBeLessThan(1e-5);

  // Rearrange. Count toasts raised by the recompute that follows.
  await page.evaluate(() => {
    const { CurationEngine } = (window as any).__openpretext;
    (window as any).__toasts = 0;
    new MutationObserver((muts) => {
      for (const m of muts) (window as any).__toasts += m.addedNodes.length;
    }).observe(document.getElementById('toast-container')!, { childList: true });
    CurationEngine.move(3, 0);
    CurationEngine.invert(2);
    CurationEngine.move(4, 1);
  });
  await waitForRecompute(page);

  const edited = await pull(page);
  expect(edited.order).not.toEqual(loaded.order);
  expect(edited.contactMap, 'the stored matrix stays in file order').toEqual(loaded.contactMap);

  const want = expectedTracks(edited, edited.order);
  // The test only means something if the layouts give different answers.
  expect(maxDiff(want.insulation, want0.insulation)).toBeGreaterThan(0.01);
  expect(maxDiff(want.compartments, want0.compartments)).toBeGreaterThan(0.01);

  expect(maxDiff(edited.insulation!, want.insulation), 'insulation follows the layout').toBeLessThan(1e-5);
  expect(maxDiff(edited.compartments!, want.compartments), 'compartments follow the layout').toBeLessThan(1e-5);

  // Recomputing after an edit is not announced analysis by analysis.
  expect(await page.evaluate(() => (window as any).__toasts)).toBe(0);

  // Undo all three: back to the loaded layout and its tracks.
  await page.evaluate(() => {
    const { CurationEngine } = (window as any).__openpretext;
    CurationEngine.undo(); CurationEngine.undo(); CurationEngine.undo();
  });
  await waitForRecompute(page);
  const undone = await pull(page);
  expect(undone.order).toEqual(loaded.order);
  expect(maxDiff(undone.insulation!, want0.insulation)).toBeLessThan(1e-5);
  expect(maxDiff(undone.compartments!, want0.compartments)).toBeLessThan(1e-5);

  expect(errors).toEqual([]);
});
