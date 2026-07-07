import { describe, it, expect } from 'vitest';
import {
  computeInsulationScores,
  normalizeInsulationScores,
  detectTADBoundaries,
  computeInsulation,
  insulationToTracks,
} from '../../src/analysis/InsulationScore';
import type { ContigRange } from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a uniform contact map where every cell = value. */
function makeUniformMap(size: number, value: number): Float32Array {
  const map = new Float32Array(size * size);
  map.fill(value);
  return map;
}

/** Create an all-zero contact map. */
function makeZeroMap(size: number): Float32Array {
  return new Float32Array(size * size);
}

/**
 * Create a contact map with clear TAD structure.
 * Each TAD block has strong intra-TAD contacts and weak inter-TAD contacts.
 * `tadBounds` defines the start pixel of each TAD: [0, b1, b2, ..., size].
 */
function makeTADMap(
  size: number,
  tadBounds: number[],
  intraValue: number = 0.8,
  interValue: number = 0.05,
): Float32Array {
  const map = new Float32Array(size * size);
  const bounds = [...tadBounds, size];

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // Determine which TAD each position belongs to
      let tadI = 0;
      let tadJ = 0;
      for (let t = 0; t < bounds.length - 1; t++) {
        if (i >= bounds[t] && i < bounds[t + 1]) tadI = t;
        if (j >= bounds[t] && j < bounds[t + 1]) tadJ = t;
      }

      const value = tadI === tadJ ? intraValue : interValue;
      map[i * size + j] = value;
      map[j * size + i] = value;
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// computeInsulationScores
// ---------------------------------------------------------------------------

describe('computeInsulationScores', () => {
  it('returns array of correct length', () => {
    const map = makeUniformMap(32, 0.5);
    const scores = computeInsulationScores(map, 32, 5);
    expect(scores.length).toBe(32);
  });

  it('returns all zeros for a zero map', () => {
    const map = makeZeroMap(32);
    const scores = computeInsulationScores(map, 32, 5);
    for (let i = 0; i < scores.length; i++) {
      expect(scores[i]).toBe(0);
    }
  });

  it('returns non-zero interior scores for a uniform non-zero map', () => {
    const map = makeUniformMap(32, 0.5);
    const scores = computeInsulationScores(map, 32, 5);
    // Interior positions (away from edges) should have non-zero scores
    expect(scores[16]).toBeGreaterThan(0);
  });

  it('edge positions have zero or lower scores due to clamped windows', () => {
    const map = makeUniformMap(32, 0.5);
    const scores = computeInsulationScores(map, 32, 5);
    // Position 0 has no upstream region, so score should be 0
    expect(scores[0]).toBe(0);
    // For a uniform map, all non-edge scores are the same (0.5);
    // but position 0 is strictly zero because no upstream window exists
    expect(scores[16]).toBeGreaterThan(scores[0]);
  });

  it('scores are higher inside TADs than at boundaries', () => {
    const map = makeTADMap(64, [0, 32], 0.8, 0.05);
    const scores = computeInsulationScores(map, 64, 8);
    // Inside TAD1 at position 16 should be high
    const insideTAD = scores[16];
    // At boundary position 32 should be lower
    const atBoundary = scores[32];
    expect(insideTAD).toBeGreaterThan(atBoundary);
  });

  it('handles window size 1', () => {
    const map = makeUniformMap(16, 0.5);
    const scores = computeInsulationScores(map, 16, 1);
    expect(scores.length).toBe(16);
    // With window=1, each position samples only one off-diagonal cell
    // Position 0 has no upstream, so score = 0
    expect(scores[0]).toBe(0);
  });

  it('handles size 0', () => {
    const map = new Float32Array(0);
    const scores = computeInsulationScores(map, 0, 5);
    expect(scores.length).toBe(0);
  });

  it('handles size 1', () => {
    const map = new Float32Array([1]);
    const scores = computeInsulationScores(map, 1, 5);
    expect(scores.length).toBe(1);
    expect(scores[0]).toBe(0);
  });

  it('clamps window size to half the map', () => {
    const map = makeUniformMap(10, 0.5);
    // Window size 100 is larger than the map; should not throw
    const scores = computeInsulationScores(map, 10, 100);
    expect(scores.length).toBe(10);
    expect(scores[5]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeInsulationScores
// ---------------------------------------------------------------------------

describe('normalizeInsulationScores', () => {
  it('returns values in [0, 1]', () => {
    const raw = new Float64Array([0.1, 0.5, 0.3, 0.8, 0.2]);
    const norm = normalizeInsulationScores(raw);
    for (let i = 0; i < norm.length; i++) {
      expect(norm[i]).toBeGreaterThanOrEqual(0);
      expect(norm[i]).toBeLessThanOrEqual(1);
    }
  });

  it('min value maps to 0, max maps to 1', () => {
    const raw = new Float64Array([0.1, 0.5, 0.3, 0.8, 0.2]);
    const norm = normalizeInsulationScores(raw);
    const minIdx = 0; // 0.1 is the smallest
    const maxIdx = 3; // 0.8 is the largest
    expect(norm[minIdx]).toBeCloseTo(0, 5);
    expect(norm[maxIdx]).toBeCloseTo(1, 5);
  });

  it('handles all-zero input without NaN', () => {
    const raw = new Float64Array(10);
    const norm = normalizeInsulationScores(raw);
    for (let i = 0; i < norm.length; i++) {
      expect(Number.isNaN(norm[i])).toBe(false);
    }
  });

  it('handles all-equal input', () => {
    const raw = new Float64Array([0.5, 0.5, 0.5, 0.5]);
    const norm = normalizeInsulationScores(raw);
    // All equal after log transform → range = 0 → all zeros
    for (let i = 0; i < norm.length; i++) {
      expect(norm[i]).toBe(0);
    }
  });

  it('handles empty input', () => {
    const raw = new Float64Array(0);
    const norm = normalizeInsulationScores(raw);
    expect(norm.length).toBe(0);
  });

  it('preserves relative ordering', () => {
    const raw = new Float64Array([0.1, 0.5, 0.3]);
    const norm = normalizeInsulationScores(raw);
    // 0.1 < 0.3 < 0.5 → after log → order preserved
    expect(norm[0]).toBeLessThan(norm[2]);
    expect(norm[2]).toBeLessThan(norm[1]);
  });
});

// ---------------------------------------------------------------------------
// detectTADBoundaries
// ---------------------------------------------------------------------------

describe('detectTADBoundaries', () => {
  it('returns no boundaries for uniform signal', () => {
    const scores = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
    const { positions } = detectTADBoundaries(scores, 0.1, 3);
    expect(positions.length).toBe(0);
  });

  it('detects a single boundary at a known dip', () => {
    // Scores: high, high, low, high, high
    const scores = new Float32Array([0.8, 0.8, 0.2, 0.8, 0.8]);
    const { positions, strengths } = detectTADBoundaries(scores, 0.1, 3);
    expect(positions).toContain(2);
    expect(strengths.length).toBe(positions.length);
    expect(strengths[0]).toBeGreaterThan(0);
  });

  it('detects multiple boundaries in multi-TAD data', () => {
    // Two dips at positions 4 and 9
    const scores = new Float32Array([
      0.8, 0.8, 0.8, 0.8, 0.2, 0.8, 0.8, 0.8, 0.8, 0.2, 0.8, 0.8, 0.8,
    ]);
    const { positions } = detectTADBoundaries(scores, 0.1, 5);
    expect(positions).toContain(4);
    expect(positions).toContain(9);
  });

  it('filters weak boundaries below prominence threshold', () => {
    // Weak dip at position 2 (prominence < 0.3)
    const scores = new Float32Array([0.5, 0.5, 0.4, 0.5, 0.5]);
    const { positions } = detectTADBoundaries(scores, 0.3, 3);
    expect(positions.length).toBe(0);
  });

  it('does not return edge positions as boundaries', () => {
    const scores = new Float32Array([0.1, 0.5, 0.5, 0.5, 0.1]);
    const { positions } = detectTADBoundaries(scores, 0.01, 5);
    expect(positions).not.toContain(0);
    expect(positions).not.toContain(4);
  });

  it('boundary strengths are positive', () => {
    const scores = new Float32Array([0.8, 0.8, 0.2, 0.8, 0.8]);
    const { strengths } = detectTADBoundaries(scores, 0.01, 3);
    for (const s of strengths) {
      expect(s).toBeGreaterThan(0);
    }
  });

  it('handles input shorter than 3', () => {
    const { positions } = detectTADBoundaries(new Float32Array([0.5, 0.2]), 0.1, 3);
    expect(positions.length).toBe(0);
  });

  it('handles empty input', () => {
    const { positions } = detectTADBoundaries(new Float32Array(0), 0.1, 3);
    expect(positions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeInsulation (integration)
// ---------------------------------------------------------------------------

describe('computeInsulation', () => {
  it('returns all four result fields', () => {
    const map = makeTADMap(64, [0, 32], 0.8, 0.05);
    const result = computeInsulation(map, 64);
    expect(result.rawScores.length).toBe(64);
    expect(result.normalizedScores.length).toBe(64);
    expect(Array.isArray(result.boundaries)).toBe(true);
    expect(Array.isArray(result.boundaryStrengths)).toBe(true);
    expect(result.boundaries.length).toBe(result.boundaryStrengths.length);
  });

  it('detects boundaries near TAD edges in synthetic data', () => {
    // Two TADs: [0,32) and [32,64)
    const map = makeTADMap(64, [0, 32], 0.8, 0.02);
    const result = computeInsulation(map, 64, { windowSize: 8, boundaryProminence: 0.05 });
    // Should find a boundary near position 32
    const nearBoundary = result.boundaries.filter(b => Math.abs(b - 32) < 6);
    expect(nearBoundary.length).toBeGreaterThan(0);
  });

  it('finds more boundaries with lower prominence threshold', () => {
    const map = makeTADMap(128, [0, 32, 64, 96], 0.8, 0.05);
    const strict = computeInsulation(map, 128, { windowSize: 8, boundaryProminence: 0.3 });
    const lenient = computeInsulation(map, 128, { windowSize: 8, boundaryProminence: 0.01 });
    expect(lenient.boundaries.length).toBeGreaterThanOrEqual(strict.boundaries.length);
  });

  it('respects custom window size', () => {
    const map = makeTADMap(64, [0, 32], 0.8, 0.05);
    const small = computeInsulation(map, 64, { windowSize: 3 });
    const large = computeInsulation(map, 64, { windowSize: 20 });
    // Both should produce valid results
    expect(small.rawScores.length).toBe(64);
    expect(large.rawScores.length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// insulationToTracks
// ---------------------------------------------------------------------------

describe('insulationToTracks', () => {
  it('produces tracks with correct names and types', () => {
    const result = computeInsulation(makeTADMap(32, [0, 16], 0.8, 0.05), 32);
    const { insulationTrack, boundaryTrack } = insulationToTracks(result, 32, 1024);
    expect(insulationTrack.name).toBe('Insulation Score');
    expect(insulationTrack.type).toBe('line');
    expect(boundaryTrack.name).toBe('TAD Boundaries');
    expect(boundaryTrack.type).toBe('marker');
  });

  it('track data length equals textureSize', () => {
    const result = computeInsulation(makeTADMap(32, [0, 16], 0.8, 0.05), 32);
    const { insulationTrack, boundaryTrack } = insulationToTracks(result, 32, 1024);
    expect(insulationTrack.data.length).toBe(1024);
    expect(boundaryTrack.data.length).toBe(1024);
  });

  it('insulation track data is in [0, 1]', () => {
    const result = computeInsulation(makeTADMap(32, [0, 16], 0.8, 0.05), 32);
    const { insulationTrack } = insulationToTracks(result, 32, 1024);
    for (let i = 0; i < insulationTrack.data.length; i++) {
      expect(insulationTrack.data[i]).toBeGreaterThanOrEqual(0);
      expect(insulationTrack.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('boundary track has nonzero values at boundary positions', () => {
    const map = makeTADMap(64, [0, 32], 0.8, 0.02);
    const result = computeInsulation(map, 64, { windowSize: 8, boundaryProminence: 0.05 });
    const { boundaryTrack } = insulationToTracks(result, 64, 1024);
    // Should have at least one nonzero marker
    let hasMarker = false;
    for (let i = 0; i < boundaryTrack.data.length; i++) {
      if (boundaryTrack.data[i] > 0) hasMarker = true;
    }
    expect(hasMarker).toBe(true);
  });

  it('tracks are visible by default', () => {
    const result = computeInsulation(makeTADMap(32, [0, 16], 0.8, 0.05), 32);
    const { insulationTrack, boundaryTrack } = insulationToTracks(result, 32, 512);
    expect(insulationTrack.visible).toBe(true);
    expect(boundaryTrack.visible).toBe(true);
  });
});

describe('normalizeInsulationScores — empty-window outlier regression', () => {
  it('an empty/zero window does not compress the real range to a sliver', () => {
    // rawScores[0] = 0 stands in for position 0's always-empty window. A fixed
    // 1e-10 epsilon sends it to log2 ≈ -33.2, which becomes the min-max floor
    // and crushes the real 0.5..0.6 variation into a band ~0.008 wide near 1.0.
    const raw = new Float64Array([0, 0.5, 0.6, 0.55, 0.5]);
    const norm = normalizeInsulationScores(raw);
    const positives = [norm[1], norm[2], norm[3], norm[4]];
    const spread = Math.max(...positives) - Math.min(...positives);
    expect(spread).toBeGreaterThan(0.3);
  });

  it('a real TAD boundary is detected, not hidden by the outlier', () => {
    const map = makeTADMap(48, [0, 24], 0.8, 0.05);
    const result = computeInsulation(map, 48);
    expect(result.boundaries.some((b) => Math.abs(b - 24) <= 3)).toBe(true);
  });
});

describe('computeInsulation — contig-awareness regression', () => {
  it('does not manufacture a TAD boundary at a contig junction when given ranges', () => {
    // Two contigs, strong intra-contig signal, zero inter-contig. Without ranges,
    // windows straddle the junction and average in the zero inter-contig cells,
    // producing a false boundary there. With ranges, near-junction positions are
    // not measurable (NaN) and no false boundary is reported.
    const size = 40;
    // Faint (0.05) inter-contig floor so the junction is a smooth detectable
    // dip, not an exactly-zero one that the log-floor flattens.
    const map = new Float32Array(size * size).fill(0.05);
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) map[i * size + j] = 1;
    for (let i = 20; i < 40; i++) for (let j = 20; j < 40; j++) map[i * size + j] = 1;
    const ranges: ContigRange[] = [
      { start: 0, end: 20, orderIndex: 0 },
      { start: 20, end: 40, orderIndex: 1 },
    ];
    const nearJunction = (b: number) => Math.abs(b - 20) <= 3;
    const without = computeInsulation(map, size, { windowSize: 6 });
    const withRanges = computeInsulation(map, size, { windowSize: 6 }, ranges);
    expect(without.boundaries.some(nearJunction)).toBe(true);
    expect(withRanges.boundaries.some(nearJunction)).toBe(false);
  });

  it('marks a contig shorter than 2*w as not-measurable (NaN)', () => {
    const size = 20;
    const map = new Float32Array(size * size).fill(1);
    const ranges: ContigRange[] = [
      { start: 0, end: 8, orderIndex: 0 },
      { start: 8, end: 20, orderIndex: 1 },
    ];
    const raw = computeInsulationScores(map, size, 6, ranges);
    for (let p = 0; p < 8; p++) expect(Number.isNaN(raw[p])).toBe(true);
  });
});
