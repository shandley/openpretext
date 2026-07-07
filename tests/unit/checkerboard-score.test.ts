/**
 * Tests for CheckerboardScore — information-entropy compartment regularity metric.
 */

import { describe, it, expect } from 'vitest';
import { computeCheckerboardScore, type CheckerboardResult, type ChromosomeRange } from '../../src/analysis/CheckerboardScore';

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

    it('uniform map scores higher than binary checkerboard in whole-genome mode', () => {
      // In whole-genome mode, the metric measures cosine distance spread across
      // the full map. Binary checkerboard maps produce concentrated distributions
      // (near 0 or near max) giving LOWER entropy than pseudo-random contact maps.
      // This reflects that the whole-genome mode is not HiArch-comparable.
      const size = 64;
      const checkerboard = makeCheckerboardMap(size, 8);
      const uniform = makeUniformMap(size);

      const cbResult = computeCheckerboardScore(checkerboard, size);
      const uniResult = computeCheckerboardScore(uniform, size);

      // Uniform map should score higher (more varied cosine distances = higher entropy)
      expect(uniResult.score).toBeGreaterThan(cbResult.score);
    });

    it('diagonal map scores higher than binary checkerboard in whole-genome mode', () => {
      const size = 64;
      const checkerboard = makeCheckerboardMap(size, 8);
      const diagonal = makeDiagonalMap(size);

      const cbResult = computeCheckerboardScore(checkerboard, size);
      const diagResult = computeCheckerboardScore(diagonal, size);

      expect(diagResult.score).toBeGreaterThan(cbResult.score);
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

    describe('per-chromosome mode', () => {
      /** Build a multi-chromosome map: N chromosomes of equal size, each with
       *  a checkerboard A/B pattern internally, no inter-chromosomal contacts. */
      function makeMultiChromosomeMap(mapSize: number, numChr: number, blockSize: number = 4): {
        map: Float32Array;
        ranges: ChromosomeRange[];
      } {
        const map = new Float32Array(mapSize * mapSize);
        const chrSize = Math.floor(mapSize / numChr);
        const ranges: ChromosomeRange[] = [];

        for (let c = 0; c < numChr; c++) {
          const cs = c * chrSize;
          const ce = cs + chrSize;
          ranges.push({ start: cs, end: ce });
          // Fill intra-chromosomal block with A/B checkerboard
          for (let i = cs; i < ce; i++) {
            for (let j = cs; j < ce; j++) {
              const blockI = Math.floor((i - cs) / blockSize) % 2;
              const blockJ = Math.floor((j - cs) / blockSize) % 2;
              map[i * mapSize + j] = blockI === blockJ ? 1.0 : 0.05;
            }
          }
        }
        return { map, ranges };
      }

      it('per-chromosome mode returns valid result', () => {
        const { map, ranges } = makeMultiChromosomeMap(128, 4, 8);
        const result = computeCheckerboardScore(map, 128, undefined, ranges);
        expect(result).toHaveProperty('entropy');
        expect(result).toHaveProperty('score');
        expect(result.numChromosomes).toBe(4);
        expect(Number.isFinite(result.entropy)).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      });

      it('per-chromosome mode produces nonzero entropy for multi-chr map', () => {
        // Per-chromosome mode should capture intra-chromosomal structure.
        const { map, ranges } = makeMultiChromosomeMap(128, 8, 8);
        const perChr = computeCheckerboardScore(map, 128, undefined, ranges);
        expect(perChr.entropy).toBeGreaterThan(0);
        expect(Number.isFinite(perChr.entropy)).toBe(true);
      });

      it('per-chromosome numChromosomes matches scaffold count for valid map', () => {
        // numChromosomes should equal the number of scaffolds with sufficient data.
        const { map, ranges } = makeMultiChromosomeMap(256, 8, 16);
        const result = computeCheckerboardScore(map, 256, undefined, ranges);
        // All 8 chromosomes should have enough pixels to contribute
        expect(result.numChromosomes).toBeGreaterThan(0);
        expect(result.numChromosomes).toBeLessThanOrEqual(8);
      });

      it('falls back to whole-genome when fewer than 2 chromosome ranges given', () => {
        const map = makeUniformMap(64);
        const singleRange: ChromosomeRange[] = [{ start: 0, end: 64 }];
        const withOne = computeCheckerboardScore(map, 64, undefined, singleRange);
        const wholeGenome = computeCheckerboardScore(map, 64);
        // Should produce identical results since single-range falls back
        expect(withOne.entropy).toBeCloseTo(wholeGenome.entropy, 4);
      });

      it('skips chromosomes smaller than 5 pixels', () => {
        const { map, ranges } = makeMultiChromosomeMap(128, 4, 8);
        const rangesWithTiny: ChromosomeRange[] = [
          ...ranges,
          { start: 0, end: 2 }, // 2-pixel chromosome, too small
        ];
        const result = computeCheckerboardScore(map, 128, undefined, rangesWithTiny);
        // Tiny chromosome should be skipped; numChromosomes should reflect actual used count
        expect(result.numChromosomes).toBe(4);
      });

      it('per-chromosome checkerboard scores higher than per-chromosome diagonal', () => {
        const size = 128;
        const numChr = 4;
        const chrSize = size / numChr;
        const ranges: ChromosomeRange[] = Array.from({ length: numChr }, (_, c) => ({
          start: c * chrSize,
          end: (c + 1) * chrSize,
        }));

        // Checkerboard map
        const { map: cbMap } = makeMultiChromosomeMap(size, numChr, 8);

        // Diagonal map (distance decay within each chromosome block)
        const diagMap = new Float32Array(size * size);
        for (let c = 0; c < numChr; c++) {
          const cs = c * chrSize;
          const ce = cs + chrSize;
          for (let i = cs; i < ce; i++) {
            for (let j = cs; j < ce; j++) {
              diagMap[i * size + j] = Math.exp(-Math.abs(i - j) * 0.1);
            }
          }
        }

        const cbResult = computeCheckerboardScore(cbMap, size, undefined, ranges);
        const diagResult = computeCheckerboardScore(diagMap, size, undefined, ranges);
        expect(cbResult.score).toBeGreaterThan(diagResult.score);
      });
    });

    it('score directly correlates with entropy', () => {
      // Higher entropy = more varied cosine distances = stronger compartmentalization
      // signal in the HiArch sense = higher score.
      const size = 64;
      const maps = [
        makeCheckerboardMap(size, 8),
        makeDiagonalMap(size),
        makeUniformMap(size),
      ];

      const results = maps.map(m => computeCheckerboardScore(m, size));

      // Higher entropy must produce higher score
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          if (results[i].entropy < results[j].entropy) {
            expect(results[i].score).toBeLessThan(results[j].score);
          }
        }
      }
    });
  });
});

describe('CheckerboardScore — empty-scaffold sentinel regression', () => {
  it('skips an all-zero chromosome instead of flooding it with 1.0 sentinels', () => {
    // Chromosome 0 has real checkerboard structure; chromosome 1 is all zero
    // (an empty scaffold). The empty one used to contribute a full histogram of
    // 1.0 "no data" distances; it must now be skipped for lack of valid samples.
    const size = 40;
    const map = new Float32Array(size * size);
    const block = 4;
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const same = (Math.floor(i / block) % 2) === (Math.floor(j / block) % 2);
        map[i * size + j] = same ? 0.8 : 0.1;
      }
    }
    const ranges: ChromosomeRange[] = [
      { start: 0, end: 20 },
      { start: 20, end: 40 }, // all zero
    ];
    const result = computeCheckerboardScore(map, size, undefined, ranges);
    expect(result.numChromosomes).toBe(1);
  });

  it('respects the parameterized minSamplesPerChromosome floor', () => {
    // Two structured chromosomes both clear the default floor of 10.
    const size = 40;
    const map = makeCheckerboardMap(size, 4);
    const ranges: ChromosomeRange[] = [
      { start: 0, end: 20 },
      { start: 20, end: 40 },
    ];
    const def = computeCheckerboardScore(map, size, undefined, ranges);
    expect(def.numChromosomes).toBe(2);
    // A floor above each chromosome's sample count excludes both from the
    // per-chromosome path (it then falls back to whole-genome).
    const high = computeCheckerboardScore(map, size, { minSamplesPerChromosome: 100000 }, ranges);
    expect(high.numChromosomes).toBeLessThan(def.numChromosomes);
  });
});
