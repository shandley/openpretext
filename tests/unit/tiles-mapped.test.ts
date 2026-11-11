import { describe, it, expect } from 'vitest';
import {
  selectDetailLevel, fileTilesForDisplayInterval, getVisibleTileKeysMapped, getVisibleTileKeys,
} from '../../src/renderer/TileManager';
import { buildDisplayRuns, displayToFileTexel } from '../../src/core/DisplayMapping';
import type { ContigInfo } from '../../src/core/State';

function contig(pixelStart: number, pixelEnd: number, inverted = false): ContigInfo {
  return {
    name: `c${pixelStart}`, originalIndex: 0, length: (pixelEnd - pixelStart) * 1000,
    pixelStart, pixelEnd, inverted, scaffoldId: null,
  };
}

describe('selectDetailLevel', () => {
  // A map whose coarsest level is 1024 texels across, 6 stored levels.
  it('picks the finest level whose texels are at least one screen pixel', () => {
    expect(selectDetailLevel(1, 1024, 1024, 6)).toBe(0);    // 1 px per texel
    expect(selectDetailLevel(1.99, 1024, 1024, 6)).toBe(0); // level 1 would be 0.995 px
    expect(selectDetailLevel(2, 1024, 1024, 6)).toBe(1);
    expect(selectDetailLevel(4, 1024, 1024, 6)).toBe(2);
    expect(selectDetailLevel(7.9, 1024, 1024, 6)).toBe(2);
    expect(selectDetailLevel(8, 1024, 1024, 6)).toBe(3);
  });

  it('accounts for the canvas size, so a HiDPI canvas steps up sooner', () => {
    expect(selectDetailLevel(1, 2048, 1024, 6)).toBe(1);
    expect(selectDetailLevel(1, 830, 1024, 6)).toBe(0);
    expect(selectDetailLevel(2.4, 830, 1024, 6)).toBe(0);
    expect(selectDetailLevel(2.5, 830, 1024, 6)).toBe(1);
  });

  it('never picks a level whose texels are smaller than a pixel', () => {
    for (const zoom of [0.3, 1, 1.5, 2.83, 3, 5.5, 17, 64, 200]) {
      for (const px of [600, 830, 1650, 2160]) {
        const level = selectDetailLevel(zoom, px, 1024, 6);
        const texelPx = (zoom * px) / (1024 * 2 ** level);
        if (level > 0) expect(texelPx).toBeGreaterThanOrEqual(1);
        if (level < 5) expect(texelPx).toBeLessThan(2);
      }
    }
  });

  it('clamps to the stored levels', () => {
    expect(selectDetailLevel(0.1, 1024, 1024, 6)).toBe(0);
    expect(selectDetailLevel(1000, 1024, 1024, 6)).toBe(5);
    expect(selectDetailLevel(4, 1024, 1024, 0)).toBe(0);
  });
});

describe('fileTilesForDisplayInterval', () => {
  // 64 texels, 8 tiles of 8 texels.
  const contigs = [contig(0, 16), contig(16, 48), contig(48, 64)];

  it('is the plain tile range for an unedited order', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    expect(fileTilesForDisplayInterval(runs, 10, 30, 64, 8).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(fileTilesForDisplayInterval(runs, 0, 64, 64, 8).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fileTilesForDisplayInterval(runs, 8, 16, 64, 8)).toEqual([1]);
  });

  it('follows a moved contig to where it sits in the file', () => {
    // Display: c48 (file 48-64), c0 (file 0-16), c16 (file 16-48)
    const runs = buildDisplayRuns(contigs, [2, 0, 1]);
    // Display 0-16 shows file 48-64 -> tiles 6, 7.
    expect(fileTilesForDisplayInterval(runs, 0, 16, 64, 8).sort((a, b) => a - b)).toEqual([6, 7]);
    // Display 12-20 straddles the seam: file 60-64 and 0-4 -> tiles 7 and 0.
    expect(fileTilesForDisplayInterval(runs, 12, 20, 64, 8).sort((a, b) => a - b)).toEqual([0, 7]);
  });

  it('follows an inverted contig', () => {
    const inv = [contig(0, 16), contig(16, 48, true), contig(48, 64)];
    const runs = buildDisplayRuns(inv, [0, 1, 2]);
    // Display 16-24 shows file 47..40 -> tile 5.
    expect(fileTilesForDisplayInterval(runs, 16, 24, 64, 8)).toEqual([5]);
    // Display 40-48 shows file 23..16 -> tile 2.
    expect(fileTilesForDisplayInterval(runs, 40, 48, 64, 8)).toEqual([2]);
  });

  it('covers exactly the tiles holding the texels on display, for random layouts', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let trial = 0; trial < 200; trial++) {
      const cuts = [0, 5 + Math.floor(rnd() * 15), 25 + Math.floor(rnd() * 15), 45 + Math.floor(rnd() * 15), 64];
      const cs = [0, 1, 2, 3].map((i) => contig(cuts[i], cuts[i + 1], rnd() < 0.5));
      const order = [0, 1, 2, 3].sort(() => rnd() - 0.5);
      const runs = buildDisplayRuns(cs, order);
      const lo = Math.floor(rnd() * 50);
      const hi = lo + 1 + Math.floor(rnd() * (64 - lo - 1));
      const expected = new Set<number>();
      for (let d = lo; d < hi; d++) expected.add(Math.floor(displayToFileTexel(runs, d) / 8));
      const got = fileTilesForDisplayInterval(runs, lo, hi, 64, 8);
      expect(new Set(got), `trial ${trial}`).toEqual(expected);
      expect(got.length).toBe(expected.size); // no duplicates
    }
  });

  it('lists the tile under the centre of the interval first', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    expect(fileTilesForDisplayInterval(runs, 0, 64, 64, 8)[0]).toBeGreaterThanOrEqual(3);
    expect(fileTilesForDisplayInterval(runs, 0, 64, 64, 8)[0]).toBeLessThanOrEqual(4);
  });
});

describe('getVisibleTileKeysMapped', () => {
  const contigs = [contig(0, 16), contig(16, 48), contig(48, 64)];
  const cam = { x: 0.25, y: 0.5, zoom: 4 };

  it('asks for the same tiles as the unmapped version when nothing has moved', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    const mapped = getVisibleTileKeysMapped(runs, cam, 800, 800, 64, 8, 2);
    const plain = getVisibleTileKeys(cam, 800, 800, 8, 5).map((k) => ({ ...k, level: 2 }));
    const str = (ks: Array<{ col: number; row: number }>) => ks.map((k) => `${k.col},${k.row}`).sort();
    // The unmapped version also includes a tile the view only touches at its
    // edge; every tile it needs for real pixels must be requested.
    for (const k of str(mapped)) expect(str(plain)).toContain(k);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((k) => k.level === 2)).toBe(true);
  });

  it('asks for the product of the file columns and rows on display', () => {
    const runs = buildDisplayRuns(contigs, [2, 0, 1]);
    // x: display 8-24 -> file 56-64 and 0-8 -> cols 7, 0.
    // y: display 24-40 -> file 8-16 and 16-24 -> rows 1, 2.
    const keys = getVisibleTileKeysMapped(runs, { x: 0.25, y: 0.5, zoom: 4 }, 800, 800, 64, 8, 3);
    const got = keys.map((k) => `${k.col},${k.row}`).sort();
    expect(got).toEqual(['0,1', '0,2', '7,1', '7,2']);
  });

  it('returns nothing when the view is off the map', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    expect(getVisibleTileKeysMapped(runs, { x: 5, y: 5, zoom: 4 }, 800, 800, 64, 8, 2)).toEqual([]);
  });
});
