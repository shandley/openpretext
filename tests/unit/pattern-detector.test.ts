import { describe, it, expect } from 'vitest';
import { detectInversions, detectTranslocations } from '../../src/analysis/PatternDetector';
import type { ContigRange } from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContactMap(size: number): Float32Array {
  return new Float32Array(size * size);
}

function setContact(map: Float32Array, size: number, i: number, j: number, value: number): void {
  map[i * size + j] = value;
  map[j * size + i] = value; // symmetric
}

function makeRanges(specs: [number, number][]): ContigRange[] {
  return specs.map(([start, end], i) => ({ start, end, orderIndex: i }));
}

// ---------------------------------------------------------------------------
// detectInversions
// ---------------------------------------------------------------------------

describe('detectInversions', () => {
  it('detects no inversions in empty map', () => {
    const map = makeContactMap(20);
    const ranges = makeRanges([[0, 20]]);
    const result = detectInversions(map, 20, ranges);
    expect(result).toHaveLength(0);
  });

  it('detects no inversions when only diagonal signal exists', () => {
    const size = 20;
    const map = makeContactMap(size);
    // Strong diagonal within contig [0, 20)
    for (let d = 1; d < 10; d++) {
      for (let i = 0; i < size - d; i++) {
        setContact(map, size, i, i + d, 1.0 / d);
      }
    }
    const ranges = makeRanges([[0, 20]]);
    const result = detectInversions(map, size, ranges);
    expect(result).toHaveLength(0);
  });

  it('detects inversion when anti-diagonal signal is elevated', () => {
    const size = 20;
    const map = makeContactMap(size);
    // Weak distance-dependent background at large distances
    for (let d = 7; d < 20; d++) {
      for (let i = 0; i < size - d; i++) {
        setContact(map, size, i, i + d, 0.01);
      }
    }
    // Strong anti-diagonal signal: j = 19 - i, at large distances
    for (let i = 0; i < size; i++) {
      const j = size - 1 - i;
      if (j > i && (j - i) >= 7) {
        setContact(map, size, i, j, 2.0);
      }
    }
    const ranges = makeRanges([[0, 20]]);
    const result = detectInversions(map, size, ranges, 2.0);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('inversion');
    expect(result[0].strength).toBeGreaterThan(0);
  });

  it('skips tiny contigs (span < 4)', () => {
    const size = 10;
    const map = makeContactMap(size);
    const ranges = makeRanges([[0, 3], [3, 10]]);
    const result = detectInversions(map, size, ranges);
    // Contig [0,3) is too small
    expect(result).toHaveLength(0);
  });

  it('handles multiple contigs independently', () => {
    const size = 40;
    const map = makeContactMap(size);
    // Add weak background at large distances in both contigs
    for (let d = 7; d < 20; d++) {
      for (let i = 0; i < 20 - d; i++) setContact(map, size, i, i + d, 0.01);
      for (let i = 20; i < 40 - d; i++) setContact(map, size, i, i + d, 0.01);
    }
    // Add strong anti-diagonal to first contig only (at large distance)
    for (let i = 0; i < 20; i++) {
      const j = 19 - i;
      if (j > i && (j - i) >= 7) {
        setContact(map, size, i, j, 2.0);
      }
    }
    const ranges = makeRanges([[0, 20], [20, 40]]);
    const result = detectInversions(map, size, ranges, 2.0);
    // Only first contig should be flagged
    const firstContig = result.filter(p => p.region.startBin === 0);
    expect(firstContig.length).toBeGreaterThanOrEqual(1);
  });

  it('returns strength between 0 and 1', () => {
    const size = 20;
    const map = makeContactMap(size);
    // Weak background at large distance
    for (let d = 7; d < 20; d++) {
      for (let i = 0; i < size - d; i++) setContact(map, size, i, i + d, 0.01);
    }
    // Very strong anti-diagonal at large distance
    for (let i = 0; i < size; i++) {
      const j = size - 1 - i;
      if (j > i && (j - i) >= 7) setContact(map, size, i, j, 5.0);
    }
    const ranges = makeRanges([[0, 20]]);
    const result = detectInversions(map, size, ranges, 2.0);
    if (result.length > 0) {
      expect(result[0].strength).toBeGreaterThanOrEqual(0);
      expect(result[0].strength).toBeLessThanOrEqual(1);
    }
  });

  it('respects custom threshold', () => {
    const size = 20;
    const map = makeContactMap(size);
    // Weak background at large distance
    for (let d = 7; d < 20; d++) {
      for (let i = 0; i < size - d; i++) setContact(map, size, i, i + d, 0.01);
    }
    // Moderate anti-diagonal at large distance
    for (let i = 0; i < size; i++) {
      const j = size - 1 - i;
      if (j > i && (j - i) >= 7) setContact(map, size, i, j, 0.5);
    }
    const ranges = makeRanges([[0, 20]]);
    // With high threshold should get fewer results
    const lowThreshold = detectInversions(map, size, ranges, 1.5);
    const highThreshold = detectInversions(map, size, ranges, 50);
    expect(highThreshold.length).toBeLessThanOrEqual(lowThreshold.length);
  });
});

// ---------------------------------------------------------------------------
// detectTranslocations
// ---------------------------------------------------------------------------

describe('detectTranslocations', () => {
  it('detects no translocations with < 3 contigs', () => {
    const size = 20;
    const map = makeContactMap(size);
    const ranges = makeRanges([[0, 10], [10, 20]]);
    const result = detectTranslocations(map, size, ranges);
    expect(result).toHaveLength(0);
  });

  it('detects no translocations in empty map', () => {
    const size = 30;
    const map = makeContactMap(size);
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const result = detectTranslocations(map, size, ranges);
    expect(result).toHaveLength(0);
  });

  it('detects translocation with enriched off-diagonal block', () => {
    const size = 30;
    const map = makeContactMap(size);
    // Weak background everywhere
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        setContact(map, size, i, j, 0.01);
      }
    }
    // Strong enrichment between contig 0 [0,10) and contig 2 [20,30)
    for (let i = 0; i < 10; i++) {
      for (let j = 20; j < 30; j++) {
        setContact(map, size, i, j, 1.0);
      }
    }
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const result = detectTranslocations(map, size, ranges, 2.0);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('translocation');
    expect(result[0].region2).toBeDefined();
  });

  it('skips adjacent contigs', () => {
    const size = 30;
    const map = makeContactMap(size);
    // Strong enrichment between adjacent contigs 0 and 1
    for (let i = 0; i < 10; i++) {
      for (let j = 10; j < 20; j++) {
        setContact(map, size, i, j, 1.0);
      }
    }
    // Weak background
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        if (map[i * size + j] === 0) setContact(map, size, i, j, 0.01);
      }
    }
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const result = detectTranslocations(map, size, ranges, 2.0);
    // Adjacent pairs should be skipped (only checking a+2 and beyond)
    const adjacentPairs = result.filter(
      p => p.region.endBin === 10 && p.region2?.startBin === 10,
    );
    expect(adjacentPairs).toHaveLength(0);
  });

  it('sorts results by strength descending', () => {
    const size = 40;
    const map = makeContactMap(size);
    // Background
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        setContact(map, size, i, j, 0.01);
      }
    }
    // Moderate enrichment between contigs 0 and 2
    for (let i = 0; i < 10; i++) {
      for (let j = 20; j < 30; j++) {
        setContact(map, size, i, j, 0.5);
      }
    }
    // Strong enrichment between contigs 0 and 3
    for (let i = 0; i < 10; i++) {
      for (let j = 30; j < 40; j++) {
        setContact(map, size, i, j, 2.0);
      }
    }
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30], [30, 40]]);
    const result = detectTranslocations(map, size, ranges, 1.5);
    if (result.length >= 2) {
      expect(result[0].strength).toBeGreaterThanOrEqual(result[1].strength);
    }
  });

  it('returns strength between 0 and 1', () => {
    const size = 30;
    const map = makeContactMap(size);
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        setContact(map, size, i, j, 0.01);
      }
    }
    for (let i = 0; i < 10; i++) {
      for (let j = 20; j < 30; j++) {
        setContact(map, size, i, j, 1.0);
      }
    }
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const result = detectTranslocations(map, size, ranges, 2.0);
    for (const p of result) {
      expect(p.strength).toBeGreaterThanOrEqual(0);
      expect(p.strength).toBeLessThanOrEqual(1);
    }
  });

  it('handles empty contig ranges', () => {
    const size = 20;
    const map = makeContactMap(size);
    const result = detectTranslocations(map, size, []);
    expect(result).toHaveLength(0);
  });
});
