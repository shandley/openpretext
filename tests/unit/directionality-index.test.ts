import { describe, it, expect } from 'vitest';
import {
  computeDirectionalityScores,
  normalizeDIScores,
  detectDIBoundaries,
  computeDirectionality,
  directionalityToTracks,
} from '../../src/analysis/DirectionalityIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDiagonalDecay(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      m[i * size + j] = 1.0 / (Math.abs(i - j) + 1);
    }
  }
  return m;
}

function buildUniformMap(size: number, value: number): Float32Array {
  return new Float32Array(size * size).fill(value);
}

/**
 * Build a two-TAD map: strong contacts within [0, mid) and [mid, size),
 * weak contacts between the two blocks.
 */
function buildTwoTadMap(size: number, mid: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const sameBlock = (i < mid && j < mid) || (i >= mid && j >= mid);
      const dist = Math.abs(i - j);
      if (sameBlock) {
        m[i * size + j] = 5.0 / (dist + 1);
      } else {
        m[i * size + j] = 0.1 / (dist + 1);
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// computeDirectionalityScores
// ---------------------------------------------------------------------------

describe('computeDirectionalityScores', () => {
  it('returns zeros for empty matrix', () => {
    const scores = computeDirectionalityScores(new Float32Array(0), 0, 5);
    expect(scores.length).toBe(0);
  });

  it('returns zeros for 1x1 matrix', () => {
    const scores = computeDirectionalityScores(new Float32Array([1]), 1, 5);
    expect(scores[0]).toBe(0);
  });

  it('returns zeros for uniform matrix', () => {
    const size = 10;
    const m = buildUniformMap(size, 1);
    const scores = computeDirectionalityScores(m, size, 5);
    // Interior bins in a uniform matrix should have DI = 0
    for (let i = 5; i < size - 5; i++) {
      expect(scores[i]).toBeCloseTo(0, 4);
    }
  });

  it('returns correct length', () => {
    const size = 20;
    const scores = computeDirectionalityScores(buildDiagonalDecay(size), size, 5);
    expect(scores.length).toBe(size);
  });

  it('edge bins have asymmetric DI', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const scores = computeDirectionalityScores(m, size, 5);
    // First bin: only downstream contacts → positive DI
    expect(scores[0]).toBeGreaterThan(0);
    // Last bin: only upstream contacts → negative DI
    expect(scores[size - 1]).toBeLessThan(0);
  });

  it('detects directional bias at TAD boundary', () => {
    const size = 20;
    const mid = 10;
    const m = buildTwoTadMap(size, mid);
    const scores = computeDirectionalityScores(m, size, 5);
    // Just before boundary: more upstream contacts → negative DI
    expect(scores[mid - 1]).toBeLessThan(0);
    // Just after boundary: more downstream contacts → positive DI
    expect(scores[mid]).toBeGreaterThan(0);
  });

  it('handles window larger than map', () => {
    const size = 4;
    const m = buildDiagonalDecay(size);
    const scores = computeDirectionalityScores(m, size, 100);
    expect(scores.length).toBe(size);
  });
});

// ---------------------------------------------------------------------------
// normalizeDIScores
// ---------------------------------------------------------------------------

describe('normalizeDIScores', () => {
  it('returns empty for empty input', () => {
    expect(normalizeDIScores(new Float32Array(0)).length).toBe(0);
  });

  it('maps zeros to 0.5', () => {
    const result = normalizeDIScores(new Float32Array([0, 0, 0]));
    for (let i = 0; i < 3; i++) {
      expect(result[i]).toBeCloseTo(0.5);
    }
  });

  it('maps positive DI to > 0.5', () => {
    const result = normalizeDIScores(new Float32Array([1, 0, -1]));
    expect(result[0]).toBeGreaterThan(0.5);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeLessThan(0.5);
  });

  it('outputs in [0, 1]', () => {
    const scores = new Float32Array([-10, -5, 0, 5, 10]);
    const result = normalizeDIScores(scores);
    for (let i = 0; i < scores.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(1);
    }
  });

  it('max positive maps to 1.0', () => {
    const result = normalizeDIScores(new Float32Array([3, -1]));
    expect(result[0]).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// detectDIBoundaries
// ---------------------------------------------------------------------------

describe('detectDIBoundaries', () => {
  it('returns empty for empty input', () => {
    const { positions } = detectDIBoundaries(new Float32Array(0), 0);
    expect(positions).toHaveLength(0);
  });

  it('returns empty when no crossings', () => {
    const { positions } = detectDIBoundaries(new Float32Array([1, 2, 3]), 0);
    expect(positions).toHaveLength(0);
  });

  it('detects negative-to-positive crossing', () => {
    const scores = new Float32Array([-2, -1, 1, 2]);
    const { positions, strengths } = detectDIBoundaries(scores, 0);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toBe(2);
    expect(strengths[0]).toBeCloseTo(2); // |1 - (-1)| = 2
  });

  it('detects multiple crossings', () => {
    const scores = new Float32Array([-1, 1, -1, 1]);
    const { positions } = detectDIBoundaries(scores, 0);
    expect(positions).toHaveLength(2);
    expect(positions).toContain(1);
    expect(positions).toContain(3);
  });

  it('respects significance threshold', () => {
    const scores = new Float32Array([-0.5, 0.5, -5, 5]);
    const { positions } = detectDIBoundaries(scores, 1);
    // Only the strong crossing should be detected
    expect(positions).toHaveLength(1);
    expect(positions[0]).toBe(3);
  });

  it('ignores positive-to-negative crossings', () => {
    const scores = new Float32Array([2, -2]);
    const { positions } = detectDIBoundaries(scores, 0);
    expect(positions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeDirectionality
// ---------------------------------------------------------------------------

describe('computeDirectionality', () => {
  it('handles empty matrix', () => {
    const result = computeDirectionality(new Float32Array(0), 0);
    expect(result.diScores.length).toBe(0);
    expect(result.normalizedScores.length).toBe(0);
    expect(result.boundaries).toHaveLength(0);
  });

  it('computes with default params', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const result = computeDirectionality(m, size);
    expect(result.diScores.length).toBe(size);
    expect(result.normalizedScores.length).toBe(size);
  });

  it('detects boundary in two-TAD map', () => {
    const size = 30;
    const mid = 15;
    const m = buildTwoTadMap(size, mid);
    const result = computeDirectionality(m, size, { windowSize: 5 });
    // Should detect at least one boundary near the mid point
    const nearMid = result.boundaries.filter(b => Math.abs(b - mid) <= 2);
    expect(nearMid.length).toBeGreaterThanOrEqual(1);
  });

  it('respects custom windowSize', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const r1 = computeDirectionality(m, size, { windowSize: 3 });
    const r2 = computeDirectionality(m, size, { windowSize: 8 });
    // Different window sizes should produce different scores
    let different = false;
    for (let i = 5; i < size - 5; i++) {
      if (Math.abs(r1.diScores[i] - r2.diScores[i]) > 0.001) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('normalized scores are in [0, 1]', () => {
    const size = 20;
    const m = buildTwoTadMap(size, 10);
    const result = computeDirectionality(m, size, { windowSize: 5 });
    for (let i = 0; i < size; i++) {
      expect(result.normalizedScores[i]).toBeGreaterThanOrEqual(0);
      expect(result.normalizedScores[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// directionalityToTracks
// ---------------------------------------------------------------------------

describe('directionalityToTracks', () => {
  it('returns two tracks', () => {
    const result = computeDirectionality(buildDiagonalDecay(10), 10);
    const { diTrack, diBoundaryTrack } = directionalityToTracks(result, 10, 20);
    expect(diTrack.name).toBe('Directionality Index');
    expect(diTrack.type).toBe('line');
    expect(diTrack.data.length).toBe(20);
    expect(diBoundaryTrack.name).toBe('DI Boundaries');
    expect(diBoundaryTrack.type).toBe('marker');
    expect(diBoundaryTrack.data.length).toBe(20);
  });

  it('track data is in [0, 1]', () => {
    const result = computeDirectionality(buildTwoTadMap(20, 10), 20, { windowSize: 5 });
    const { diTrack } = directionalityToTracks(result, 20, 40);
    for (let i = 0; i < diTrack.data.length; i++) {
      expect(diTrack.data[i]).toBeGreaterThanOrEqual(0);
      expect(diTrack.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('maps boundaries to marker track', () => {
    const result = computeDirectionality(buildTwoTadMap(20, 10), 20, { windowSize: 5 });
    const { diBoundaryTrack } = directionalityToTracks(result, 20, 40);
    // Should have at least one marker
    let hasMarker = false;
    for (let i = 0; i < diBoundaryTrack.data.length; i++) {
      if (diBoundaryTrack.data[i] > 0) hasMarker = true;
    }
    if (result.boundaries.length > 0) {
      expect(hasMarker).toBe(true);
    }
  });
});
