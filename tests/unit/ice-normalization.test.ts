import { describe, it, expect } from 'vitest';
import {
  computeRowSums,
  filterLowCoverageBins,
  sinkhornKnopp,
  computeICENormalization,
  iceToTrack,
} from '../../src/analysis/ICENormalization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSymmetric(size: number, fill = 0): Float32Array {
  return new Float32Array(size * size).fill(fill);
}

function setSymmetric(m: Float32Array, size: number, i: number, j: number, v: number): void {
  m[i * size + j] = v;
  m[j * size + i] = v;
}

function buildUniformMap(size: number, value: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      m[i * size + j] = value;
    }
  }
  return m;
}

function buildDiagonalDecay(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const d = Math.abs(i - j);
      m[i * size + j] = 1.0 / (d + 1);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// computeRowSums
// ---------------------------------------------------------------------------

describe('computeRowSums', () => {
  it('returns zeros for empty matrix', () => {
    const sums = computeRowSums(new Float32Array(0), 0);
    expect(sums.length).toBe(0);
  });

  it('returns correct sums for 1x1', () => {
    const sums = computeRowSums(new Float32Array([5]), 1);
    expect(sums[0]).toBe(5);
  });

  it('returns correct sums for symmetric matrix', () => {
    const m = new Float32Array([1, 2, 2, 3]);
    const sums = computeRowSums(m, 2);
    expect(sums[0]).toBe(3);
    expect(sums[1]).toBe(5);
  });

  it('returns correct sums for uniform matrix', () => {
    const m = buildUniformMap(4, 2);
    const sums = computeRowSums(m, 4);
    for (let i = 0; i < 4; i++) {
      expect(sums[i]).toBe(8);
    }
  });

  it('handles zero matrix', () => {
    const sums = computeRowSums(makeSymmetric(3), 3);
    for (let i = 0; i < 3; i++) {
      expect(sums[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// filterLowCoverageBins
// ---------------------------------------------------------------------------

describe('filterLowCoverageBins', () => {
  it('returns empty for zero quantile', () => {
    const sums = new Float64Array([1, 2, 3, 4]);
    expect(filterLowCoverageBins(sums, 0)).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(filterLowCoverageBins(new Float64Array(0), 0.5)).toHaveLength(0);
  });

  it('filters bottom 25%', () => {
    const sums = new Float64Array([1, 5, 3, 10]);
    const masked = filterLowCoverageBins(sums, 0.25);
    expect(masked).toContain(0);
    expect(masked).not.toContain(3);
  });

  it('filters bottom 50%', () => {
    const sums = new Float64Array([1, 2, 3, 4]);
    const masked = filterLowCoverageBins(sums, 0.5);
    expect(masked.length).toBeGreaterThanOrEqual(2);
  });

  it('handles all equal sums', () => {
    const sums = new Float64Array([5, 5, 5, 5]);
    const masked = filterLowCoverageBins(sums, 0.25);
    // threshold = 5, all bins have sum=5, so they're all <= threshold
    expect(masked.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// sinkhornKnopp
// ---------------------------------------------------------------------------

describe('sinkhornKnopp', () => {
  it('handles empty matrix', () => {
    const m = new Float32Array(0);
    const result = sinkhornKnopp(m, 0, new Set(), 10, 1e-4);
    expect(result.biasVector.length).toBe(0);
  });

  it('converges for uniform matrix', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    const result = sinkhornKnopp(m, size, new Set(), 50, 1e-4);
    expect(result.maxDeviation).toBeLessThan(1e-3);
    // After normalization, rows should sum to ~1
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) s += m[i * size + j];
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('converges for diagonal-decay matrix', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    const result = sinkhornKnopp(m, size, new Set(), 50, 1e-4);
    expect(result.maxDeviation).toBeLessThan(1e-3);
  });

  it('respects masked bins', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    const masked = new Set([0]); // Mask first bin
    const result = sinkhornKnopp(m, size, masked, 50, 1e-4);
    // Bias for masked bin should remain 1
    expect(result.biasVector[0]).toBe(1.0);
    // Other bins should be balanced
    for (let i = 1; i < size; i++) {
      let s = 0;
      for (let j = 1; j < size; j++) s += m[i * size + j];
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('stops at maxIterations', () => {
    const size = 4;
    const m = buildDiagonalDecay(size);
    const result = sinkhornKnopp(m, size, new Set(), 3, 1e-10);
    expect(result.iterations).toBe(3);
  });

  it('produces positive bias values', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = sinkhornKnopp(m, size, new Set(), 50, 1e-4);
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// computeICENormalization
// ---------------------------------------------------------------------------

describe('computeICENormalization', () => {
  it('handles empty matrix', () => {
    const result = computeICENormalization(new Float32Array(0), 0);
    expect(result.biasVector.length).toBe(0);
    expect(result.normalizedMatrix.length).toBe(0);
    expect(result.maskedBins).toHaveLength(0);
    expect(result.iterations).toBe(0);
  });

  it('handles 1x1 matrix', () => {
    const result = computeICENormalization(new Float32Array([5]), 1);
    expect(result.biasVector.length).toBe(1);
    expect(result.normalizedMatrix.length).toBe(1);
  });

  it('normalizes a uniform matrix', () => {
    const size = 8;
    const m = buildUniformMap(size, 2);
    const result = computeICENormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    expect(result.iterations).toBeGreaterThan(0);
    // After normalization rows should sum to ~1
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) {
        s += result.normalizedMatrix[i * size + j];
      }
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('normalizes a diagonal-decay matrix', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    const result = computeICENormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    expect(result.maxDeviation).toBeLessThan(0.01);
    expect(result.biasVector.length).toBe(size);
  });

  it('does not modify original matrix', () => {
    const size = 4;
    const m = buildUniformMap(size, 3);
    const original = Float32Array.from(m);
    computeICENormalization(m, size);
    expect(m).toEqual(original);
  });

  it('returns masked bins for sparse regions', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    // Set first bin to have very low coverage
    for (let j = 0; j < size; j++) {
      m[0 * size + j] = 0;
      m[j * size + 0] = 0;
    }
    const result = computeICENormalization(m, size, {
      sparseFilterQuantile: 0.1,
    });
    expect(result.maskedBins).toContain(0);
  });

  it('uses default params when none provided', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = computeICENormalization(m, size);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('sanitizes NaN values in input matrix', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    m[0] = NaN;
    m[5] = Infinity;
    m[10] = -Infinity;
    const result = computeICENormalization(m, size, { sparseFilterQuantile: 0 });
    // Should not produce NaN in output
    for (let i = 0; i < result.normalizedMatrix.length; i++) {
      expect(isFinite(result.normalizedMatrix[i])).toBe(true);
    }
    for (let i = 0; i < result.biasVector.length; i++) {
      expect(isFinite(result.biasVector[i])).toBe(true);
    }
  });

  it('respects maxIterations param', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    const result = computeICENormalization(m, size, {
      maxIterations: 5,
      sparseFilterQuantile: 0,
      epsilon: 1e-10,
    });
    expect(result.iterations).toBeLessThanOrEqual(5);
  });

  it('bias vector has correct length', () => {
    const size = 12;
    const m = buildDiagonalDecay(size);
    const result = computeICENormalization(m, size);
    expect(result.biasVector.length).toBe(size);
  });

  it('normalized matrix preserves symmetry', () => {
    const size = 6;
    const m = makeSymmetric(size);
    for (let i = 0; i < size; i++) {
      for (let j = i; j < size; j++) {
        const v = 1.0 / (Math.abs(i - j) + 1);
        setSymmetric(m, size, i, j, v);
      }
    }
    const result = computeICENormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        expect(result.normalizedMatrix[i * size + j]).toBeCloseTo(
          result.normalizedMatrix[j * size + i], 4,
        );
      }
    }
  });

  it('masked bins have zero in normalized matrix', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    // Zero out bin 0
    for (let j = 0; j < size; j++) {
      m[0 * size + j] = 0;
      m[j * size + 0] = 0;
    }
    const result = computeICENormalization(m, size, {
      sparseFilterQuantile: 0.15,
    });
    if (result.maskedBins.includes(0)) {
      for (let j = 0; j < size; j++) {
        expect(result.normalizedMatrix[0 * size + j]).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// iceToTrack
// ---------------------------------------------------------------------------

describe('iceToTrack', () => {
  it('returns a line track', () => {
    const result = computeICENormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = iceToTrack(result, 8, 16);
    expect(track.name).toBe('ICE Bias');
    expect(track.type).toBe('line');
    expect(track.data.length).toBe(16);
    expect(track.visible).toBe(true);
  });

  it('normalizes bias values to [0, 1]', () => {
    const result = computeICENormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = iceToTrack(result, 8, 16);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('handles zero bias vector', () => {
    const result: ICEResult = {
      biasVector: new Float32Array(4),
      normalizedMatrix: new Float32Array(16),
      maskedBins: [],
      iterations: 0,
      maxDeviation: 0,
    };
    const track = iceToTrack(result, 4, 8);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBe(0);
    }
  });

  it('maps overview size to texture size', () => {
    const result = computeICENormalization(buildDiagonalDecay(4), 4, {
      sparseFilterQuantile: 0,
    });
    const track = iceToTrack(result, 4, 100);
    expect(track.data.length).toBe(100);
  });
});

// Need to import ICEResult for the type
import type { ICEResult } from '../../src/analysis/ICENormalization';
