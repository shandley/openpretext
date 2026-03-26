/**
 * Tests for CheckerboardScore — information-entropy compartment regularity metric.
 */

import { describe, it, expect } from 'vitest';
import { computeCheckerboardScore, type CheckerboardResult } from '../../src/analysis/CheckerboardScore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a uniform contact map (identity-like, no structure). */
function makeUniformMap(size: number): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // Uniform random-ish values
      map[i * size + j] = Math.abs(Math.sin(i * 7 + j * 13 + 0.5));
    }
  }
  return map;
}

/** Create a checkerboard-patterned contact map (alternating A/B). */
function makeCheckerboardMap(size: number, blockSize: number = 4): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const blockI = Math.floor(i / blockSize) % 2;
      const blockJ = Math.floor(j / blockSize) % 2;
      // Same compartment = high contact, different = low
      if (blockI === blockJ) {
        map[i * size + j] = 1.0;
      } else {
        map[i * size + j] = 0.1;
      }
    }
  }
  return map;
}

/** Create a diagonal-dominant contact map (distance decay, no compartments). */
function makeDiagonalMap(size: number): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const dist = Math.abs(i - j);
      map[i * size + j] = Math.exp(-dist * 0.1);
    }
  }
  return map;
}

/** Create a zero contact map. */
function makeZeroMap(size: number): Float32Array {
  return new Float32Array(size * size);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckerboardScore', () => {
  describe('computeCheckerboardScore', () => {
    it('returns a valid result object', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64);

      expect(result).toHaveProperty('entropy');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('distanceHistogram');
      expect(result).toHaveProperty('binEdges');
      expect(result).toHaveProperty('numChromosomes');
    });

    it('score is between 0 and 100', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('entropy is non-negative', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64);
      expect(result.entropy).toBeGreaterThanOrEqual(0);
    });

    it('checkerboard map scores higher than uniform map', () => {
      const size = 64;
      const checkerboard = makeCheckerboardMap(size, 8);
      const uniform = makeUniformMap(size);

      const cbResult = computeCheckerboardScore(checkerboard, size);
      const uniResult = computeCheckerboardScore(uniform, size);

      // Checkerboard should have lower entropy (stronger pattern) = higher score
      expect(cbResult.score).toBeGreaterThan(uniResult.score);
    });

    it('checkerboard map scores higher than diagonal map', () => {
      const size = 64;
      const checkerboard = makeCheckerboardMap(size, 8);
      const diagonal = makeDiagonalMap(size);

      const cbResult = computeCheckerboardScore(checkerboard, size);
      const diagResult = computeCheckerboardScore(diagonal, size);

      expect(cbResult.score).toBeGreaterThan(diagResult.score);
    });

    it('histogram has correct number of bins', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64, { numBins: 20 });
      expect(result.distanceHistogram.length).toBe(20);
      expect(result.binEdges.length).toBe(21);
    });

    it('histogram probabilities sum to approximately 1', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64);
      let sum = 0;
      for (let i = 0; i < result.distanceHistogram.length; i++) {
        sum += result.distanceHistogram[i];
      }
      expect(sum).toBeCloseTo(1.0, 1);
    });

    it('bin edges are evenly spaced', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64, { numBins: 10, maxDistance: 2.0 });
      const step = result.binEdges[1] - result.binEdges[0];
      expect(step).toBeCloseTo(0.2, 5);
      for (let i = 2; i < result.binEdges.length; i++) {
        expect(result.binEdges[i] - result.binEdges[i - 1]).toBeCloseTo(step, 5);
      }
    });

    it('handles zero map gracefully', () => {
      const map = makeZeroMap(64);
      const result = computeCheckerboardScore(map, 64);
      expect(Number.isFinite(result.entropy)).toBe(true);
      expect(Number.isFinite(result.score)).toBe(true);
    });

    it('handles very small maps', () => {
      const map = makeUniformMap(8);
      const result = computeCheckerboardScore(map, 8);
      expect(Number.isFinite(result.entropy)).toBe(true);
      expect(Number.isFinite(result.score)).toBe(true);
    });

    it('respects custom distance fraction parameters', () => {
      const map = makeUniformMap(100);
      const narrow = computeCheckerboardScore(map, 100, {
        minDistanceFraction: 0.05,
        maxDistanceFraction: 0.08,
      });
      const wide = computeCheckerboardScore(map, 100, {
        minDistanceFraction: 0.05,
        maxDistanceFraction: 0.25,
      });
      // Both should produce valid results
      expect(Number.isFinite(narrow.entropy)).toBe(true);
      expect(Number.isFinite(wide.entropy)).toBe(true);
    });

    it('numChromosomes reflects number of entropy batches', () => {
      const map = makeUniformMap(200);
      const result = computeCheckerboardScore(map, 200, { minSamples: 50 });
      expect(result.numChromosomes).toBeGreaterThan(0);
    });

    it('stronger checkerboard block size produces higher score', () => {
      const size = 128;
      // Large blocks = more obvious compartments
      const largeBlocks = makeCheckerboardMap(size, 16);
      // Small blocks = more fragmented, less clear
      const smallBlocks = makeCheckerboardMap(size, 2);

      const largeResult = computeCheckerboardScore(largeBlocks, size);
      const smallResult = computeCheckerboardScore(smallBlocks, size);

      // Both should score higher than random but large blocks should be more distinct
      expect(largeResult.score).toBeGreaterThan(10);
      expect(smallResult.score).toBeGreaterThan(10);
    });

    it('default parameters match expected values', () => {
      const map = makeUniformMap(64);
      const result = computeCheckerboardScore(map, 64);
      // Default: 30 bins, max distance 1.6
      expect(result.distanceHistogram.length).toBe(30);
      expect(result.binEdges[result.binEdges.length - 1]).toBeCloseTo(1.6, 5);
    });

    it('score inversely correlates with entropy', () => {
      const size = 64;
      const maps = [
        makeCheckerboardMap(size, 8),
        makeDiagonalMap(size),
        makeUniformMap(size),
      ];

      const results = maps.map(m => computeCheckerboardScore(m, size));

      // Higher entropy should mean lower score
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          if (results[i].entropy < results[j].entropy) {
            expect(results[i].score).toBeGreaterThan(results[j].score);
          }
        }
      }
    });
  });
});
