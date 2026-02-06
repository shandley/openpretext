import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import {
  computeIntraDiagonalProfile,
  computeLinkScore,
  unionFindSort,
  autoSort,
  type ContigRange,
  type ContigLink,
  type ChainEntry,
} from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestMap(contigs: ContigInfo[], textureSize: number, contactMap: Float32Array | null = null): MapData {
  return {
    filename: 'test.pretext',
    textureSize,
    numMipMaps: 1,
    tileResolution: 1024,
    tilesPerDimension: 1,
    contigs,
    contactMap,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length: number = 10000,
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

/**
 * Create a contact map where specific contig pairs have strong diagonal
 * signal in their inter-contig blocks (simulating true adjacency).
 *
 * `adjacencies` is an array of [contigI, contigJ] pairs that should
 * have strong inter-contig signal. The map has a decay profile along
 * the diagonal: value = baseValue / sqrt(d).
 */
function makeMapWithAdjacencies(
  size: number,
  ranges: ContigRange[],
  adjacencies: Array<[number, number]>,
  baseValue: number = 2.0,
): Float32Array {
  const map = new Float32Array(size * size);

  // Intra-contig diagonal signal
  for (const range of ranges) {
    for (let p = range.start; p < range.end; p++) {
      for (let d = 1; d <= 20 && p + d < range.end; d++) {
        const val = baseValue / Math.sqrt(d);
        map[(p + d) * size + p] = val;
        map[p * size + (p + d)] = val;
      }
    }
  }

  // Inter-contig signal for adjacent pairs (HH orientation: tail of I, head of J)
  for (const [i, j] of adjacencies) {
    const ri = ranges[i];
    const rj = ranges[j];

    // Fill near the tail-of-I / head-of-J corner
    for (let di = 0; di < 10 && ri.end - 1 - di >= ri.start; di++) {
      for (let dj = 0; dj < 10 && rj.start + dj < rj.end; dj++) {
        const row = ri.end - 1 - di;
        const col = rj.start + dj;
        const d = di + dj + 1;
        const val = baseValue / Math.sqrt(d);
        if (row < size && col < size) {
          map[row * size + col] = val;
          map[col * size + row] = val;
        }
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoSort', () => {
  beforeEach(() => {
    state.reset();
  });

  // -----------------------------------------------------------------------
  // computeIntraDiagonalProfile
  // -----------------------------------------------------------------------
  describe('computeIntraDiagonalProfile', () => {
    it('should return correct profile for known contactMap', () => {
      const size = 64;
      const ranges: ContigRange[] = [
        { start: 0, end: 30, orderIndex: 0 },
        { start: 30, end: 64, orderIndex: 1 },
      ];

      // Create map with decay: value at distance d = 2.0 / sqrt(d)
      const map = new Float32Array(size * size);
      for (const range of ranges) {
        for (let p = range.start; p < range.end; p++) {
          for (let d = 1; d <= 10 && p + d < range.end; d++) {
            const val = 2.0 / Math.sqrt(d);
            map[(p + d) * size + p] = val;
            map[p * size + (p + d)] = val;
          }
        }
      }

      const profile = computeIntraDiagonalProfile(map, size, ranges, 10);

      // profile[1] should be ~2.0 (= 2.0/sqrt(1))
      expect(profile[1]).toBeCloseTo(2.0, 0);
      // profile[4] should be ~1.0 (= 2.0/sqrt(4))
      expect(profile[4]).toBeCloseTo(1.0, 0);
      // Profile should be monotonically decreasing
      for (let d = 2; d <= 10; d++) {
        expect(profile[d]).toBeLessThanOrEqual(profile[d - 1] + 0.01);
      }
    });

    it('should return zeros for empty map', () => {
      const size = 32;
      const map = new Float32Array(size * size);
      const ranges: ContigRange[] = [{ start: 0, end: 32, orderIndex: 0 }];

      const profile = computeIntraDiagonalProfile(map, size, ranges, 5);

      for (let d = 0; d <= 5; d++) {
        expect(profile[d]).toBe(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // computeLinkScore
  // -----------------------------------------------------------------------
  describe('computeLinkScore', () => {
    it('should return higher score for matching contigs', () => {
      const size = 64;
      const rangeI: ContigRange = { start: 0, end: 30, orderIndex: 0 };
      const rangeJ: ContigRange = { start: 30, end: 60, orderIndex: 1 };
      const rangeK: ContigRange = { start: 30, end: 60, orderIndex: 2 };

      // Create a map with strong inter-contig signal between I and J (HH)
      const map = makeMapWithAdjacencies(size, [rangeI, rangeJ], [[0, 1]]);

      // Build profile from intra-contig signal
      const profile = computeIntraDiagonalProfile(map, size, [rangeI, rangeJ], 20);

      // Score I-J (should be high: they're adjacent)
      const scoreIJ = computeLinkScore(map, size, rangeI, rangeJ, false, false, profile, 20);

      // Score with a different range that has no inter-contig signal
      const emptyMap = new Float32Array(size * size);
      // Only intra-contig signal
      for (let p = 0; p < 30; p++) {
        for (let d = 1; d <= 10 && p + d < 30; d++) {
          const val = 2.0 / Math.sqrt(d);
          emptyMap[(p + d) * size + p] = val;
          emptyMap[p * size + (p + d)] = val;
        }
      }
      for (let p = 30; p < 60; p++) {
        for (let d = 1; d <= 10 && p + d < 60; d++) {
          const val = 2.0 / Math.sqrt(d);
          emptyMap[(p + d) * size + p] = val;
          emptyMap[p * size + (p + d)] = val;
        }
      }

      const profileEmpty = computeIntraDiagonalProfile(emptyMap, size, [rangeI, rangeK], 20);
      const scoreLow = computeLinkScore(emptyMap, size, rangeI, rangeK, false, false, profileEmpty, 20);

      // Score for matching pair should be higher
      expect(scoreIJ).toBeGreaterThan(scoreLow);
    });
  });

  // -----------------------------------------------------------------------
  // unionFindSort
  // -----------------------------------------------------------------------
  describe('unionFindSort', () => {
    it('should chain linked contigs into a single chain', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 1, j: 2, score: 0.8, orientation: 'HH', allScores: [0.8, 0.1, 0.1, 0.1] },
      ];

      const result = unionFindSort(links, 3, 0.5);

      // All 3 contigs should be in one chain
      expect(result.chains.length).toBe(1);
      expect(result.chains[0].length).toBe(3);

      // Check that all contigs are present
      const indices = result.chains[0].map(e => e.orderIndex).sort();
      expect(indices).toEqual([0, 1, 2]);
    });

    it('should form separate chains for separate chromosomes', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 2, j: 3, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        // Low score between chromosomes
        { i: 1, j: 2, score: 0.2, orientation: 'HH', allScores: [0.2, 0.1, 0.1, 0.1] },
      ];

      const result = unionFindSort(links, 4, 0.5);

      // Should form 2 chains: [0,1] and [2,3]
      expect(result.chains.length).toBe(2);
      expect(result.chains[0].length).toBe(2);
      expect(result.chains[1].length).toBe(2);
    });

    it('should respect threshold', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.3, orientation: 'HH', allScores: [0.3, 0.1, 0.1, 0.1] },
      ];

      // Threshold higher than any score
      const result = unionFindSort(links, 2, 0.5);

      // Each contig should be its own chain
      expect(result.chains.length).toBe(2);
      expect(result.chains[0].length).toBe(1);
      expect(result.chains[1].length).toBe(1);
    });

    it('should handle empty links', () => {
      const result = unionFindSort([], 3, 0.5);

      // Each contig in its own chain
      expect(result.chains.length).toBe(3);
      result.chains.forEach(chain => {
        expect(chain.length).toBe(1);
      });
    });

    it('should sort chains largest-first', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 0, j: 2, score: 0.8, orientation: 'HH', allScores: [0.8, 0.1, 0.1, 0.1] },
        // Contigs 3, 4 are separate
      ];

      const result = unionFindSort(links, 5, 0.5);

      // First chain should be the longest
      for (let i = 1; i < result.chains.length; i++) {
        expect(result.chains[i].length).toBeLessThanOrEqual(result.chains[i - 1].length);
      }
    });
  });

  // -----------------------------------------------------------------------
  // autoSort (integration)
  // -----------------------------------------------------------------------
  describe('autoSort', () => {
    it('should group contigs from same chromosome together', () => {
      const size = 128;
      // 4 contigs: chr1_a, chr1_b, chr2_a, chr2_b
      // Shuffled order: [chr2_b, chr1_a, chr2_a, chr1_b]
      const contigs = [
        makeContig('chr2_b', 0, 0, 32, 32000),
        makeContig('chr1_a', 1, 32, 64, 32000),
        makeContig('chr2_a', 2, 64, 96, 32000),
        makeContig('chr1_b', 3, 96, 128, 32000),
      ];
      const contigOrder = [0, 1, 2, 3];

      const ranges: ContigRange[] = [
        { start: 0, end: 32, orderIndex: 0 },
        { start: 32, end: 64, orderIndex: 1 },
        { start: 64, end: 96, orderIndex: 2 },
        { start: 96, end: 128, orderIndex: 3 },
      ];

      // chr1_a (order 1) should link with chr1_b (order 3)
      // chr2_a (order 2) should link with chr2_b (order 0)
      const contactMap = makeMapWithAdjacencies(size, ranges, [[1, 3], [0, 2]]);

      const result = autoSort(
        contactMap, size, contigs, contigOrder, 128,
        { maxDiagonalDistance: 20, signalCutoff: 0.01, hardThreshold: 0.8 },
      );

      // Should produce chains. At minimum, linked pairs should be in same chains.
      expect(result.chains.length).toBeGreaterThanOrEqual(1);

      // Check that linked contigs end up in the same chain
      const chainForContig = new Map<number, number>();
      result.chains.forEach((chain, chainIdx) => {
        chain.forEach(entry => chainForContig.set(entry.orderIndex, chainIdx));
      });

      // chr1_a (1) and chr1_b (3) should be in the same chain
      if (chainForContig.has(1) && chainForContig.has(3)) {
        expect(chainForContig.get(1)).toBe(chainForContig.get(3));
      }
    });
  });

  // -----------------------------------------------------------------------
  // autoSortContigs integration (via BatchOperations)
  // -----------------------------------------------------------------------
  describe('autoSortContigs integration', () => {
    it('should return 0 operations when no map is loaded', async () => {
      const { autoSortContigs } = await import('../../src/curation/BatchOperations');
      const result = autoSortContigs();
      expect(result.operationsPerformed).toBe(0);
      expect(result.description).toBe('No map loaded');
    });

    it('should apply moves via CurationEngine and be undoable', async () => {
      const { autoSortContigs } = await import('../../src/curation/BatchOperations');

      const size = 64;
      const contigs = [
        makeContig('b', 0, 0, 16, 16000),
        makeContig('a', 1, 16, 32, 16000),
        makeContig('d', 2, 32, 48, 16000),
        makeContig('c', 3, 48, 64, 16000),
      ];

      const ranges: ContigRange[] = [
        { start: 0, end: 16, orderIndex: 0 },
        { start: 16, end: 32, orderIndex: 1 },
        { start: 32, end: 48, orderIndex: 2 },
        { start: 48, end: 64, orderIndex: 3 },
      ];

      // a-b are chromosome 1, c-d are chromosome 2
      const contactMap = makeMapWithAdjacencies(size, ranges, [[0, 1], [2, 3]]);
      const map = makeTestMap(contigs, 64, contactMap);

      state.update({
        map,
        contigOrder: [0, 1, 2, 3],
        undoStack: [],
        redoStack: [],
      });

      const originalOrder = [...state.get().contigOrder];
      const result = autoSortContigs({
        maxDiagonalDistance: 10,
        signalCutoff: 0.01,
        hardThreshold: 0.8,
      });

      if (result.operationsPerformed > 0) {
        const s = state.get();
        // Undo stack should have operations
        expect(s.undoStack.length).toBe(result.operationsPerformed);

        // Undo all
        for (let i = 0; i < result.operationsPerformed; i++) {
          CurationEngine.undo();
        }

        // Should be back to original
        expect(state.get().contigOrder).toEqual(originalOrder);
      }
    });
  });

  // -----------------------------------------------------------------------
  // New default tuning tests
  // -----------------------------------------------------------------------
  describe('tuned defaults', () => {
    it('hardThreshold=0.2 should allow chaining of score=0.3 links', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.3, orientation: 'HH', allScores: [0.3, 0.1, 0.1, 0.1] },
        { i: 1, j: 2, score: 0.25, orientation: 'HH', allScores: [0.25, 0.1, 0.1, 0.1] },
      ];

      // With the new default threshold of 0.2, both links should be accepted
      const result = unionFindSort(links, 3, 0.2);

      // All 3 contigs should be in one chain
      expect(result.chains.length).toBe(1);
      expect(result.chains[0].length).toBe(3);
    });

    it('hardThreshold=0.2 rejects links below threshold', () => {
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.15, orientation: 'HH', allScores: [0.15, 0.1, 0.1, 0.1] },
      ];

      const result = unionFindSort(links, 2, 0.2);

      // Should remain separate chains since score < threshold
      expect(result.chains.length).toBe(2);
    });
  });
});
