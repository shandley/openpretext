import { describe, it, expect } from 'vitest';
import type { MapData, ContigInfo } from '../../src/core/State';
import {
  buildEmbeddedTracks,
  embeddedTrackLabels,
  reorderTrackData,
} from '../../src/analysis/EmbeddedTracks';

function contig(name: string, i: number, start: number, end: number, inverted = false): ContigInfo {
  return {
    name, originalIndex: i, length: (end - start) * 100,
    pixelStart: start, pixelEnd: end, inverted, scaffoldId: null,
  };
}

function mapWith(textureSize: number, contigs: ContigInfo[], extensions: Map<string, Int32Array>): MapData {
  return { textureSize, contigs, extensions } as unknown as MapData;
}

describe('reorderTrackData (file order -> display order)', () => {
  const contigs = [contig('a', 0, 0, 4), contig('b', 1, 4, 8), contig('c', 2, 8, 12)];
  // Each contig's region is filled with its own constant, so a permutation bug
  // is visible (a range check would not catch it).
  const src = Float32Array.from([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);

  it('leaves an identity order unchanged', () => {
    expect([...reorderTrackData(src, contigs, [0, 1, 2], 12)]).toEqual([...src]);
  });

  it('moves each contig block to its new display span', () => {
    expect([...reorderTrackData(src, contigs, [2, 1, 0], 12)])
      .toEqual([2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('reverses an inverted contig within its span', () => {
    const grad = Float32Array.from([0, 0, 0, 0, 4, 5, 6, 7, 0, 0, 0, 0]);
    const withInv = [contig('a', 0, 0, 4), contig('b', 1, 4, 8, true), contig('c', 2, 8, 12)];
    expect([...reorderTrackData(grad, withInv, [0, 1, 2], 12)])
      .toEqual([0, 0, 0, 0, 7, 6, 5, 4, 0, 0, 0, 0]);
  });
});

describe('buildEmbeddedTracks', () => {
  const contigs = [contig('a', 0, 0, 6), contig('b', 1, 6, 12)];
  const ext = (...vals: number[]) => Int32Array.from(vals);

  it('returns no tracks when the file carries no extensions', () => {
    expect(buildEmbeddedTracks(mapWith(12, contigs, new Map()), [0, 1])).toHaveLength(0);
  });

  it('classifies coverage / gaps / telomeres and normalizes each by kind', () => {
    const exts = new Map<string, Int32Array>([
      ['coverage', ext(19, 50, 200, 1000, 5000, 60402, 30, 40, 60, 80, 100, 120)],
      ['gaps', ext(0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0)],
      ['telomeres_gap_format', ext(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)],
    ]);
    const tracks = buildEmbeddedTracks(mapWith(12, contigs, exts), [0, 1]);
    const byName = Object.fromEntries(tracks.map(t => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual(['Coverage', 'Gaps', 'Telomeres']);
    // "telomeres_gap_format" must classify as Telomeres, not Gaps (order matters).
    expect(byName['Telomeres'].type).toBe('marker');
    // Coverage is a line spanning the full texture, all values in [0, 1].
    expect(byName['Coverage'].type).toBe('line');
    expect(byName['Coverage'].data).toHaveLength(12);
    expect([...byName['Coverage'].data].every(v => v >= 0 && v <= 1)).toBe(true);
    // Gaps binarized to exactly {0, 1}, set where the source was nonzero.
    expect([...byName['Gaps'].data].every(v => v === 0 || v === 1)).toBe(true);
    expect(byName['Gaps'].data[2]).toBe(1);
    expect(byName['Gaps'].data[9]).toBe(1);
  });

  it('skips an extension whose length does not match textureSize', () => {
    const exts = new Map<string, Int32Array>([['coverage', ext(1, 2, 3)]]);
    expect(buildEmbeddedTracks(mapWith(12, contigs, exts), [0, 1])).toHaveLength(0);
  });

  it('embeddedTrackLabels matches the built track names', () => {
    const exts = new Map<string, Int32Array>([
      ['coverage', ext(...new Array(12).fill(5))],
      ['gaps', ext(...new Array(12).fill(0))],
    ]);
    expect(embeddedTrackLabels(mapWith(12, contigs, exts)).sort()).toEqual(['Coverage', 'Gaps']);
  });
});
