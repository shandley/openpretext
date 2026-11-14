/**
 * End-contact scores on a synthetic .pretext file whose true layout is known.
 *
 * The file's texels are written from a model genome: contact between two
 * places falls by 32 (of 255) per 4-texel step between them on the same
 * chromosome and is zero between chromosomes. The file stores that genome
 * misassembled, so the scores can be checked against what is true:
 *
 *   s1  texels   0-127  chromosome 1: a first part (0-63), a part stored
 *                       inverted (64-95), a third part (96-127)
 *   s2  texels 128-191  chromosome 2
 *   s3  texels 192-223  the rest of chromosome 1, which follows s1
 *   s4  texels 224-255  chromosome 3
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildSyntheticPretext } from '../helpers/pretextWriter';
import { parsePretextFile } from '../../src/formats/PretextParser';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { TileSampler } from '../../src/analysis/TileSampler';
import {
  EndContactScorer, contigEnds, continuityProfile, findDips, describeContacts, localSampler,
} from '../../src/analysis/EndContacts';
import { parseScript } from '../../src/scripting/ScriptParser';
import { executeScript, type ScriptContext } from '../../src/scripting/ScriptExecutor';

/** Chromosome and position (in 4-texel blocks) of a file block. */
function truth(block: number): [number, number] {
  if (block < 16) return [1, block];
  if (block < 24) return [1, 16 + (23 - block)];   // stored inverted
  if (block < 32) return [1, block];
  if (block < 48) return [2, block - 32];
  if (block < 56) return [1, 32 + (block - 48)];
  return [3, block - 56];
}

function texel(_level: number, x: number, y: number): number {
  const [ca, pa] = truth(x >> 2);
  const [cb, pb] = truth(y >> 2);
  return ca === cb ? Math.max(0, 255 - 32 * Math.abs(pa - pb)) : 0;
}

const W = 8;
let base: MapData;

beforeAll(async () => {
  const bytes = buildSyntheticPretext({
    textureResLog2: 6, tilesLog2: 2, mipMapLevels: 1, texel,
    contigs: [{ name: 's1', texels: 128 }, { name: 's2', texels: 64 }, { name: 's3', texels: 32 }, { name: 's4', texels: 32 }],
  });
  const parsed = await parsePretextFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { coarsestOnly: true });
  const contigs: ContigInfo[] = parsed.contigs.map((c, i) => ({
    name: c.name, originalIndex: i, length: c.length, pixelStart: c.pixelStart, pixelEnd: c.pixelEnd, inverted: false, scaffoldId: null,
  }));
  base = {
    filename: 'synthetic.pretext', textureSize: 256, numMipMaps: 1, tileResolution: 64, tilesPerDimension: 4,
    contigs, contactMap: null, rawTiles: parsed.tiles, parsedHeader: parsed.header, extensions: new Map(),
    genomeLength: Number(parsed.header.totalGenomeLength), fileContigCount: 4,
  };
});

beforeEach(() => {
  state.reset();
  state.update({ map: { ...base, contigs: base.contigs.map((c) => ({ ...c })) }, contigOrder: [0, 1, 2, 3] });
});

const scorerNow = () => {
  const s = state.get();
  const sampler = new TileSampler({ tiles: s.map!.rawTiles!, header: s.map!.parsedHeader! });
  return { s, sampler, scorer: new EndContactScorer(sampler, s.map!, s.contigOrder, W) };
};
const nameOf = (id: number) => state.get().map!.contigs[id].name;

describe('TileSampler', () => {
  it('returns the stored values, on both sides of the diagonal', () => {
    const sampler = new TileSampler({ tiles: base.rawTiles!, header: base.parsedHeader! });
    expect(sampler.boxMean(0, 4, 0, 4)).toBeCloseTo(1, 6);
    expect(sampler.boxMean(0, 4, 4, 8)).toBeCloseTo(223 / 255, 6);
    expect(sampler.boxMean(4, 8, 0, 4)).toBeCloseTo(223 / 255, 6);
    // Texels 124-127 of s1 (position 31) against the start of s3 (position 32), in another tile.
    expect(sampler.boxMean(124, 128, 192, 196)).toBeCloseTo(223 / 255, 6);
    expect(sampler.boxMean(192, 196, 124, 128)).toBeCloseTo(223 / 255, 6);
    // Different chromosomes.
    expect(sampler.boxMean(0, 64, 128, 192)).toBe(0);
  });

  it('gives NaN for an empty or out-of-range box', () => {
    const sampler = new TileSampler({ tiles: base.rawTiles!, header: base.parsedHeader! });
    expect(sampler.boxMean(8, 8, 0, 4)).toBeNaN();
    expect(sampler.boxMean(0, 4, 250, 260)).toBeNaN();
  });

  it('keeps a bounded number of decoded tiles and still returns the same values', () => {
    const small = new TileSampler({ tiles: base.rawTiles!, header: base.parsedHeader! }, 2);
    const big = new TileSampler({ tiles: base.rawTiles!, header: base.parsedHeader! });
    for (const [x, y] of [[0, 0], [70, 200], [130, 130], [200, 10], [0, 0], [250, 250]]) {
      expect(small.boxMean(x, x + 4, y, y + 4)).toBe(big.boxMean(x, x + 4, y, y + 4));
    }
  });
});

describe('EndContactScorer', () => {
  it('sets the scale from neighbouring windows along unbroken sequence', () => {
    // Two 2-block windows side by side: block distances 1, 2, 2, 3.
    expect(scorerNow().scorer.reference(W)).toBeCloseTo((223 + 191 + 191 + 159) / 4 / 255, 6);
  });

  it('describes each end by where it is in the file and which way its contig runs', () => {
    const s = state.get();
    expect(contigEnds(s.map!, s.contigOrder, W).slice(0, 2)).toEqual([
      { orderIndex: 0, contigId: 0, side: 'left', tip: 0, inward: 1, available: 8, whole: false },
      { orderIndex: 0, contigId: 0, side: 'right', tip: 127, inward: -1, available: 8, whole: false },
    ]);
    CurationEngine.invert(0);
    const flipped = contigEnds(state.get().map!, state.get().contigOrder, W);
    expect(flipped[0]).toMatchObject({ side: 'left', tip: 127, inward: -1 });
    expect(flipped[1]).toMatchObject({ side: 'right', tip: 0, inward: 1 });
  });

  it('finds the sequence that truly follows, past the one placed next to it', () => {
    const { scorer } = scorerNow();
    const rep = scorer.report(0, 'right')!;
    expect(nameOf(rep.best[0].contigId)).toBe('s3');
    expect(rep.best[0].side).toBe('left');
    expect(rep.best[0].score).toBeCloseTo(1, 6);
    // s2 is next to it in the file and is another chromosome.
    expect(nameOf(rep.neighbour!.contigId)).toBe('s2');
    expect(rep.neighbour!.score).toBe(0);
    expect(rep.neighbourRank).toBeGreaterThan(1);
    // The left end of s1 is a chromosome end: nothing contacts it.
    expect(scorer.report(0, 'left')!.neighbour).toBeNull();
    expect(scorer.report(0, 'left')!.best[0].score).toBe(0);
  });

  it('shows that a piece is the wrong way round, and that turning it fixes both joins', () => {
    CurationEngine.cut(0, 96);
    CurationEngine.cut(0, 64);         // s1 is now three pieces: #0, #1 (stored inverted), #2
    let { scorer } = scorerNow();
    const before = scorer.report(0, 'right')!;
    // The first piece's right end contacts the FAR end of the middle piece like a true neighbour.
    expect(before.best[0]).toMatchObject({ orderIndex: 1, side: 'right' });
    expect(before.best[0].score).toBeCloseTo(1, 6);
    expect(before.neighbour).toMatchObject({ orderIndex: 1, side: 'left' });
    expect(before.neighbour!.score).toBeLessThan(0.05);
    expect(scorer.report(2, 'left')!.best[0]).toMatchObject({ orderIndex: 1, side: 'left' });

    CurationEngine.invert(1);
    ({ scorer } = scorerNow());
    for (const [i, side] of [[0, 'right'], [1, 'left'], [1, 'right'], [2, 'left']] as Array<[number, 'left' | 'right']>) {
      const rep = scorer.report(i, side)!;
      expect(rep.neighbourRank).toBe(1);
      expect(rep.neighbour!.score).toBeCloseTo(1, 6);
    }
  });

  it('reads a short contig against the full window of a long one', () => {
    CurationEngine.cut(2, 4);          // a 4-texel piece at the start of s3
    const { scorer } = scorerNow();
    const tiny = scorer.ends.find((e) => e.orderIndex === 2 && e.side === 'left')!;
    expect(tiny).toMatchObject({ available: 2, whole: false });
    const rep = scorer.report(2, 'left')!;
    expect(nameOf(rep.best[0].contigId)).toBe('s1');
    expect(rep.best[0]).toMatchObject({ side: 'right', window: 2 });
  });
});

describe('continuity along a contig', () => {
  it('drops at both ends of the inverted part and nowhere else', () => {
    const { s, sampler, scorer } = scorerNow();
    const dips = findDips(continuityProfile(scorer, sampler, s.map!, 0, W));
    expect(dips.map((d) => d.offset)).toEqual([64, 96]);
    expect(dips[0].score).toBeLessThan(0.05);
    expect(findDips(continuityProfile(scorer, sampler, s.map!, 1, W))).toEqual([]);
  });

  it('is gone once the part is cut out and turned', () => {
    CurationEngine.cut(0, 96);
    CurationEngine.cut(0, 64);
    CurationEngine.invert(1);
    CurationEngine.join(1);
    CurationEngine.join(0);            // one contig again, now in true order
    const { s, sampler, scorer } = scorerNow();
    expect(s.contigOrder.length).toBe(4);
    // Positions next to the joins are not scored; everywhere else is unbroken.
    expect(findDips(continuityProfile(scorer, sampler, s.map!, s.contigOrder[0], W))).toEqual([]);
  });
});

describe('contacts command', () => {
  const run = (script: string) => {
    const { commands, errors } = parseScript(script);
    expect(errors).toEqual([]);
    return executeScript(commands, { curation: CurationEngine, state } as unknown as ScriptContext, { continueOnError: true });
  };

  it('prints both ends with the current neighbour and the strongest contacts', () => {
    const [r] = run('contacts s1');
    expect(r.success).toBe(true);
    const lines = r.message.split('\n');
    expect(lines[0]).toBe("Contacts of 's1' (1.00 = contact between true neighbours on this map)");
    expect(lines[1]).toBe('left end, 24-texel window');
    expect(lines[2]).toBe('  now next to: nothing (edge of the map)');
    expect(lines[4]).toBe('right end, 24-texel window');
    expect(lines[5]).toMatch(/^ {2}now next to: s2 \(left end\) 0\.00, ranked \d of 6$/);
    expect(lines[6]).toMatch(/^ {2}strongest: {3}s3 \(left end\) 1\.00; /);
  });

  it('changes nothing', () => {
    run('contacts s1');
    expect(state.get().undoStack.length).toBe(0);
    expect(state.get().contigOrder).toEqual([0, 1, 2, 3]);
  });

  it('says why a map without tiles cannot be read', () => {
    // What the app's map looks like after the tile bytes went to the worker.
    state.update({ map: { ...state.get().map!, rawTiles: base.rawTiles!.map(() => new Uint8Array(0)) } });
    expect(localSampler(state.get().map!)).toBeNull();
    const [r] = run('contacts s1');
    expect(r.success).toBe(false);
    expect(r.message).toContain('detail tiles');
  });

  it('hands the layout to the context when it provides contacts, and returns the answer later', async () => {
    const seen: Array<{ order: number[]; orderIndex: number }> = [];
    const { commands } = parseScript('contacts s3\nmove s3 to 0');
    const ctx = {
      curation: CurationEngine, state,
      contacts: (map: MapData, order: number[], orderIndex: number) => {
        seen.push({ order, orderIndex });
        return Promise.resolve(describeContacts(localSampler(base)!, map, order, orderIndex));
      },
    } as unknown as ScriptContext;
    const results = executeScript(commands, ctx, { continueOnError: true });
    expect(results[0].message).toBe("Contacts of 's3' (1.00 = contact between true neighbours on this map)");
    // The order given is the one at the time of the command, not after the move.
    expect(seen).toEqual([{ order: [0, 1, 2, 3], orderIndex: 2 }]);
    expect(state.get().contigOrder).toEqual([2, 0, 1, 3]);
    const text = await results[0].followUp!;
    expect(text.split('\n')[2]).toMatch(/^ {2}strongest: {3}s1 \(right end\) 1\.00; /);
  });

  it('reports a failed read through the follow-up, not as an unhandled rejection', async () => {
    const { commands } = parseScript('contacts s1');
    const ctx = { curation: CurationEngine, state, contacts: () => Promise.reject(new Error('no tiles')) } as unknown as ScriptContext;
    const [r] = executeScript(commands, ctx, { continueOnError: true });
    expect(r.success).toBe(true);
    await expect(r.followUp).rejects.toThrow('no tiles');
  });
});
