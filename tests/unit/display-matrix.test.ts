/**
 * The display-order overview: what analyses, auto-cut and auto-sort read.
 *
 * With one overview cell per texel the mapping is exact, so the matrix can be
 * checked cell by cell against DisplayMapping after arbitrary engine edits.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/curation/AutoCut', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/curation/AutoCut')>();
  return { ...actual, autoCut: vi.fn(actual.autoCut) };
});
vi.mock('../../src/curation/AutoSort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/curation/AutoSort')>();
  return { ...actual, autoSort: vi.fn(actual.autoSort), autoSortCore: vi.fn(actual.autoSortCore) };
});

import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { buildDisplayRuns, displayToFileTexel, displayWidth } from '../../src/core/DisplayMapping';
import {
  buildDisplayMatrix, getDisplayContactMap, displayCellRemap, permuteVector,
} from '../../src/core/DisplayMatrix';
import { autoCutContigs, autoSortContigs, scaffoldAwareAutoSort } from '../../src/curation/BatchOperations';
import { autoCut } from '../../src/curation/AutoCut';
import { autoSort, autoSortCore } from '../../src/curation/AutoSort';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A symmetric matrix in which every unordered cell pair has its own value. */
function fileMatrix(n: number): Float32Array {
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = i * n + j + 1;
      m[i * n + j] = v;
      m[j * n + i] = v;
    }
  }
  return m;
}

/** Load contigs of the given widths over an overview of `cells` cells per side. */
function load(widths: number[], cells?: number): MapData {
  const contigs: ContigInfo[] = [];
  let pos = 0;
  widths.forEach((w, i) => {
    contigs.push({
      name: `c${i}`, originalIndex: i, length: w * 1000,
      pixelStart: pos, pixelEnd: pos + w, inverted: false, scaffoldId: null,
    });
    pos += w;
  });
  const size = cells ?? pos;
  const map: MapData = {
    filename: 't.pretext', textureSize: pos, numMipMaps: 1, tileResolution: pos,
    tilesPerDimension: 1, contigs, fileContigCount: contigs.length,
    contactMap: fileMatrix(size), rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
  state.reset();
  state.update({ map, contigOrder: widths.map((_, i) => i) });
  return map;
}

function randomEdits(rnd: () => number, n: number): void {
  for (let k = 0; k < n; k++) {
    const s = state.get();
    const count = s.contigOrder.length;
    const i = Math.floor(rnd() * count);
    const r = rnd();
    if (r < 0.25) {
      const c = s.map!.contigs[s.contigOrder[i]];
      const w = c.pixelEnd - c.pixelStart;
      if (w >= 2) CurationEngine.cut(i, 1 + Math.floor(rnd() * (w - 1)));
    } else if (r < 0.45) {
      if (i < count - 1 && !CurationEngine.joinBlockedReason(i)) CurationEngine.join(i);
    } else if (r < 0.7) {
      CurationEngine.invert(i);
    } else {
      CurationEngine.move(i, Math.floor(rnd() * count));
    }
  }
}

/** The display matrix built cell by cell from DisplayMapping. */
function oracle(map: MapData, order: number[]): Float32Array {
  const n = Math.round(Math.sqrt(map.contactMap!.length));
  const runs = buildDisplayRuns(map.contigs, order);
  const width = displayWidth(runs);
  const out = new Float32Array(n * n);
  for (let y = 0; y < width; y++) {
    const fy = displayToFileTexel(runs, y);
    for (let x = 0; x < width; x++) {
      out[y * n + x] = map.contactMap![fy * n + displayToFileTexel(runs, x)];
    }
  }
  return out;
}

const WIDTHS = [9, 14, 5, 12, 8];

describe('buildDisplayMatrix', () => {
  beforeEach(() => state.reset());

  it('is the file matrix itself when nothing has moved', () => {
    const map = load(WIDTHS);
    expect(buildDisplayMatrix(map, state.get().contigOrder)).toBe(map.contactMap);
    CurationEngine.cut(1, 6); // a cut alone leaves every texel where it was
    expect(buildDisplayMatrix(state.get().map!, state.get().contigOrder)).toBe(map.contactMap);
  });

  it('shows, at every cell, the file cells DisplayMapping says are there', () => {
    for (let seed = 1; seed <= 40; seed++) {
      load(WIDTHS);
      randomEdits(mulberry32(seed), 20);
      const s = state.get();
      const got = buildDisplayMatrix(s.map!, s.contigOrder)!;
      expect(Array.from(got), `seed ${seed}`).toEqual(Array.from(oracle(s.map!, s.contigOrder)));
    }
  });

  it('stays symmetric and keeps every value exactly once', () => {
    load(WIDTHS);
    randomEdits(mulberry32(7), 30);
    const s = state.get();
    const got = buildDisplayMatrix(s.map!, s.contigOrder)!;
    const n = 48;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(got[i * n + j]).toBe(got[j * n + i]);
    expect(Array.from(got).sort((a, b) => a - b)).toEqual(Array.from(s.map!.contactMap!).sort((a, b) => a - b));
  });

  it('packs a subset of contigs from the left and leaves the rest empty', () => {
    const map = load(WIDTHS);
    const sub = [3, 1]; // widths 12 and 14
    const got = buildDisplayMatrix(map, sub)!;
    expect(Array.from(got)).toEqual(Array.from(oracle(map, sub)));
    const n = 48;
    expect(got[0]).toBe(map.contactMap![28 * n + 28]);      // first cell of c3
    expect(got[12 * n + 12]).toBe(map.contactMap![9 * n + 9]); // then c1
    expect(got[26 * n + 26]).toBe(0);                         // past the subset
  });

  it('samples a coarser overview through each cell centre', () => {
    // 48 texels over 16 cells: three texels per cell, so a cell's centre is
    // the centre of its middle texel. Contig edges are not on cell edges.
    const map = load(WIDTHS, 16);
    CurationEngine.move(0, 4);
    CurationEngine.invert(1);
    const s = state.get();
    const got = buildDisplayMatrix(s.map!, s.contigOrder)!;
    const runs = buildDisplayRuns(s.map!.contigs, s.contigOrder);
    const cellOf = (d: number) => Math.floor(displayToFileTexel(runs, d * 3 + 1) / 3);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(got[y * 16 + x]).toBe(map.contactMap![cellOf(y) * 16 + cellOf(x)]);
      }
    }
  });

  it('reorders a per-cell vector the same way', () => {
    load(WIDTHS);
    CurationEngine.move(2, 0);
    CurationEngine.invert(3);
    const s = state.get();
    const remap = displayCellRemap(s.map!.contigs, s.contigOrder, 48, 48);
    const ramp = Float32Array.from({ length: 48 }, (_, i) => i);
    const runs = buildDisplayRuns(s.map!.contigs, s.contigOrder);
    expect(Array.from(permuteVector(ramp, remap)))
      .toEqual(Array.from({ length: 48 }, (_, d) => displayToFileTexel(runs, d)));
  });
});

describe('getDisplayContactMap', () => {
  beforeEach(() => state.reset());

  it('is null with no map and follows the current order', () => {
    expect(getDisplayContactMap()).toBeNull();
    load(WIDTHS);
    CurationEngine.move(0, 3);
    const s = state.get();
    const got = getDisplayContactMap()!;
    expect(got.size).toBe(48);
    expect(Array.from(got.data)).toEqual(Array.from(oracle(s.map!, s.contigOrder)));
  });

  it('is rebuilt when the layout changes and not when only scaffolds do', () => {
    load(WIDTHS);
    const scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
    CurationEngine.move(0, 3);
    const a = getDisplayContactMap()!.data;
    scaffolds.paintContigs([0, 1], scaffolds.createScaffold('chr'));
    expect(getDisplayContactMap()!.data).toBe(a);
    CurationEngine.invert(1);
    const b = getDisplayContactMap()!.data;
    expect(b).not.toBe(a);
    CurationEngine.undo();
    expect(Array.from(getDisplayContactMap()!.data)).toEqual(Array.from(a));
  });

  it('does not serve one file matrix for another with the same layout', () => {
    const first = load(WIDTHS);
    CurationEngine.move(0, 3);
    const a = getDisplayContactMap()!.data;
    load(WIDTHS);
    state.update({ map: { ...state.get().map!, contactMap: first.contactMap!.map((v) => v * 2) } });
    CurationEngine.move(0, 3);
    expect(getDisplayContactMap()!.data[0]).toBe(a[0] * 2);
  });
});

describe('auto-cut and auto-sort read the curated layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reset();
  });

  // 64 contigs so auto-sort does not take its small-assembly shortcut.
  const MANY = Array.from({ length: 64 }, (_, i) => 3 + (i % 4));

  function scramble(): void {
    load(MANY);
    const rnd = mulberry32(11);
    for (let k = 0; k < 40; k++) {
      const n = state.get().contigOrder.length;
      const i = Math.floor(rnd() * n);
      if (rnd() < 0.3) CurationEngine.invert(i);
      else CurationEngine.move(i, Math.floor(rnd() * n));
    }
  }

  it('autoCutContigs passes the display-order matrix', () => {
    scramble();
    const s = state.get();
    const expected = Array.from(oracle(s.map!, s.contigOrder));
    expect(expected).not.toEqual(Array.from(s.map!.contactMap!));

    autoCutContigs();

    const [matrix, size, , order] = (autoCut as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(size).toBe(Math.sqrt(expected.length));
    expect(order).toEqual(s.contigOrder);
    expect(Array.from(matrix as Float32Array)).toEqual(expected);
  });

  it('autoSortContigs passes the display-order matrix', () => {
    scramble();
    const s = state.get();
    const expected = Array.from(oracle(s.map!, s.contigOrder));

    autoSortContigs();

    const [matrix] = (autoSort as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Array.from(matrix as Float32Array)).toEqual(expected);
  });

  it('scaffold-aware sort gives each scaffold a matrix of just its contigs, packed', () => {
    scramble();
    const scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
    const a = scaffolds.createScaffold('a');
    const b = scaffolds.createScaffold('b');
    scaffolds.paintContigs(Array.from({ length: 20 }, (_, i) => i * 2), a);      // interleaved
    scaffolds.paintContigs(Array.from({ length: 20 }, (_, i) => i * 2 + 1), b);
    const s = state.get();

    scaffoldAwareAutoSort(scaffolds);

    const calls = (autoSortCore as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [matrix, , , subOrder] of calls) {
      expect(Array.from(matrix as Float32Array)).toEqual(Array.from(oracle(s.map!, subOrder as number[])));
    }
  });
});
