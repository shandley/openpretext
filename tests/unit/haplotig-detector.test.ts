import { describe, it, expect } from 'vitest';
import type { MapData, ContigInfo } from '../../src/core/State';
import type { ContigRange } from '../../src/curation/AutoSort';
import {
  computeContigCoverageRatios,
  detectHaplotigs,
} from '../../src/analysis/HaplotigDetector';

function contig(name: string, start: number, end: number): ContigInfo {
  return {
    name,
    originalIndex: 0,
    length: end - start,
    pixelStart: start,
    pixelEnd: end,
    inverted: false,
    scaffoldId: null,
  };
}

/**
 * Build a size*size symmetric matrix with a smooth P(s) baseline (100/(1+d), so
 * expected[d] is exactly that) and any number of bright rectangular blocks.
 */
function buildMatrix(size: number, blocks: Array<[number, number, number, number, number]>): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      m[i * size + j] = 100 / (1 + Math.abs(i - j));
    }
  }
  for (const [i0, i1, j0, j1, val] of blocks) {
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        m[i * size + j] = val;
        m[j * size + i] = val;
      }
    }
  }
  return m;
}

// N contigs of `binsPer` bins each, laid out contiguously in display order.
function makeRanges(n: number, binsPer = 3): ContigRange[] {
  return Array.from({ length: n }, (_, k) => ({
    start: k * binsPer,
    end: k * binsPer + binsPer,
    orderIndex: k,
  }));
}

// 16 contigs of 3 bins over a 48-bin overview (enough cells per separation that a
// bright block stays a minority of expected[d], as in a real map).
const N = 16;
const SIZE = N * 3;

describe('computeContigCoverageRatios', () => {
  it('returns per-contig median coverage over the assembly median, in file order', () => {
    const contigs = [
      contig('c0', 0, 3),
      contig('c1', 3, 6),
      contig('c2', 6, 9),
      contig('c3', 9, 12),
      contig('hap', 12, 15),
      contig('c5', 15, 18),
    ];
    const cov = new Int32Array(18).fill(100);
    for (let p = 12; p < 15; p++) cov[p] = 50; // the haplotig sits near half depth
    const map = {
      textureSize: 18,
      contigs,
      extensions: new Map<string, Int32Array>([['coverage', cov]]),
    } as unknown as MapData;

    const ratios = computeContigCoverageRatios(map)!;
    expect(ratios).not.toBeNull();
    expect(ratios[4]).toBeCloseTo(0.5, 5);
    for (const i of [0, 1, 2, 3, 5]) expect(ratios[i]).toBeCloseTo(1, 5);
  });

  it('returns null when the map carries no coverage track', () => {
    const map = {
      textureSize: 18,
      contigs: [contig('c0', 0, 3)],
      extensions: new Map<string, Int32Array>(),
    } as unknown as MapData;
    expect(computeContigCoverageRatios(map)).toBeNull();
  });
});

describe('detectHaplotigs', () => {
  // Haplotig (contig 5) has a bright block to its primary (contig 0); confounder
  // (contig 11) has an *identical* bright block to contig 6. The only difference
  // is coverage: the haplotig is at half depth, the confounder is normal. A
  // detector that leans on contact alone cannot separate them.
  const matrix = buildMatrix(SIZE, [
    [15, 18, 0, 3, 200], // contig 5 <-> contig 0
    [33, 36, 18, 21, 200], // contig 11 <-> contig 6
  ]);
  const ranges = makeRanges(N);
  const coverage = new Float32Array(N).fill(1);
  coverage[5] = 0.5; // the haplotig sits near half depth

  it('separates a haplotig from a normal-coverage bright-block confounder', () => {
    const res = detectHaplotigs(matrix, SIZE, ranges, { coverageRatioByOrder: coverage });

    const hap = res.candidates.find((c) => c.orderIndex === 5)!;
    const conf = res.candidates.find((c) => c.orderIndex === 11)!;
    expect(hap).toBeDefined();
    expect(conf).toBeDefined();

    // Same contact signal, opposite verdict: coverage is what decides.
    expect(hap.confidence).toBe('high');
    expect(hap.coverageConfirmed).toBe(true);
    expect(hap.coverageRatio).toBeCloseTo(0.5, 5);
    expect(hap.partnerOrderIndex).toBe(0);

    expect(conf.confidence).toBe('low');
    expect(conf.coverageConfirmed).toBe(false);

    // Contact enrichment is comparable for both; coverage, not contact, split them.
    expect(hap.contactEnrichment).toBeGreaterThan(2);
    expect(Math.abs(hap.contactEnrichment - conf.contactEnrichment)).toBeLessThan(
      0.25 * hap.contactEnrichment,
    );

    // High confidence sorts ahead of the unconfirmed flags.
    expect(res.candidates[0].orderIndex).toBe(5);
    expect(res.candidates[0].confidence).toBe('high');
  });

  it('does not flag plain filler contigs with only baseline contact', () => {
    const res = detectHaplotigs(matrix, SIZE, ranges, { coverageRatioByOrder: coverage });
    expect(res.candidates.some((c) => c.orderIndex === 3)).toBe(false);
    expect(res.candidates.some((c) => c.orderIndex === 9)).toBe(false);
  });

  it('ignores a bright block to a cis-proximal neighbour (not a duplicate signal)', () => {
    // Bright block between adjacent contigs 0 and 1 only; all coverage normal.
    const m = buildMatrix(SIZE, [[0, 3, 3, 6, 200]]);
    const res = detectHaplotigs(m, SIZE, makeRanges(N), {
      coverageRatioByOrder: new Float32Array(N).fill(1),
    });
    expect(res.flaggedCount).toBe(0);
  });

  it('flags coverage-only candidates as medium with no partner', () => {
    const flat = buildMatrix(SIZE, []); // pure baseline, no bright blocks
    const cov = new Float32Array(N).fill(1);
    cov[3] = 0.5;
    const res = detectHaplotigs(flat, SIZE, makeRanges(N), { coverageRatioByOrder: cov });
    const only = res.candidates.find((c) => c.orderIndex === 3)!;
    expect(only).toBeDefined();
    expect(only.confidence).toBe('medium');
    expect(only.partnerOrderIndex).toBe(-1);
    expect(only.coverageConfirmed).toBe(true);
  });

  it('maps emitted candidates back to file order when display order differs', () => {
    // Display order is the reverse of file order.
    const original = Int32Array.from(Array.from({ length: N }, (_, k) => N - 1 - k));
    const res = detectHaplotigs(matrix, SIZE, ranges, {
      coverageRatioByOrder: coverage,
      originalIndexByOrder: original,
    });
    const hap = res.candidates.find((c) => c.orderIndex === 5)!;
    expect(hap.originalIndex).toBe(N - 1 - 5); // original[5]
  });

  it('reports contact-only flags as medium (never high) when no coverage is loaded', () => {
    const res = detectHaplotigs(matrix, SIZE, ranges, { coverageRatioByOrder: null });
    expect(res.coverageAvailable).toBe(false);
    const hap = res.candidates.find((c) => c.orderIndex === 5)!;
    expect(hap.confidence).toBe('medium');
    expect(hap.coverageConfirmed).toBe(false);
    expect(res.candidates.every((c) => c.confidence !== 'high')).toBe(true);
  });
});
