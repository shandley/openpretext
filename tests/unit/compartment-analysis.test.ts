import { describe, it, expect } from 'vitest';
import {
  binMatrix,
  computeExpectedContacts,
  computeOEMatrix,
  computeCorrelationMatrix,
  powerIteration,
  computeCompartments,
  compartmentToTrack,
} from '../../src/analysis/CompartmentAnalysis';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Uniform contact map. */
function makeUniformMap(size: number, value: number): Float32Array {
  const map = new Float32Array(size * size);
  map.fill(value);
  return map;
}

/**
 * Create a checkerboard contact map that mimics A/B compartments.
 * Blocks on the same compartment have high contacts, different have low.
 * blockSize determines compartment alternation period.
 */
function makeCheckerboardMap(
  size: number,
  blockSize: number,
  sameValue: number = 0.8,
  diffValue: number = 0.1,
): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const blockI = Math.floor(i / blockSize) % 2;
      const blockJ = Math.floor(j / blockSize) % 2;
      const value = blockI === blockJ ? sameValue : diffValue;
      map[i * size + j] = value;
    }
  }
  return map;
}

/** Identity-like matrix for power iteration tests. */
function makeIdentityMatrix(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    m[i * size + i] = 1.0;
  }
  return m;
}

/** Known 2x2 symmetric matrix with known eigenvector. */
function makeKnown2x2(): Float32Array {
  // [[3, 1], [1, 3]] has eigenvectors [1,1] (eigenvalue 4) and [1,-1] (eigenvalue 2)
  return new Float32Array([3, 1, 1, 3]);
}

// ---------------------------------------------------------------------------
// binMatrix
// ---------------------------------------------------------------------------

describe('binMatrix', () => {
  it('binSize=1 returns identical matrix', () => {
    const m = makeUniformMap(4, 0.5);
    const { binnedMatrix, binnedSize } = binMatrix(m, 4, 1);
    expect(binnedSize).toBe(4);
    expect(binnedMatrix.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(binnedMatrix[i]).toBeCloseTo(0.5, 5);
    }
  });

  it('binSize=2 halves dimensions', () => {
    const m = makeUniformMap(8, 1.0);
    const { binnedMatrix, binnedSize } = binMatrix(m, 8, 2);
    expect(binnedSize).toBe(4);
    expect(binnedMatrix.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(binnedMatrix[i]).toBeCloseTo(1.0, 5);
    }
  });

  it('non-divisible size is handled correctly', () => {
    const m = makeUniformMap(7, 1.0);
    const { binnedMatrix, binnedSize } = binMatrix(m, 7, 4);
    // ceil(7/4) = 2
    expect(binnedSize).toBe(2);
    expect(binnedMatrix.length).toBe(4);
  });

  it('binned values are averages of source cells', () => {
    // 4x4 matrix with distinct values
    const m = new Float32Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);
    const { binnedMatrix, binnedSize } = binMatrix(m, 4, 2);
    expect(binnedSize).toBe(2);
    // Top-left 2x2 block: mean(1,2,5,6) = 3.5
    expect(binnedMatrix[0]).toBeCloseTo(3.5, 5);
    // Top-right 2x2 block: mean(3,4,7,8) = 5.5
    expect(binnedMatrix[1]).toBeCloseTo(5.5, 5);
    // Bottom-left: mean(9,10,13,14) = 11.5
    expect(binnedMatrix[2]).toBeCloseTo(11.5, 5);
    // Bottom-right: mean(11,12,15,16) = 13.5
    expect(binnedMatrix[3]).toBeCloseTo(13.5, 5);
  });
});

// ---------------------------------------------------------------------------
// computeExpectedContacts
// ---------------------------------------------------------------------------

describe('computeExpectedContacts', () => {
  it('returns correct length', () => {
    const m = makeUniformMap(8, 0.5);
    const expected = computeExpectedContacts(m, 8);
    expect(expected.length).toBe(8);
  });

  it('expected[0] is the mean diagonal value', () => {
    // Diagonal of a uniform map: all 0.5
    const m = makeUniformMap(8, 0.5);
    const expected = computeExpectedContacts(m, 8);
    expect(expected[0]).toBeCloseTo(0.5, 5);
  });

  it('expected values are equal for uniform map', () => {
    const m = makeUniformMap(8, 0.5);
    const expected = computeExpectedContacts(m, 8);
    for (let d = 0; d < 8; d++) {
      expect(expected[d]).toBeCloseTo(0.5, 5);
    }
  });

  it('all-zero map returns all-zero expected', () => {
    const m = new Float32Array(16);
    const expected = computeExpectedContacts(m, 4);
    for (let d = 0; d < 4; d++) {
      expect(expected[d]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// computeOEMatrix
// ---------------------------------------------------------------------------

describe('computeOEMatrix', () => {
  it('output is same size as input', () => {
    const m = makeUniformMap(4, 0.5);
    const expected = computeExpectedContacts(m, 4);
    const oe = computeOEMatrix(m, 4, expected);
    expect(oe.length).toBe(16);
  });

  it('uniform map with uniform expected produces all-ones', () => {
    const m = makeUniformMap(4, 0.5);
    const expected = computeExpectedContacts(m, 4);
    const oe = computeOEMatrix(m, 4, expected);
    for (let i = 0; i < 16; i++) {
      expect(oe[i]).toBeCloseTo(1.0, 5);
    }
  });

  it('zero expected produces zero O/E', () => {
    const m = makeUniformMap(4, 0.5);
    const expected = new Float64Array(4); // all zeros
    const oe = computeOEMatrix(m, 4, expected);
    for (let i = 0; i < 16; i++) {
      expect(oe[i]).toBe(0);
    }
  });

  it('correctly computes O/E ratios', () => {
    // 2x2 matrix [[4, 2], [2, 4]], expected[0]=4, expected[1]=2
    const m = new Float32Array([4, 2, 2, 4]);
    const expected = new Float64Array([4, 2]);
    const oe = computeOEMatrix(m, 2, expected);
    expect(oe[0]).toBeCloseTo(1.0, 5); // 4/4
    expect(oe[1]).toBeCloseTo(1.0, 5); // 2/2
    expect(oe[2]).toBeCloseTo(1.0, 5); // 2/2
    expect(oe[3]).toBeCloseTo(1.0, 5); // 4/4
  });
});

// ---------------------------------------------------------------------------
// computeCorrelationMatrix
// ---------------------------------------------------------------------------

describe('computeCorrelationMatrix', () => {
  it('diagonal is all 1.0', () => {
    const m = makeCheckerboardMap(8, 4);
    const corr = computeCorrelationMatrix(m, 8);
    for (let i = 0; i < 8; i++) {
      expect(corr[i * 8 + i]).toBeCloseTo(1.0, 5);
    }
  });

  it('is symmetric', () => {
    const m = makeCheckerboardMap(8, 4);
    const corr = computeCorrelationMatrix(m, 8);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        expect(corr[i * 8 + j]).toBeCloseTo(corr[j * 8 + i], 5);
      }
    }
  });

  it('identical rows produce correlation 1.0', () => {
    // Matrix where all rows are the same
    const m = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      m[i * 4 + 0] = 1;
      m[i * 4 + 1] = 2;
      m[i * 4 + 2] = 3;
      m[i * 4 + 3] = 4;
    }
    const corr = computeCorrelationMatrix(m, 4);
    // All pairs should be 1.0
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(corr[i * 4 + j]).toBeCloseTo(1.0, 4);
      }
    }
  });

  it('zero-variance rows produce correlation 0', () => {
    // Row 0 is constant, rows 1-3 are not
    const m = new Float32Array([
      5, 5, 5, 5,
      1, 2, 3, 4,
      4, 3, 2, 1,
      1, 2, 3, 4,
    ]);
    const corr = computeCorrelationMatrix(m, 4);
    // Row 0 with any other row should be 0
    expect(corr[0 * 4 + 1]).toBeCloseTo(0, 5);
    expect(corr[0 * 4 + 2]).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// powerIteration
// ---------------------------------------------------------------------------

describe('powerIteration', () => {
  it('converges on known 2x2 matrix', () => {
    const m = makeKnown2x2();
    const { eigenvector, eigenvalue } = powerIteration(m, 2, 100, 1e-8);
    // Initial vector [1, -1] aligns with the [1,-1] eigenvector (eigenvalue 2).
    // Power iteration finds whichever eigenvector the initial vector is closest to.
    expect(eigenvalue).toBeCloseTo(2, 1);
    // Components should have opposite signs and similar magnitude
    expect(eigenvector[0] * eigenvector[1]).toBeLessThan(0);
    expect(Math.abs(eigenvector[0])).toBeCloseTo(Math.abs(eigenvector[1]), 2);
  });

  it('respects maxIterations limit', () => {
    const m = makeKnown2x2();
    const { iterations } = powerIteration(m, 2, 3, 1e-20);
    expect(iterations).toBeLessThanOrEqual(3);
  });

  it('returns positive eigenvalue for positive-definite matrix', () => {
    const m = makeKnown2x2();
    const { eigenvalue } = powerIteration(m, 2, 100, 1e-8);
    expect(eigenvalue).toBeGreaterThan(0);
  });

  it('handles size 0', () => {
    const m = new Float32Array(0);
    const { eigenvector, eigenvalue, iterations } = powerIteration(m, 0, 100, 1e-6);
    expect(eigenvector.length).toBe(0);
    expect(eigenvalue).toBe(0);
    expect(iterations).toBe(0);
  });

  it('eigenvector is unit length', () => {
    const m = makeKnown2x2();
    const { eigenvector } = powerIteration(m, 2, 100, 1e-8);
    let norm = 0;
    for (let i = 0; i < eigenvector.length; i++) {
      norm += eigenvector[i] * eigenvector[i];
    }
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// computeCompartments (integration)
// ---------------------------------------------------------------------------

describe('computeCompartments', () => {
  it('returns eigenvector of correct length', () => {
    const map = makeCheckerboardMap(32, 8);
    const result = computeCompartments(map, 32);
    expect(result.eigenvector.length).toBe(32);
    expect(result.normalizedEigenvector.length).toBe(32);
  });

  it('normalized eigenvector is in [0, 1]', () => {
    const map = makeCheckerboardMap(32, 8);
    const result = computeCompartments(map, 32);
    for (let i = 0; i < result.normalizedEigenvector.length; i++) {
      expect(result.normalizedEigenvector[i]).toBeGreaterThanOrEqual(0);
      expect(result.normalizedEigenvector[i]).toBeLessThanOrEqual(1);
    }
  });

  it('detects alternating pattern in checkerboard map', () => {
    const map = makeCheckerboardMap(32, 8);
    const result = computeCompartments(map, 32, { binSize: 1 });
    // The eigenvector should alternate sign between blocks of 8
    // Check that block 0 and block 2 have similar signs (both "A" or both "B")
    // and block 0 and block 1 have opposite signs
    const block0 = result.eigenvector[4];  // middle of first block
    const block1 = result.eigenvector[12]; // middle of second block
    const block2 = result.eigenvector[20]; // middle of third block
    expect(block0 * block1).toBeLessThan(0); // opposite signs
    expect(block0 * block2).toBeGreaterThan(0); // same sign
  });

  it('handles zero-size map', () => {
    const result = computeCompartments(new Float32Array(0), 0);
    expect(result.eigenvector.length).toBe(0);
    expect(result.normalizedEigenvector.length).toBe(0);
    expect(result.iterations).toBe(0);
  });

  it('auto-adjusts binSize for small maps', () => {
    // 8x8 map with binSize 4 → 2x2, too small → should auto-set to 1
    const map = makeCheckerboardMap(8, 4);
    const result = computeCompartments(map, 8, { binSize: 4 });
    expect(result.eigenvector.length).toBe(8);
  });

  it('uniform map produces valid normalized eigenvector', () => {
    const map = makeUniformMap(16, 0.5);
    const result = computeCompartments(map, 16, { binSize: 1 });
    // Uniform map is a degenerate case (all O/E = 1, correlation = all 1s).
    // The result should still be in valid [0, 1] range without NaN.
    for (let i = 0; i < result.normalizedEigenvector.length; i++) {
      expect(Number.isNaN(result.normalizedEigenvector[i])).toBe(false);
      expect(result.normalizedEigenvector[i]).toBeGreaterThanOrEqual(0);
      expect(result.normalizedEigenvector[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// compartmentToTrack
// ---------------------------------------------------------------------------

describe('compartmentToTrack', () => {
  it('produces heatmap track', () => {
    const result = computeCompartments(makeCheckerboardMap(32, 8), 32);
    const track = compartmentToTrack(result, 32, 1024);
    expect(track.type).toBe('heatmap');
    expect(track.name).toBe('A/B Compartments');
  });

  it('track data length equals textureSize', () => {
    const result = computeCompartments(makeCheckerboardMap(32, 8), 32);
    const track = compartmentToTrack(result, 32, 1024);
    expect(track.data.length).toBe(1024);
  });

  it('track data values in [0, 1]', () => {
    const result = computeCompartments(makeCheckerboardMap(32, 8), 32);
    const track = compartmentToTrack(result, 32, 1024);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('track is visible by default', () => {
    const result = computeCompartments(makeCheckerboardMap(32, 8), 32);
    const track = compartmentToTrack(result, 32, 512);
    expect(track.visible).toBe(true);
  });
});
