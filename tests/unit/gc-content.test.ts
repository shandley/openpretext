import { describe, it, expect } from 'vitest';
import type { MapData, ContigInfo } from '../../src/core/State';
import { computeBinGC, orientEigenvectorByGC } from '../../src/analysis/GCContent';

function contig(name: string, start: number, end: number): ContigInfo {
  return { name, originalIndex: 0, length: end - start, pixelStart: start, pixelEnd: end, inverted: false, scaffoldId: null };
}
function mapWith(textureSize: number, contigs: ContigInfo[]): MapData {
  return { textureSize, contigs } as unknown as MapData;
}

describe('computeBinGC', () => {
  it('computes per-bin GC in file order from contig sequences', () => {
    // textureSize 100, overview 10. Contig a (bins 0-4) is all G/C; b (bins 5-9) all A/T.
    const contigs = [contig('a', 0, 50), contig('b', 50, 100)];
    const seqs = new Map<string, string>([
      ['a', 'GC'.repeat(50)],
      ['b', 'AT'.repeat(50)],
    ]);
    const gc = computeBinGC(mapWith(100, contigs), seqs, 10);
    expect(gc).toHaveLength(10);
    for (let b = 0; b < 5; b++) expect(gc[b]).toBeCloseTo(1, 5);
    for (let b = 5; b < 10; b++) expect(gc[b]).toBeCloseTo(0, 5);
  });

  it('leaves bins with no matching sequence as NaN', () => {
    const gc = computeBinGC(mapWith(100, [contig('a', 0, 50)]), new Map([['a', 'GCGC']]), 10);
    expect(Number.isNaN(gc[9])).toBe(true); // bins 5-9 have no contig
    expect(gc[0]).toBeCloseTo(1, 5);
  });
});

describe('orientEigenvectorByGC', () => {
  const gc = Float32Array.from([1, 1, 1, 1, 1, 0, 0, 0, 0, 0]); // bins 0-4 high GC

  it('flips so the positive lobe is the higher-GC compartment', () => {
    // Positive lobe (bins 5-9) is low GC -> should flip.
    const e = Float32Array.from([-1, -1, -1, -1, -1, 1, 1, 1, 1, 1]);
    const oriented = orientEigenvectorByGC(e, gc);
    expect(oriented).toBe(true);
    expect(e[0]).toBeGreaterThan(0); // high-GC bin now positive (A)
    expect(e[9]).toBeLessThan(0);
  });

  it('leaves an already-correct eigenvector unchanged', () => {
    const e = Float32Array.from([1, 1, 1, 1, 1, -1, -1, -1, -1, -1]);
    const oriented = orientEigenvectorByGC(e, gc);
    expect(oriented).toBe(true);
    expect(e[0]).toBeGreaterThan(0);
  });

  it('reports not-oriented when GC data is missing', () => {
    const e = Float32Array.from([1, -1, 1, -1]);
    const allNaN = Float32Array.from([NaN, NaN, NaN, NaN]);
    expect(orientEigenvectorByGC(e, allNaN)).toBe(false);
  });
});
