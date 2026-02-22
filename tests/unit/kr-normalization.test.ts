import { describe, it, expect } from 'vitest';
import {
  knightRuiz,
  computeKRNormalization,
  krToTrack,
} from '../../src/analysis/KRNormalization';
import type { KRResult } from '../../src/analysis/KRNormalization';

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

function buildIdentity(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    m[i * size + i] = 1.0;
  }
  return m;
}

/** Build a symmetric matrix from upper-triangular values. */
function symMatrix(size: number, values: number[]): Float32Array {
  const m = new Float32Array(size * size);
  let k = 0;
  for (let i = 0; i < size; i++) {
    for (let j = i; j < size; j++) {
      m[i * size + j] = values[k];
      m[j * size + i] = values[k];
      k++;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// knightRuiz
// ---------------------------------------------------------------------------

describe('knightRuiz', () => {
  it('handles empty matrix', () => {
    const m = new Float32Array(0);
    const result = knightRuiz(m, 0, new Set(), 10, 1e-4);
    expect(result.biasVector.length).toBe(0);
    // With no active bins, maxDev stays 0 so the loop breaks after 1 iteration
    expect(result.iterations).toBe(1);
    expect(result.maxDeviation).toBe(0);
  });

  it('identity matrix is already balanced — converges in 1 iteration', () => {
    const size = 4;
    const m = buildIdentity(size);
    const result = knightRuiz(m, size, new Set(), 200, 1e-6);
    // Each row already sums to 1, so should converge immediately
    expect(result.maxDeviation).toBeLessThan(1e-6);
    expect(result.iterations).toBeLessThanOrEqual(2);
    // Bias vector should be all 1s (no correction needed)
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBeCloseTo(1.0, 4);
    }
  });

  it('converges for uniform matrix', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    const result = knightRuiz(m, size, new Set(), 50, 1e-4);
    expect(result.maxDeviation).toBeLessThan(1e-3);
    // After normalization, rows should sum to ~1
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) s += m[i * size + j];
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('asymmetric-valued matrix — row sums converge to 1', () => {
    // Upper-triangle: [2, 1, 3, 4, 2, 5] for 3x3
    const size = 3;
    const m = symMatrix(size, [2, 1, 3, 4, 2, 5]);
    const result = knightRuiz(m, size, new Set(), 200, 1e-6);
    expect(result.maxDeviation).toBeLessThan(1e-4);
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) s += m[i * size + j];
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('masked bins stay at bias = 1', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    const masked = new Set([0, 2]);
    const result = knightRuiz(m, size, masked, 50, 1e-4);
    expect(result.biasVector[0]).toBe(1.0);
    expect(result.biasVector[2]).toBe(1.0);
  });

  it('respects maxIterations', () => {
    const size = 4;
    const m = buildDiagonalDecay(size);
    const result = knightRuiz(m, size, new Set(), 3, 1e-15);
    expect(result.iterations).toBe(3);
  });

  it('reports correct iteration count', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = knightRuiz(m, size, new Set(), 100, 1e-6);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThanOrEqual(100);
  });

  it('maxDeviation decreases over iterations', () => {
    const size = 8;
    // Run for 2 iterations
    const m1 = buildDiagonalDecay(size);
    const res2 = knightRuiz(m1, size, new Set(), 2, 1e-15);

    // Run for 20 iterations
    const m2 = buildDiagonalDecay(size);
    const res20 = knightRuiz(m2, size, new Set(), 20, 1e-15);

    expect(res20.maxDeviation).toBeLessThan(res2.maxDeviation);
  });

  it('empty masked set — all bins active', () => {
    const size = 4;
    const m = buildDiagonalDecay(size);
    const result = knightRuiz(m, size, new Set(), 50, 1e-4);
    expect(result.maxDeviation).toBeLessThan(1e-3);
    // All bias values should have been modified
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBeGreaterThan(0);
    }
  });

  it('all bins masked — no-op', () => {
    const size = 3;
    const m = buildUniformMap(size, 5);
    const original = Float32Array.from(m);
    const masked = new Set([0, 1, 2]);
    const result = knightRuiz(m, size, masked, 50, 1e-4);
    // Bias vector should remain all 1s
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBe(1.0);
    }
    // Matrix should be unchanged (masked bins are skipped)
    expect(m).toEqual(original);
  });

  it('produces positive bias values for all active bins', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = knightRuiz(m, size, new Set(), 50, 1e-4);
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBeGreaterThan(0);
    }
  });

  it('converges for diagonal-decay matrix', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    const result = knightRuiz(m, size, new Set(), 100, 1e-4);
    expect(result.maxDeviation).toBeLessThan(1e-3);
  });
});

// ---------------------------------------------------------------------------
// computeKRNormalization
// ---------------------------------------------------------------------------

describe('computeKRNormalization', () => {
  it('handles size 0 — returns empty result', () => {
    const result = computeKRNormalization(new Float32Array(0), 0);
    expect(result.biasVector.length).toBe(0);
    expect(result.normalizedMatrix.length).toBe(0);
    expect(result.maskedBins).toHaveLength(0);
    expect(result.iterations).toBe(0);
    expect(result.maxDeviation).toBe(0);
  });

  it('handles 1x1 matrix', () => {
    const result = computeKRNormalization(new Float32Array([5]), 1);
    expect(result.biasVector.length).toBe(1);
    expect(result.normalizedMatrix.length).toBe(1);
  });

  it('normalizes a small symmetric matrix', () => {
    const size = 4;
    const m = symMatrix(size, [4, 2, 1, 0.5, 3, 1, 2, 5, 2, 3]);
    const result = computeKRNormalization(m, size, { sparseFilterQuantile: 0 });
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.biasVector.length).toBe(size);
    expect(result.normalizedMatrix.length).toBe(size * size);
  });

  it('sanitizes NaN/Infinity in input', () => {
    const size = 4;
    const m = buildUniformMap(size, 1);
    m[0] = NaN;
    m[5] = Infinity;
    m[10] = -Infinity;
    const result = computeKRNormalization(m, size, { sparseFilterQuantile: 0 });
    // Should not produce NaN in output
    for (let i = 0; i < result.normalizedMatrix.length; i++) {
      expect(isFinite(result.normalizedMatrix[i])).toBe(true);
    }
    for (let i = 0; i < result.biasVector.length; i++) {
      expect(isFinite(result.biasVector[i])).toBe(true);
    }
  });

  it('respects custom params', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size, {
      maxIterations: 5,
      sparseFilterQuantile: 0,
      epsilon: 1e-15,
    });
    expect(result.iterations).toBeLessThanOrEqual(5);
  });

  it('normalizedMatrix has approximately unit row sums', () => {
    const size = 8;
    const m = buildUniformMap(size, 2);
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) {
        s += result.normalizedMatrix[i * size + j];
      }
      expect(s).toBeCloseTo(1.0, 2);
    }
  });

  it('maskedBins reflects sparse filter quantile', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    // Zero out bin 0 to make it low-coverage
    for (let j = 0; j < size; j++) {
      m[0 * size + j] = 0;
      m[j * size + 0] = 0;
    }
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0.1,
    });
    expect(result.maskedBins).toContain(0);
  });

  it('bias vector is positive for active bins', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    for (let i = 0; i < size; i++) {
      expect(result.biasVector[i]).toBeGreaterThan(0);
    }
  });

  it('output matrix is symmetric', () => {
    const size = 6;
    const m = makeSymmetric(size);
    for (let i = 0; i < size; i++) {
      for (let j = i; j < size; j++) {
        const v = 1.0 / (Math.abs(i - j) + 1);
        setSymmetric(m, size, i, j, v);
      }
    }
    const result = computeKRNormalization(m, size, {
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

  it('zero matrix handled gracefully', () => {
    const size = 4;
    const m = new Float32Array(size * size);
    const result = computeKRNormalization(m, size, { sparseFilterQuantile: 0 });
    // All values should remain zero or finite
    for (let i = 0; i < result.normalizedMatrix.length; i++) {
      expect(isFinite(result.normalizedMatrix[i])).toBe(true);
    }
    for (let i = 0; i < result.biasVector.length; i++) {
      expect(isFinite(result.biasVector[i])).toBe(true);
    }
  });

  it('single element matrix', () => {
    const result = computeKRNormalization(new Float32Array([7]), 1);
    expect(result.biasVector.length).toBe(1);
    expect(result.normalizedMatrix.length).toBe(1);
    expect(isFinite(result.normalizedMatrix[0])).toBe(true);
  });

  it('with sparseFilterQuantile = 0 — no masking', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    expect(result.maskedBins).toHaveLength(0);
  });

  it('result normalizedMatrix differs from input (has been normalized)', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const original = Float32Array.from(m);
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0,
    });
    let differs = false;
    for (let i = 0; i < result.normalizedMatrix.length; i++) {
      if (Math.abs(result.normalizedMatrix[i] - original[i]) > 1e-8) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('does not modify original matrix', () => {
    const size = 4;
    const m = buildUniformMap(size, 3);
    const original = Float32Array.from(m);
    computeKRNormalization(m, size);
    expect(m).toEqual(original);
  });

  it('uses default params when none provided', () => {
    const size = 6;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('masked bins have zero in normalized matrix', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    // Zero out bin 0
    for (let j = 0; j < size; j++) {
      m[0 * size + j] = 0;
      m[j * size + 0] = 0;
    }
    const result = computeKRNormalization(m, size, {
      sparseFilterQuantile: 0.15,
    });
    if (result.maskedBins.includes(0)) {
      for (let j = 0; j < size; j++) {
        expect(result.normalizedMatrix[0 * size + j]).toBe(0);
      }
    }
  });

  it('bias vector has correct length', () => {
    const size = 12;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size);
    expect(result.biasVector.length).toBe(size);
  });

  it('normalizedMatrix has correct length', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    const result = computeKRNormalization(m, size);
    expect(result.normalizedMatrix.length).toBe(size * size);
  });
});

// ---------------------------------------------------------------------------
// krToTrack
// ---------------------------------------------------------------------------

describe('krToTrack', () => {
  it('returns correct track config name "KR Bias"', () => {
    const result = computeKRNormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 8, 16);
    expect(track.name).toBe('KR Bias');
  });

  it('returns correct color #ff7675', () => {
    const result = computeKRNormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 8, 16);
    expect(track.color).toBe('#ff7675');
  });

  it('data length equals textureSize', () => {
    const result = computeKRNormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 8, 32);
    expect(track.data.length).toBe(32);
  });

  it('data values in [0, 1]', () => {
    const result = computeKRNormalization(buildDiagonalDecay(8), 8, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 8, 16);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('type is "line"', () => {
    const result = computeKRNormalization(buildDiagonalDecay(4), 4, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 4, 8);
    expect(track.type).toBe('line');
  });

  it('height is 30', () => {
    const result = computeKRNormalization(buildDiagonalDecay(4), 4, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 4, 8);
    expect(track.height).toBe(30);
  });

  it('handles overviewSize != textureSize scaling', () => {
    const result = computeKRNormalization(buildDiagonalDecay(4), 4, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 4, 100);
    expect(track.data.length).toBe(100);
    // Values should still be in [0, 1]
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('zero bias vector — all zeros', () => {
    const result: KRResult = {
      biasVector: new Float32Array(4),
      normalizedMatrix: new Float32Array(16),
      maskedBins: [],
      iterations: 0,
      maxDeviation: 0,
    };
    const track = krToTrack(result, 4, 8);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBe(0);
    }
  });

  it('visible is true', () => {
    const result = computeKRNormalization(buildDiagonalDecay(4), 4, {
      sparseFilterQuantile: 0,
    });
    const track = krToTrack(result, 4, 8);
    expect(track.visible).toBe(true);
  });
});
