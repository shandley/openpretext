import { describe, it, expect } from 'vitest';
import type { ContigRange } from '../../src/curation/AutoSort';
import { computeJoinSupport } from '../../src/analysis/JoinSupport';

/**
 * Build a size*size symmetric matrix of three 4-bin contigs. Within a contig
 * and across a "correct" join, contact decays with distance; across a "wrong"
 * join it is depleted to zero (the misjoin signature).
 */
function blockMatrix(correctJoins: Set<string>): { matrix: Float32Array; size: number; ranges: ContigRange[] } {
  const size = 12;
  const m = new Float32Array(size * size);
  const decay = (d: number) => Math.max(0, 6 - d);
  const contigOf = (i: number) => Math.floor(i / 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const ci = contigOf(i), cj = contigOf(j);
      const d = Math.abs(i - j);
      let v = 0;
      if (ci === cj) {
        v = decay(d);
      } else if (Math.abs(ci - cj) === 1) {
        const key = `${Math.min(ci, cj)}-${Math.max(ci, cj)}`;
        v = correctJoins.has(key) ? decay(d) : 0;
      }
      m[i * size + j] = v;
    }
  }
  const ranges: ContigRange[] = [
    { start: 0, end: 4, orderIndex: 0 },
    { start: 4, end: 8, orderIndex: 1 },
    { start: 8, end: 12, orderIndex: 2 },
  ];
  return { matrix: m, size, ranges };
}

describe('computeJoinSupport', () => {
  it('flags a wrong join and leaves the correct one alone', () => {
    // Join 0-1 is correct (contact continues); join 1-2 is a misjoin (depleted).
    const { matrix, size, ranges } = blockMatrix(new Set(['0-1']));
    const result = computeJoinSupport(matrix, size, ranges);

    const j01 = result.junctions.find(j => j.orderIndex === 0)!;
    const j12 = result.junctions.find(j => j.orderIndex === 1)!;

    // Correct join scores ~1 and is not flagged; misjoin scores ~0 and is flagged.
    expect(j01.support).toBeGreaterThan(0.9);
    expect(j01.flagged).toBe(false);
    expect(j12.support).toBeLessThan(0.1);
    expect(j12.flagged).toBe(true);
    expect(result.flaggedCount).toBe(1);
  });

  it('flags nothing when every join is well supported', () => {
    const { matrix, size, ranges } = blockMatrix(new Set(['0-1', '1-2']));
    const result = computeJoinSupport(matrix, size, ranges);
    expect(result.junctions.every(j => j.support > 0.9)).toBe(true);
    expect(result.flaggedCount).toBe(0);
  });

  it('marks single-bin junctions low confidence and never flags them', () => {
    // A 1-bin middle contig: the junctions around it can only sample one cell.
    const size = 12;
    const m = new Float32Array(size * size); // all zero (fully depleted)
    const ranges: ContigRange[] = [
      { start: 0, end: 5, orderIndex: 0 },
      { start: 5, end: 6, orderIndex: 1 }, // single bin
      { start: 6, end: 12, orderIndex: 2 },
    ];
    const result = computeJoinSupport(m, size, ranges);
    const lowConf = result.junctions.filter(j => j.confidence === 'low');
    expect(lowConf.length).toBeGreaterThan(0);
    expect(lowConf.every(j => j.flagged === false)).toBe(true);
  });

  it('reports the boundary bin position of each junction', () => {
    const { matrix, size, ranges } = blockMatrix(new Set(['0-1', '1-2']));
    const result = computeJoinSupport(matrix, size, ranges);
    expect(result.junctions.map(j => j.binPosition)).toEqual([4, 8]);
  });

  it('does not score a junction between two different assigned scaffolds', () => {
    // Same depleted 1-2 junction as the misjoin test, but now contigs 1 and 2
    // are in different scaffolds, so the boundary is intentional, not scored.
    const { matrix, size, ranges } = blockMatrix(new Set(['0-1']));
    const scaffoldIds = [1, 1, 2]; // contig 2 is a different chromosome
    const result = computeJoinSupport(matrix, size, ranges, undefined, scaffoldIds);

    // Only the 0-1 junction remains (both in scaffold 1); the 1-2 boundary is skipped.
    expect(result.junctions.map(j => j.orderIndex)).toEqual([0]);
    expect(result.flaggedCount).toBe(0);
  });
});
