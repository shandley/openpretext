/**
 * Positions on the curated map read as sequence and base pair, and cuts typed
 * as a base-pair position, checked against the real curation engine and the
 * rows the AGP writer would produce.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { parseScript } from '../../src/scripting/ScriptParser';
import { executeScript, type ScriptContext, type ScriptResult } from '../../src/scripting/ScriptExecutor';
import { locateDisplayTexel, boundaryAtOffset, findSequenceCut } from '../../src/core/SequenceCoords';
import { buildAGPObjects } from '../../src/export/AGPModel';

// Three sequences of 100, 150 and 50 texels; 1000 bp per texel.
const SPANS: Array<[string, number, number]> = [['a', 0, 100], ['b', 100, 250], ['c', 250, 300]];

function load(): void {
  const contigs: ContigInfo[] = SPANS.map(([name, start, end], i) => ({
    name, originalIndex: i, length: (end - start) * 1000,
    pixelStart: start, pixelEnd: end, inverted: false, scaffoldId: null,
  }));
  const map = {
    filename: 't.pretext', textureSize: 300, numMipMaps: 1, tileResolution: 300,
    tilesPerDimension: 1, contigs, contactMap: null, rawTiles: null,
    parsedHeader: null, extensions: new Map(),
    genomeLength: 300_000, fileContigCount: 3,
  } satisfies MapData;
  state.reset();
  state.update({ map, contigOrder: [0, 1, 2] });
}

function run(script: string): ScriptResult[] {
  const { commands, errors } = parseScript(script);
  expect(errors).toEqual([]);
  const ctx = { curation: CurationEngine, state } as unknown as ScriptContext;
  return executeScript(commands, ctx, { continueOnError: true });
}

/** The AGP rows for sequence `name`, in map order, as "beg-end" with a strand. */
function rowsOf(name: string): string[] {
  const s = state.get();
  return buildAGPObjects(s.map!, s.contigOrder)
    .flatMap((o) => o.fragments)
    .filter((f) => f.component === name)
    .map((f) => `${f.beg}-${f.end}${f.reversed ? '-' : '+'}`);
}

const here = (d: number) => {
  const s = state.get();
  return locateDisplayTexel(s.map!, s.contigOrder, d);
};

describe('locateDisplayTexel', () => {
  beforeEach(load);

  it('names the sequence and base pairs of a texel on an unedited map', () => {
    expect(here(0)).toMatchObject({ sequence: 'a', sequenceTexel: 0, bpStart: 1, bpEnd: 1000, offset: 0, orderIndex: 0 });
    expect(here(120)).toMatchObject({ sequence: 'b', sequenceTexel: 20, bpStart: 20_001, bpEnd: 21_000, offset: 20, contigTexels: 150 });
    expect(here(299)).toMatchObject({ sequence: 'c', sequenceTexel: 49, bpEnd: 50_000 });
  });

  it('is null outside the map', () => {
    expect(here(300)).toBeNull();
    expect(here(-1)).toBeNull();
    expect(here(1.5)).toBeNull();
  });

  it('follows an inversion and a move', () => {
    CurationEngine.invert(1);      // b reversed
    CurationEngine.move(2, 0);     // c a b
    expect(here(0)).toMatchObject({ sequence: 'c', sequenceTexel: 0 });
    expect(here(50)).toMatchObject({ sequence: 'a', sequenceTexel: 0 });
    // First display texel of reversed b is its last texel.
    expect(here(150)).toMatchObject({ sequence: 'b', sequenceTexel: 149, offset: 0, reversed: true, bpStart: 149_001 });
    expect(here(299)).toMatchObject({ sequence: 'b', sequenceTexel: 0, offset: 149 });
  });

  it('looks through a join of two sequences', () => {
    CurationEngine.move(2, 0);     // c a b
    CurationEngine.join(0);        // [c+a] b
    expect(here(10)).toMatchObject({ sequence: 'c', sequenceTexel: 10, orderIndex: 0, offset: 10, contigTexels: 150 });
    expect(here(60)).toMatchObject({ sequence: 'a', sequenceTexel: 10, orderIndex: 0, offset: 60 });
  });
});

describe('boundaryAtOffset', () => {
  beforeEach(load);

  it('gives the last base before a break, as an AGP row would end', () => {
    const s = state.get();
    expect(boundaryAtOffset(s.map!, s.contigOrder, 1, 30)).toEqual({ sequence: 'b', texel: 30, bp: 30_000 });
    CurationEngine.cut(1, 30);
    expect(rowsOf('b')).toEqual(['1-30000+', '30001-150000+']);
  });

  it('counts from the far end on an inverted contig', () => {
    CurationEngine.invert(1);
    const s = state.get();
    // 30 texels from the display-left edge of reversed b is texel 120 of b.
    expect(boundaryAtOffset(s.map!, s.contigOrder, 1, 30)).toEqual({ sequence: 'b', texel: 120, bp: 120_000 });
  });

  it('is null at a contig edge and across a join', () => {
    CurationEngine.move(2, 0);
    CurationEngine.join(0);        // [c+a] b
    const s = state.get();
    expect(boundaryAtOffset(s.map!, s.contigOrder, 0, 0)).toBeNull();
    expect(boundaryAtOffset(s.map!, s.contigOrder, 0, 50)).toBeNull();
    expect(boundaryAtOffset(s.map!, s.contigOrder, 0, 51)).toEqual({ sequence: 'a', texel: 1, bp: 1000 });
  });
});

describe('cut <sequence> at <bp>', () => {
  beforeEach(load);

  it('breaks the sequence at the position, and the AGP rows say so', () => {
    const [r] = run('cut b at 30kb');
    expect(r.success).toBe(true);
    expect(r.message).toBe("Cut 'b' after 30,000 bp (texel 30 of 150)");
    expect(rowsOf('b')).toEqual(['1-30000+', '30001-150000+']);
    expect(rowsOf('a')).toEqual(['1-100000+']);
  });

  it('takes bp, kb and Mb, and thousands separators', () => {
    expect(run('cut b at 0.03Mb')[0].success).toBe(true);
    load();
    expect(run('cut b at 30,000')[0].success).toBe(true);
    expect(rowsOf('b')).toEqual(['1-30000+', '30001-150000+']);
  });

  it('rounds to the nearest texel boundary and reports where the break went', () => {
    const [r] = run('cut b at 30400');
    expect(r.message).toBe("Cut 'b' after 30,000 bp (texel 30 of 150)");
    load();
    expect(run('cut b at 30600')[0].message).toBe("Cut 'b' after 31,000 bp (texel 31 of 150)");
  });

  it('finds the position after the sequence was inverted, moved and cut', () => {
    const results = run(['invert b', 'move b to 0', 'cut b at 100kb', 'cut b at 30kb'].join('\n'));
    expect(results.map((x) => x.success)).toEqual([true, true, true, true]);
    // Display order of the reversed sequence: high end first.
    expect(rowsOf('b')).toEqual(['100001-150000-', '30001-100000-', '1-30000-']);
  });

  it('finds the position inside a joined contig', () => {
    const results = run(['move c to 0', 'join c a', 'cut a at 40kb'].join('\n'));
    expect(results.map((x) => x.success)).toEqual([true, true, true]);
    expect(rowsOf('a')).toEqual(['1-40000+', '40001-100000+']);
    expect(rowsOf('c')).toEqual(['1-50000+']);
  });

  it('refuses a position that is already a break, outside the sequence, or at its end', () => {
    const results = run(['cut b at 30kb', 'cut b at 30kb', 'cut b at 150kb', 'cut b at 400', 'cut nope at 5kb', 'cut b_L at 5kb'].join('\n'));
    expect(results.map((x) => x.success)).toEqual([true, false, false, false, false, false]);
    expect(results[1].message).toContain('already broken at 30,000 bp');
    expect(results[2].message).toContain('not inside it');
    expect(results[3].message).toContain('less than half a texel from the end');
    expect(results[4].message).toContain("No sequence named 'nope'");
    expect(results[5].message).toContain('not of a piece made by a cut');
    expect(rowsOf('b')).toEqual(['1-30000+', '30001-150000+']);
  });

  it('is undone as one cut', () => {
    run('cut b at 30kb');
    expect(state.get().contigOrder.length).toBe(4);
    CurationEngine.undo();
    expect(state.get().contigOrder).toEqual([0, 1, 2]);
  });

  it('agrees with findSequenceCut on the offset an inverted contig needs', () => {
    CurationEngine.invert(1);
    const s = state.get();
    expect(findSequenceCut(s.map!, s.contigOrder, 'B', 30_000)).toMatchObject({ orderIndex: 1, offset: 120 });
  });
});

describe('cut parsing', () => {
  it('keeps the offset form and reports a missing position', () => {
    expect(parseScript('cut b 30').commands[0].args).toEqual({ contig: { kind: 'name', value: 'b' }, pixelOffset: 30 });
    expect(parseScript('cut b at').errors.length).toBe(1);
    expect(parseScript('cut b at soon').errors.length).toBe(1);
  });
});
