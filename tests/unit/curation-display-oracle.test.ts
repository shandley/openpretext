/**
 * Property tests: the curation engine against an independent oracle.
 *
 * The oracle keeps each contig as a literal array of the file texels it shows,
 * left to right, and applies cut / join / invert with plain array operations.
 * After every engine operation, the display mapping derived from engine state
 * must show exactly the oracle's texels. This pins the invariant the renderer
 * and the analyses rely on: the engine's bookkeeping says what is on screen.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { buildDisplayRuns, displayToFileTexel, displayWidth } from '../../src/core/DisplayMapping';
import { getContigBoundaries } from '../../src/core/DerivedState';
import { buildPixelRemapTable } from '../../src/renderer/ContactMapReorder';

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

function load(widths: number[]): number {
  const contigs: ContigInfo[] = [];
  let pos = 0;
  widths.forEach((w, i) => {
    contigs.push({
      name: `c${i}`, originalIndex: i, length: w * 1000,
      pixelStart: pos, pixelEnd: pos + w, inverted: false, scaffoldId: null,
    });
    pos += w;
  });
  const map = {
    filename: 't.pretext', textureSize: pos, numMipMaps: 1, tileResolution: pos,
    tilesPerDimension: 1, contigs, contactMap: null, rawTiles: null,
    parsedHeader: null, extensions: new Map(),
  } satisfies MapData;
  state.reset();
  state.update({ map, contigOrder: widths.map((_, i) => i) });
  return pos;
}

/** File texel shown at every display texel, from engine state. */
function shown(): number[] {
  const s = state.get();
  const runs = buildDisplayRuns(s.map!.contigs, s.contigOrder);
  return Array.from({ length: displayWidth(runs) }, (_, d) => displayToFileTexel(runs, d));
}

function widthOf(id: number): number {
  const c = state.get().map!.contigs[id];
  return c.pixelEnd - c.pixelStart;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

describe('engine vs texel oracle', () => {
  beforeEach(() => state.reset());

  it('cut on an inverted contig leaves the displayed map unchanged', () => {
    load([10, 20, 10]);
    CurationEngine.invert(1);
    const before = shown();
    expect(before.slice(10, 30)).toEqual(range(10, 30).reverse());

    CurationEngine.cut(1, 3);
    expect(shown()).toEqual(before);

    // The display-left child holds the 3 texels shown at the left: 29, 28, 27.
    const s = state.get();
    const left = s.map!.contigs[s.contigOrder[1]];
    const right = s.map!.contigs[s.contigOrder[2]];
    expect([left.pixelStart, left.pixelEnd, left.inverted]).toEqual([27, 30, true]);
    expect([right.pixelStart, right.pixelEnd, right.inverted]).toEqual([10, 27, true]);
  });

  it('join of contigs that are not file neighbours holds exactly their texels', () => {
    const total = load([10, 10, 10]);
    CurationEngine.move(2, 1); // a c b
    expect(state.get().contigOrder).toEqual([0, 2, 1]);
    const before = shown();

    CurationEngine.join(0); // a+c, b
    expect(shown()).toEqual(before);
    const s = state.get();
    const merged = s.map!.contigs[s.contigOrder[0]];
    expect(merged.pixelEnd - merged.pixelStart).toBe(20);
    expect(merged.pixelSegments).toEqual([
      { start: 0, end: 10, reversed: false },
      { start: 20, end: 30, reversed: false },
    ]);
    // Boundaries still partition the map.
    const b = getContigBoundaries();
    expect(b[b.length - 1]).toBeCloseTo(1, 12);
    expect(b[0]).toBeCloseTo(20 / total, 12);
  });

  it('a cut at the visible seam of such a join gives back the two pieces', () => {
    load([10, 10, 10]);
    CurationEngine.move(2, 1);
    CurationEngine.join(0);
    const before = shown();
    CurationEngine.cut(0, 10);
    expect(shown()).toEqual(before);
    const s = state.get();
    const l = s.map!.contigs[s.contigOrder[0]];
    const r = s.map!.contigs[s.contigOrder[1]];
    expect([l.pixelStart, l.pixelEnd, l.pixelSegments]).toEqual([0, 10, undefined]);
    expect([r.pixelStart, r.pixelEnd, r.pixelSegments]).toEqual([20, 30, undefined]);
    expect([l.length, r.length]).toEqual([10000, 10000]);
  });

  it('join of two inverted neighbours keeps their displayed order', () => {
    load([10, 10]);
    CurationEngine.invert(0);
    CurationEngine.invert(1);
    const before = shown();
    expect(before).toEqual([...range(0, 10).reverse(), ...range(10, 20).reverse()]);
    CurationEngine.join(0);
    expect(shown()).toEqual(before);
  });

  it('join of file neighbours stays a plain span', () => {
    load([10, 10, 10]);
    CurationEngine.join(0);
    const s = state.get();
    const merged = s.map!.contigs[s.contigOrder[0]];
    expect([merged.pixelStart, merged.pixelEnd, merged.inverted, merged.pixelSegments])
      .toEqual([0, 20, false, undefined]);
  });

  it('inverting a joined contig mirrors it, and undo/redo restore it', () => {
    load([4, 6, 5]);
    CurationEngine.move(2, 1);
    CurationEngine.join(0);
    const joined = shown();
    CurationEngine.invert(0);
    expect(shown().slice(0, 9)).toEqual(joined.slice(0, 9).reverse());
    CurationEngine.undo();
    expect(shown()).toEqual(joined);
    CurationEngine.redo();
    expect(shown().slice(0, 9)).toEqual(joined.slice(0, 9).reverse());
  });

  it('matches the oracle over random operation sequences, and through undo and redo', () => {
    let cutsOnReversed = 0;
    let multiSegmentJoins = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const int = (n: number) => Math.floor(rnd() * n);

      const widths = Array.from({ length: 3 + int(6) }, () => (rnd() < 0.15 ? 0 : 1 + int(12)));
      const total = load(widths);

      // Oracle: contig id -> file texels shown, left to right.
      const oracle = new Map<number, number[]>();
      let pos = 0;
      widths.forEach((w, i) => { oracle.set(i, range(pos, pos + w)); pos += w; });
      const oracleShown = () => state.get().contigOrder.flatMap((id) => oracle.get(id)!);

      const history: number[][] = [shown()];
      const steps = 40;
      for (let step = 0; step < steps; step++) {
        const s = state.get();
        const order = s.contigOrder;
        const n = order.length;
        const recordedBefore = s.undoStack.length;
        const kind = int(4);
        const idx = int(n);
        const id = order[idx];

        if (kind === 0 && widthOf(id) >= 2) {
          const off = 1 + int(widthOf(id) - 1);
          if (s.map!.contigs[id].inverted) cutsOnReversed++;
          const nextId = s.map!.contigs.length;
          const arr = oracle.get(id)!;
          CurationEngine.cut(idx, off);
          oracle.set(nextId, arr.slice(0, off));
          oracle.set(nextId + 1, arr.slice(off));
        } else if (kind === 1) {
          CurationEngine.invert(idx);
          oracle.set(id, [...oracle.get(id)!].reverse());
        } else if (kind === 2 && n >= 2) {
          const to = int(n);
          CurationEngine.move(idx, to);
        } else if (kind === 3 && idx + 1 < n) {
          const nextId = s.map!.contigs.length;
          const merged = [...oracle.get(id)!, ...oracle.get(order[idx + 1])!];
          CurationEngine.join(idx);
          oracle.set(nextId, merged);
          if (state.get().map!.contigs[nextId].pixelSegments) multiSegmentJoins++;
        } else {
          continue;
        }

        const now = shown();
        expect(now, `seed ${seed} step ${step}`).toEqual(oracleShown());

        // Every texel is shown exactly once.
        expect([...now].sort((a, b) => a - b)).toEqual(range(0, total));

        // Width bookkeeping: each displayed contig is as wide as its texels.
        for (const cid of state.get().contigOrder) {
          expect(widthOf(cid), `seed ${seed} step ${step} contig ${cid}`).toBe(oracle.get(cid)!.length);
        }

        // At full resolution the overview remap is the same mapping.
        expect(Array.from(buildPixelRemapTable(state.get().map!.contigs, state.get().contigOrder, total)))
          .toEqual(now);

        // A move to the same position is a no-op and records nothing.
        if (state.get().undoStack.length > recordedBefore) history.push(now);
      }

      // Undo step by step back to the start, then redo forward again.
      const done = state.get().undoStack.length;
      expect(done).toBe(history.length - 1);
      for (let k = done; k > 0; k--) {
        CurationEngine.undo();
        expect(shown(), `seed ${seed} undo to ${k - 1}`).toEqual(history[k - 1]);
      }
      for (let k = 1; k <= done; k++) {
        CurationEngine.redo();
        expect(shown(), `seed ${seed} redo to ${k}`).toEqual(history[k]);
      }
    }

    // The random walk must actually exercise the cases that used to be wrong.
    expect(cutsOnReversed).toBeGreaterThan(200);
    expect(multiSegmentJoins).toBeGreaterThan(200);
  });
});
