import { describe, it, expect } from 'vitest';
import { isFileOrder } from '../../src/core/DisplayMapping';
import type { ContigInfo } from '../../src/core/State';

function contig(pixelStart: number, pixelEnd: number, inverted = false): ContigInfo {
  return {
    name: `c${pixelStart}`, originalIndex: 0, length: (pixelEnd - pixelStart) * 1000,
    pixelStart, pixelEnd, inverted, scaffoldId: null,
  };
}

describe('isFileOrder', () => {
  const contigs = [contig(0, 10), contig(10, 30), contig(30, 40)];

  it('is true for the order a file loads in', () => {
    expect(isFileOrder(contigs, [0, 1, 2])).toBe(true);
  });

  it('is false after a move', () => {
    expect(isFileOrder(contigs, [1, 0, 2])).toBe(false);
    expect(isFileOrder(contigs, [0, 2, 1])).toBe(false);
  });

  it('is false when any contig with pixels is inverted', () => {
    const inv = [contig(0, 10), contig(10, 30, true), contig(30, 40)];
    expect(isFileOrder(inv, [0, 1, 2])).toBe(false);
  });

  it('stays true after a cut, which splits a span without moving pixels', () => {
    // contig 1 cut at offset 5 -> children 3 and 4 replace it in the order
    const cut = [...contigs, contig(10, 15), contig(15, 30)];
    expect(isFileOrder(cut, [0, 3, 4, 2])).toBe(true);
  });

  it('is false when the halves of a cut are swapped', () => {
    const cut = [...contigs, contig(10, 15), contig(15, 30)];
    expect(isFileOrder(cut, [0, 4, 3, 2])).toBe(false);
  });

  it('ignores zero-width contigs wherever they sit and however they are oriented', () => {
    const withEmpty = [...contigs, contig(40, 40), contig(7, 7, true)];
    expect(isFileOrder(withEmpty, [3, 0, 4, 1, 2])).toBe(true);
  });

  it('is false when a contig id has no record', () => {
    expect(isFileOrder(contigs, [0, 1, 7])).toBe(false);
  });

  it('is true for an empty order', () => {
    expect(isFileOrder(contigs, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

import {
  getPixelSegments, splitPixelSegments, flipPixelSegments, normalizePixelSegments,
  pixelFieldsFor, segmentsWidth, buildDisplayRuns, displayWidth, displayToFileCoord,
  displayToFileTexel, buildCellRemap,
} from '../../src/core/DisplayMapping';
import type { PixelSegment } from '../../src/core/State';

/** Expand a segment list into the file texels it shows, left to right. */
function expand(segments: PixelSegment[]): number[] {
  const out: number[] = [];
  for (const s of segments) {
    if (s.reversed) for (let t = s.end - 1; t >= s.start; t--) out.push(t);
    else for (let t = s.start; t < s.end; t++) out.push(t);
  }
  return out;
}

describe('pixel segments', () => {
  it('describes a plain contig as one slice in its own direction', () => {
    expect(getPixelSegments(contig(10, 30))).toEqual([{ start: 10, end: 30, reversed: false }]);
    expect(getPixelSegments(contig(10, 30, true))).toEqual([{ start: 10, end: 30, reversed: true }]);
    expect(getPixelSegments(contig(7, 7))).toEqual([]);
  });

  it('splits a forward slice at a display offset', () => {
    const [l, r] = splitPixelSegments([{ start: 10, end: 20, reversed: false }], 3);
    expect(expand(l)).toEqual([10, 11, 12]);
    expect(expand(r)).toEqual([13, 14, 15, 16, 17, 18, 19]);
  });

  it('splits a reversed slice so display-left takes the high end of the file span', () => {
    const [l, r] = splitPixelSegments([{ start: 10, end: 20, reversed: true }], 3);
    expect(l).toEqual([{ start: 17, end: 20, reversed: true }]);
    expect(r).toEqual([{ start: 10, end: 17, reversed: true }]);
    expect(expand(l)).toEqual([19, 18, 17]);
    expect(expand(r)).toEqual([16, 15, 14, 13, 12, 11, 10]);
  });

  it('splits a multi-slice list on and off a slice boundary', () => {
    const segs: PixelSegment[] = [
      { start: 0, end: 4, reversed: false },
      { start: 20, end: 24, reversed: true },
    ];
    const all = expand(segs);
    for (let off = 1; off < 8; off++) {
      const [l, r] = splitPixelSegments(segs, off);
      expect(expand(l)).toEqual(all.slice(0, off));
      expect(expand(r)).toEqual(all.slice(off));
    }
  });

  it('flips a list by reversing what it shows', () => {
    const segs: PixelSegment[] = [
      { start: 0, end: 4, reversed: false },
      { start: 20, end: 24, reversed: true },
    ];
    expect(expand(flipPixelSegments(segs))).toEqual(expand(segs).reverse());
    expect(flipPixelSegments(flipPixelSegments(segs))).toEqual(segs);
  });

  it('merges slices that continue one another, in either direction', () => {
    expect(normalizePixelSegments([
      { start: 0, end: 4, reversed: false }, { start: 4, end: 9, reversed: false },
    ])).toEqual([{ start: 0, end: 9, reversed: false }]);
    expect(normalizePixelSegments([
      { start: 4, end: 9, reversed: true }, { start: 0, end: 4, reversed: true },
    ])).toEqual([{ start: 0, end: 9, reversed: true }]);
  });

  it('does not merge slices that only touch in the wrong order or direction', () => {
    const fwdBackwards: PixelSegment[] = [
      { start: 4, end: 9, reversed: false }, { start: 0, end: 4, reversed: false },
    ];
    expect(normalizePixelSegments(fwdBackwards)).toEqual(fwdBackwards);
    const mixed: PixelSegment[] = [
      { start: 0, end: 4, reversed: false }, { start: 4, end: 9, reversed: true },
    ];
    expect(normalizePixelSegments(mixed)).toEqual(mixed);
  });

  it('stores one slice as a plain span and several as pixelSegments, keeping the width', () => {
    const one = pixelFieldsFor([{ start: 5, end: 9, reversed: true }], false);
    expect(one).toEqual({ pixelStart: 5, pixelEnd: 9, inverted: true, pixelSegments: undefined });

    const two: PixelSegment[] = [
      { start: 0, end: 4, reversed: false }, { start: 20, end: 26, reversed: false },
    ];
    const many = pixelFieldsFor(two, true);
    expect(many.pixelSegments).toEqual(two);
    expect(many.pixelEnd - many.pixelStart).toBe(segmentsWidth(two));
    expect(many.inverted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runs and coordinates
// ---------------------------------------------------------------------------

describe('display runs', () => {
  const contigs = [contig(0, 10), contig(10, 30), contig(30, 40)];

  it('is a single identity run for an unedited order', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    expect(runs).toEqual([{ displayStart: 0, length: 40, fileStart: 0, reversed: false }]);
    expect(displayWidth(runs)).toBe(40);
  });

  it('maps each display texel to the file texel shown after a move', () => {
    const runs = buildDisplayRuns(contigs, [1, 0, 2]);
    const shown = Array.from({ length: 40 }, (_, d) => displayToFileTexel(runs, d));
    const expected = [
      ...Array.from({ length: 20 }, (_, i) => 10 + i),
      ...Array.from({ length: 10 }, (_, i) => i),
      ...Array.from({ length: 10 }, (_, i) => 30 + i),
    ];
    expect(shown).toEqual(expected);
  });

  it('mirrors an inverted contig within its own span', () => {
    const inv = [contig(0, 10), contig(10, 30, true), contig(30, 40)];
    const runs = buildDisplayRuns(inv, [0, 1, 2]);
    expect(displayToFileTexel(runs, 9)).toBe(9);
    expect(displayToFileTexel(runs, 10)).toBe(29);
    expect(displayToFileTexel(runs, 29)).toBe(10);
    expect(displayToFileTexel(runs, 30)).toBe(30);
  });

  it('is continuous and linear inside a run and has slope -1 when reversed', () => {
    const inv = [contig(0, 10), contig(10, 30, true)];
    const runs = buildDisplayRuns(inv, [0, 1]);
    expect(displayToFileCoord(runs, 2.25)).toBeCloseTo(2.25, 12);
    expect(displayToFileCoord(runs, 10)).toBeCloseTo(30, 12);
    expect(displayToFileCoord(runs, 12.5)).toBeCloseTo(27.5, 12);
  });

  it('returns NaN / -1 outside the display', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    expect(displayToFileCoord(runs, -0.1)).toBeNaN();
    expect(displayToFileCoord(runs, 40)).toBeNaN();
    expect(displayToFileTexel(runs, 40)).toBe(-1);
  });

  it('throws on an order that names a missing contig', () => {
    expect(() => buildDisplayRuns(contigs, [0, 9])).toThrow(/does not exist/);
  });
});

describe('buildCellRemap', () => {
  const contigs = [contig(0, 16), contig(16, 48), contig(48, 64)];

  it('is exactly the identity for an unedited order at any size', () => {
    const runs = buildDisplayRuns(contigs, [0, 1, 2]);
    for (const size of [1, 4, 7, 16, 64]) {
      expect(Array.from(buildCellRemap(runs, 64, size))).toEqual(Array.from({ length: size }, (_, i) => i));
    }
  });

  it('is a permutation when contig edges fall on cell edges', () => {
    const runs = buildDisplayRuns(contigs, [2, 0, 1]);
    const remap = Array.from(buildCellRemap(runs, 64, 8));
    expect(remap).toEqual([6, 7, 0, 1, 2, 3, 4, 5]);
  });

  it('mirrors an inverted contig about its own centre', () => {
    const inv = [contig(0, 16), contig(16, 48, true), contig(48, 64)];
    const runs = buildDisplayRuns(inv, [0, 1, 2]);
    expect(Array.from(buildCellRemap(runs, 64, 8))).toEqual([0, 1, 5, 4, 3, 2, 6, 7]);
  });

  it('marks cells beyond the display as -1', () => {
    const runs = buildDisplayRuns(contigs, [0]); // only 16 of 64 texels displayed
    expect(Array.from(buildCellRemap(runs, 64, 8))).toEqual([0, 1, -1, -1, -1, -1, -1, -1]);
  });
});
