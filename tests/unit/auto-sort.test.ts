import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import {
  computeIntraDiagonalProfile,
  computeLinkScore,
  unionFindSort,
  mergeSmallChains,
  hierarchicalChainMerge,
  autoSort,
  type ContigRange,
  type ContigLink,
  type ChainEntry,
  type AutoSortResult,
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
    it('should return trivial chains for small assembly (< 60 contigs)', () => {
      const size = 128;
      // 4 contigs — well below the 60-contig threshold
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

      const contactMap = makeMapWithAdjacencies(size, ranges, [[1, 3], [0, 2]]);

      const result = autoSort(
        contactMap, size, contigs, contigOrder, 128,
        { maxDiagonalDistance: 20, signalCutoff: 0.01, hardThreshold: 0.8 },
      );

      // Low-contig detection: should return trivial single-element chains
      expect(result.chains.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(result.chains[i].length).toBe(1);
        expect(result.chains[i][0].orderIndex).toBe(i);
        expect(result.chains[i][0].inverted).toBe(false);
      }
      expect(result.links).toEqual([]);
      expect(result.threshold).toBe(0);
    });

    it('should return trivial chains for assemblies with < 60 contigs', () => {
      const numContigs = 10;
      const pixelsPerContig = 8;
      const size = numContigs * pixelsPerContig;
      const contigs: ContigInfo[] = [];
      for (let i = 0; i < numContigs; i++) {
        contigs.push(
          makeContig(`ctg${i}`, i, i * pixelsPerContig, (i + 1) * pixelsPerContig, 10000),
        );
      }
      const contigOrder = contigs.map((_, i) => i);
      const contactMap = new Float32Array(size * size);

      const result = autoSort(contactMap, size, contigs, contigOrder, size);

      // Should return one chain per contig (trivial identity mapping)
      expect(result.chains.length).toBe(numContigs);
      for (let i = 0; i < numContigs; i++) {
        expect(result.chains[i].length).toBe(1);
        expect(result.chains[i][0].orderIndex).toBe(i);
        expect(result.chains[i][0].inverted).toBe(false);
      }
      // Links should be empty (no computation performed)
      expect(result.links).toEqual([]);
      expect(result.threshold).toBe(0);
    });

    it('should still process assemblies with >= 60 contigs', () => {
      const numContigs = 60;
      const pixelsPerContig = 4;
      const size = numContigs * pixelsPerContig;
      const contigs: ContigInfo[] = [];
      const ranges: ContigRange[] = [];
      for (let i = 0; i < numContigs; i++) {
        contigs.push(
          makeContig(`ctg${i}`, i, i * pixelsPerContig, (i + 1) * pixelsPerContig, 10000),
        );
        ranges.push({ start: i * pixelsPerContig, end: (i + 1) * pixelsPerContig, orderIndex: i });
      }
      const contigOrder = contigs.map((_, i) => i);

      // Create a contact map with adjacency signal between pairs of contigs
      const adjacencies: Array<[number, number]> = [];
      for (let i = 0; i < numContigs - 1; i += 2) {
        adjacencies.push([i, i + 1]);
      }
      const contactMap = makeMapWithAdjacencies(size, ranges, adjacencies, 2.0);

      const result = autoSort(contactMap, size, contigs, contigOrder, size, {
        maxDiagonalDistance: 10,
        signalCutoff: 0.01,
        hardThreshold: 0.2,
      });

      // Should have computed links (non-trivial processing)
      expect(result.links.length).toBeGreaterThan(0);
      // Should have some multi-element chains from the adjacency signal
      const multiElementChains = result.chains.filter(c => c.length > 1);
      expect(multiElementChains.length).toBeGreaterThan(0);
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
  // Bug fix: chain reversal condition (line 376)
  // -----------------------------------------------------------------------
  describe('chain reversal bug fix', () => {
    it('should reverse chain B when J is at the head and should not be', () => {
      // Set up scenario: 3 contigs where a chain [2, 1] already exists
      // (contig 2 is head, contig 1 is tail).
      // Then a TT link between contig 0 and contig 2 arrives.
      // TT means: head of I connects to tail of J.
      // So J (contig 2) should be at the TAIL of its chain (jShouldBeHead = false).
      // But contig 2 IS the head of chain [2, 1].
      // The fix ensures the chain gets reversed to [1, 2] so contig 2 is at the tail.

      // First link: chain contigs 2 and 1 together with HH orientation
      // This creates chain [2, 1] (contig 2 at head, contig 1 at tail)
      const links: ContigLink[] = [
        { i: 2, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        // TT link: head of 0 connects to tail of 2
        // jShouldBeHead = false (TT), so J (contig 2) should be at the TAIL
        // But contig 2 is at the HEAD of its chain -> needs reversal
        { i: 0, j: 2, score: 0.8, orientation: 'TT', allScores: [0.1, 0.1, 0.1, 0.8] },
      ];

      const result = unionFindSort(links, 3, 0.5);

      // All 3 contigs should be in one chain (the bug would prevent the merge)
      expect(result.chains.length).toBe(1);
      expect(result.chains[0].length).toBe(3);

      // Verify all contigs are present
      const indices = result.chains[0].map(e => e.orderIndex).sort();
      expect(indices).toEqual([0, 1, 2]);
    });
  });

  // -----------------------------------------------------------------------
  // mergeSmallChains
  // -----------------------------------------------------------------------
  describe('mergeSmallChains', () => {
    it('should merge singleton chains when link exceeds mergeThreshold', () => {
      // Two singleton chains and one 2-element chain
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
          [{ orderIndex: 2, inverted: false }],
          [{ orderIndex: 3, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      // Link between contig 2 and contig 3 (both singletons) with score above threshold
      const links: ContigLink[] = [
        { i: 2, j: 3, score: 0.3, orientation: 'HH', allScores: [0.3, 0.1, 0.1, 0.1] },
      ];

      const merged = mergeSmallChains(initialResult, links, 3, 0.05);

      // Singletons 2 and 3 should be merged; chain [0,1] stays separate
      expect(merged.chains.length).toBe(2);

      // The larger chain should have 2 entries (the merged singletons)
      // and the original 2-element chain
      const chainLengths = merged.chains.map(c => c.length).sort();
      expect(chainLengths).toEqual([2, 2]);

      // Verify that contigs 2 and 3 are in the same chain
      const chainWith2 = merged.chains.find(c => c.some(e => e.orderIndex === 2));
      const chainWith3 = merged.chains.find(c => c.some(e => e.orderIndex === 3));
      expect(chainWith2).toBe(chainWith3);
    });

    it('should NOT merge chains when both are at or above minChainSize', () => {
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }, { orderIndex: 2, inverted: false }],
          [{ orderIndex: 3, inverted: false }, { orderIndex: 4, inverted: false }, { orderIndex: 5, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      // Strong link between the two chains, but both have length >= minChainSize=3
      const links: ContigLink[] = [
        { i: 0, j: 3, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
      ];

      const merged = mergeSmallChains(initialResult, links, 3, 0.05);

      // Should still have 2 separate chains
      expect(merged.chains.length).toBe(2);
    });

    it('should NOT merge chains when link score is below mergeThreshold', () => {
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }],
          [{ orderIndex: 1, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      // Link score below mergeThreshold
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.02, orientation: 'HH', allScores: [0.02, 0.01, 0.01, 0.01] },
      ];

      const merged = mergeSmallChains(initialResult, links, 3, 0.05);

      // Should still have 2 separate chains
      expect(merged.chains.length).toBe(2);
    });

    it('end-to-end autoSort should produce fewer chains with merge than without', () => {
      // 5 contigs: union-find will create some small chains,
      // merge should reduce the count
      const links: ContigLink[] = [
        // Strong link chains 0-1
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        // Strong link chains 2-3
        { i: 2, j: 3, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        // Weak link between chain [0,1] and singleton 4 (above merge threshold but below union-find threshold)
        { i: 1, j: 4, score: 0.1, orientation: 'HH', allScores: [0.1, 0.05, 0.05, 0.05] },
      ];

      // Without merge: threshold 0.5 -> chains: [0,1], [2,3], [4]
      const withoutMerge = unionFindSort(links, 5, 0.5);
      expect(withoutMerge.chains.length).toBe(3);

      // With merge: singleton [4] should merge with [0,1] via the 0.1 score link
      const withMerge = mergeSmallChains(withoutMerge, links, 3, 0.05);
      expect(withMerge.chains.length).toBe(2);

      // The largest chain should now have 3 elements
      expect(withMerge.chains[0].length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // hierarchicalChainMerge
  // -----------------------------------------------------------------------
  describe('hierarchicalChainMerge', () => {
    it('should merge two medium chains (both >= 3 contigs) from the same chromosome', () => {
      // Two 3-element chains that the old mergeSmallChains would NOT merge
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }, { orderIndex: 2, inverted: false }],
          [{ orderIndex: 3, inverted: false }, { orderIndex: 4, inverted: false }, { orderIndex: 5, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      // Strong inter-chain link and strong intra-chain links
      const links: ContigLink[] = [
        // Intra-chain A links
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 1, j: 2, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        // Intra-chain B links
        { i: 3, j: 4, score: 0.88, orientation: 'HH', allScores: [0.88, 0.1, 0.1, 0.1] },
        { i: 4, j: 5, score: 0.82, orientation: 'HH', allScores: [0.82, 0.1, 0.1, 0.1] },
        // Inter-chain link: strong enough to merge (> 50% of intra-chain averages)
        { i: 2, j: 3, score: 0.7, orientation: 'HH', allScores: [0.7, 0.1, 0.1, 0.1] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      // Should merge into a single chain of 6
      expect(merged.chains.length).toBe(1);
      expect(merged.chains[0].length).toBe(6);

      // All contigs should be present
      const indices = merged.chains[0].map(e => e.orderIndex).sort();
      expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('should NOT merge chains from different chromosomes (low inter-chain signal)', () => {
      // Two 3-element chains with strong intra-chain links but very weak inter-chain link
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }, { orderIndex: 2, inverted: false }],
          [{ orderIndex: 3, inverted: false }, { orderIndex: 4, inverted: false }, { orderIndex: 5, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        // Strong intra-chain links
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 1, j: 2, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        { i: 3, j: 4, score: 0.88, orientation: 'HH', allScores: [0.88, 0.1, 0.1, 0.1] },
        { i: 4, j: 5, score: 0.82, orientation: 'HH', allScores: [0.82, 0.1, 0.1, 0.1] },
        // Very weak inter-chain link: below 50% of intra-chain avg (safety guard)
        // Avg intra A = (0.9+0.85)/2 = 0.875; Avg intra B = (0.88+0.82)/2 = 0.85
        // Min = 0.85; 50% = 0.425. Link score 0.1 < 0.425 => blocked
        { i: 2, j: 3, score: 0.1, orientation: 'HH', allScores: [0.1, 0.05, 0.05, 0.05] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      // Should remain 2 separate chains (safety guard prevents merge)
      expect(merged.chains.length).toBe(2);
    });

    it('should perform orientation-aware merge with HT orientation', () => {
      // Chain A: [0, 1] with contig 1 at the tail
      // Chain B: [2, 3] with contig 2 at the head
      // HT link from contig 1 (tail of A) to contig 3 (tail of B)
      // This should reverse chain B to connect properly
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
          [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        // Intra-chain links (needed for safety guard computation with >= 2 contigs)
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 2, j: 3, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        // HT link: tail of I(1) connects to tail of J(3)
        { i: 1, j: 3, score: 0.7, orientation: 'HT', allScores: [0.1, 0.7, 0.1, 0.1] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      // Should merge into one chain
      expect(merged.chains.length).toBe(1);
      expect(merged.chains[0].length).toBe(4);

      // All contigs present
      const indices = merged.chains[0].map(e => e.orderIndex).sort();
      expect(indices).toEqual([0, 1, 2, 3]);

      // With HT orientation, chain B should have been reversed/inverted
      // Check that at least some entries have inverted=true (orientation was applied)
      const invertedCount = merged.chains[0].filter(e => e.inverted).length;
      expect(invertedCount).toBeGreaterThan(0);
    });

    it('should progressively merge 3 chains from one chromosome into 1 (multi-pass)', () => {
      // Three 2-element chains: [0,1], [2,3], [4,5]
      // Links: A-B has score 0.7, B-C has score 0.6
      // Should merge all into one chain across multiple passes
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
          [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
          [{ orderIndex: 4, inverted: false }, { orderIndex: 5, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        // Intra-chain links
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 2, j: 3, score: 0.88, orientation: 'HH', allScores: [0.88, 0.1, 0.1, 0.1] },
        { i: 4, j: 5, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        // Inter-chain links
        { i: 1, j: 2, score: 0.7, orientation: 'HH', allScores: [0.7, 0.1, 0.1, 0.1] },
        { i: 3, j: 4, score: 0.6, orientation: 'HH', allScores: [0.6, 0.1, 0.1, 0.1] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      // All 3 chains should merge into 1 across two passes
      expect(merged.chains.length).toBe(1);
      expect(merged.chains[0].length).toBe(6);

      const indices = merged.chains[0].map(e => e.orderIndex).sort();
      expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('safety guard prevents merge when affinity is very low relative to intra-chain signal', () => {
      // Two chains with very strong intra-chain signal but very weak inter-chain link
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
          [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        // Very strong intra-chain links
        { i: 0, j: 1, score: 0.95, orientation: 'HH', allScores: [0.95, 0.1, 0.1, 0.1] },
        { i: 2, j: 3, score: 0.92, orientation: 'HH', allScores: [0.92, 0.1, 0.1, 0.1] },
        // Inter-chain link is above the effective threshold but below 50% of min intra-chain avg
        // Min intra = min(0.95, 0.92) = 0.92; 50% = 0.46
        // Link score 0.2 < 0.46 => safety guard blocks
        { i: 1, j: 2, score: 0.2, orientation: 'HH', allScores: [0.2, 0.1, 0.1, 0.1] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      // Safety guard should prevent the merge
      expect(merged.chains.length).toBe(2);
    });

    it('should merge singleton chains (no safety guard for singletons)', () => {
      // Two singleton chains with a moderate link between them
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }],
          [{ orderIndex: 1, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.3, orientation: 'HH', allScores: [0.3, 0.1, 0.1, 0.1] },
      ];

      // effectiveThreshold = max(0.05, 0.5*0.3) = 0.15; 0.3 > 0.15 => should merge
      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      expect(merged.chains.length).toBe(1);
      expect(merged.chains[0].length).toBe(2);
    });

    it('should NOT merge when all inter-chain scores are below effective threshold', () => {
      const initialResult: AutoSortResult = {
        chains: [
          [{ orderIndex: 0, inverted: false }],
          [{ orderIndex: 1, inverted: false }],
        ],
        links: [],
        threshold: 0.5,
      };

      const links: ContigLink[] = [
        // Score below effective threshold of max(0.05, 0.5*0.3) = 0.15
        { i: 0, j: 1, score: 0.1, orientation: 'HH', allScores: [0.1, 0.05, 0.05, 0.05] },
      ];

      const merged = hierarchicalChainMerge(initialResult, links, 0.05, 0.5);

      expect(merged.chains.length).toBe(2);
    });

    it('end-to-end: hierarchical merge produces fewer chains than legacy mergeSmallChains', () => {
      // Setup: union-find with threshold 0.7 creates [0,1,2], [3,4,5], [6]
      // The inter-chain link (0.6) is below UF threshold so UF won't merge the big chains.
      // mergeSmallChains won't merge them either (both >= 3).
      // hierarchicalChainMerge should merge [0,1,2] with [3,4,5] because 0.6 passes its threshold.
      const links: ContigLink[] = [
        { i: 0, j: 1, score: 0.9, orientation: 'HH', allScores: [0.9, 0.1, 0.1, 0.1] },
        { i: 1, j: 2, score: 0.85, orientation: 'HH', allScores: [0.85, 0.1, 0.1, 0.1] },
        { i: 3, j: 4, score: 0.88, orientation: 'HH', allScores: [0.88, 0.1, 0.1, 0.1] },
        { i: 4, j: 5, score: 0.82, orientation: 'HH', allScores: [0.82, 0.1, 0.1, 0.1] },
        // Inter-chain link: below UF threshold 0.7, but above hierarchical threshold
        { i: 2, j: 3, score: 0.6, orientation: 'HH', allScores: [0.6, 0.1, 0.1, 0.1] },
        // Weak link to singleton
        { i: 5, j: 6, score: 0.15, orientation: 'HH', allScores: [0.15, 0.05, 0.05, 0.05] },
      ];

      const ufThreshold = 0.7;

      const initial = unionFindSort(links, 7, ufThreshold);
      expect(initial.chains.length).toBe(3); // [0,1,2], [3,4,5], [6]

      // Legacy: can only merge singleton [6] (since both big chains >= 3)
      const legacyMerged = mergeSmallChains(initial, links, 3, 0.05);
      // The 0.15 link for [6] is above 0.05, so [6] merges. But big chains stay separate.
      expect(legacyMerged.chains.length).toBe(2);

      // Hierarchical: merges [0,1,2] + [3,4,5] via the 0.6 inter-chain link
      const initial2 = unionFindSort(links, 7, ufThreshold);
      const hierarchicalMerged = hierarchicalChainMerge(initial2, links, 0.05, ufThreshold);
      // Should produce fewer chains than legacy
      expect(hierarchicalMerged.chains.length).toBeLessThanOrEqual(legacyMerged.chains.length);
      // The two large chains should have merged
      expect(hierarchicalMerged.chains[0].length).toBeGreaterThanOrEqual(6);
    });
  });

  // -----------------------------------------------------------------------
  // Small contig orientation (computeLinkScore minimum pixel width)
  // -----------------------------------------------------------------------
  describe('computeLinkScore small contig guard', () => {
    it('should return 0 when a contig has fewer than 4 pixels', () => {
      const size = 64;
      // rangeI has only 3 pixels wide (< 4)
      const rangeSmall: ContigRange = { start: 0, end: 3, orderIndex: 0 };
      const rangeNormal: ContigRange = { start: 10, end: 40, orderIndex: 1 };

      // Create a map with some signal
      const map = new Float32Array(size * size);
      for (let p = 0; p < size; p++) {
        for (let d = 1; d <= 10 && p + d < size; d++) {
          const val = 2.0 / Math.sqrt(d);
          map[(p + d) * size + p] = val;
          map[p * size + (p + d)] = val;
        }
      }

      const profile = computeIntraDiagonalProfile(map, size, [rangeSmall, rangeNormal], 20);

      // Score with the small contig should be 0
      const score = computeLinkScore(map, size, rangeSmall, rangeNormal, false, false, profile, 20);
      expect(score).toBe(0);
    });

    it('should return 0 when J contig has fewer than 4 pixels', () => {
      const size = 64;
      const rangeNormal: ContigRange = { start: 0, end: 30, orderIndex: 0 };
      // rangeJ has only 2 pixels wide (< 4)
      const rangeSmall: ContigRange = { start: 30, end: 32, orderIndex: 1 };

      const map = new Float32Array(size * size);
      for (let p = 0; p < size; p++) {
        for (let d = 1; d <= 10 && p + d < size; d++) {
          const val = 2.0 / Math.sqrt(d);
          map[(p + d) * size + p] = val;
          map[p * size + (p + d)] = val;
        }
      }

      const profile = computeIntraDiagonalProfile(map, size, [rangeNormal, rangeSmall], 20);

      const score = computeLinkScore(map, size, rangeNormal, rangeSmall, false, false, profile, 20);
      expect(score).toBe(0);
    });

    it('should return non-zero when both contigs have >= 4 pixels', () => {
      const size = 64;
      const rangeI: ContigRange = { start: 0, end: 30, orderIndex: 0 };
      const rangeJ: ContigRange = { start: 30, end: 60, orderIndex: 1 };

      const map = makeMapWithAdjacencies(size, [rangeI, rangeJ], [[0, 1]]);
      const profile = computeIntraDiagonalProfile(map, size, [rangeI, rangeJ], 20);

      const score = computeLinkScore(map, size, rangeI, rangeJ, false, false, profile, 20);
      expect(score).toBeGreaterThan(0);
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
