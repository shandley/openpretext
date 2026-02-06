import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { SelectionManager } from '../../src/curation/SelectionManager';
import {
  selectByPattern,
  selectBySize,
  batchCutBySize,
  batchJoinSelected,
  batchInvertSelected,
  sortByLength,
} from '../../src/curation/BatchOperations';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal MapData with the given contigs for testing.
 */
function makeTestMap(contigs: ContigInfo[]): MapData {
  const lastContig = contigs[contigs.length - 1];
  return {
    filename: 'test.pretext',
    textureSize: lastContig ? lastContig.pixelEnd : 0,
    numMipMaps: 1,
    tileResolution: 1024,
    tilesPerDimension: 1,
    contigs,
    contactMap: null,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

/**
 * Create a simple ContigInfo for testing.
 */
function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length: number
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
 * Set up a standard test state with named contigs of known sizes.
 * Creates 5 contigs with different names and sizes for pattern/size testing.
 */
function setupState(
  contigs: Array<{ name: string; length: number; pixelStart: number; pixelEnd: number }>
): void {
  const contigInfos = contigs.map((c, i) => makeContig(c.name, i, c.pixelStart, c.pixelEnd, c.length));
  const map = makeTestMap(contigInfos);
  state.update({
    map,
    contigOrder: contigs.map((_, i) => i),
    undoStack: [],
    redoStack: [],
  });
}

/**
 * Standard 5-contig state with varied names and sizes.
 */
function setupStandardState(): void {
  setupState([
    { name: 'chr1',       length: 50000, pixelStart: 0,   pixelEnd: 100 },
    { name: 'chr2',       length: 30000, pixelStart: 100, pixelEnd: 200 },
    { name: 'chr3',       length: 10000, pixelStart: 200, pixelEnd: 300 },
    { name: 'scaffold_1', length: 5000,  pixelStart: 300, pixelEnd: 350 },
    { name: 'scaffold_2', length: 2000,  pixelStart: 350, pixelEnd: 400 },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BatchOperations', () => {
  beforeEach(() => {
    state.reset();
  });

  // -----------------------------------------------------------------------
  // selectByPattern
  // -----------------------------------------------------------------------
  describe('selectByPattern', () => {
    it('should match contigs using wildcard pattern', () => {
      setupStandardState();

      const matches = selectByPattern('chr*');
      expect(matches).toEqual([0, 1, 2]);
    });

    it('should match contigs using wildcard in the middle', () => {
      setupStandardState();

      const matches = selectByPattern('scaffold_*');
      expect(matches).toEqual([3, 4]);
    });

    it('should match contigs with exact name', () => {
      setupStandardState();

      const matches = selectByPattern('chr2');
      expect(matches).toEqual([1]);
    });

    it('should return empty array when no contigs match', () => {
      setupStandardState();

      const matches = selectByPattern('unknown*');
      expect(matches).toEqual([]);
    });

    it('should match all contigs with *', () => {
      setupStandardState();

      const matches = selectByPattern('*');
      expect(matches).toEqual([0, 1, 2, 3, 4]);
    });

    it('should match contigs with trailing wildcard', () => {
      setupStandardState();

      const matches = selectByPattern('*2');
      expect(matches).toEqual([1, 4]); // chr2 and scaffold_2
    });

    it('should return empty array when no map is loaded', () => {
      const matches = selectByPattern('*');
      expect(matches).toEqual([]);
    });

    it('should handle special regex characters in names', () => {
      setupState([
        { name: 'contig.1', length: 1000, pixelStart: 0, pixelEnd: 100 },
        { name: 'contig_1', length: 1000, pixelStart: 100, pixelEnd: 200 },
      ]);

      // The dot should be treated literally, not as a regex wildcard
      const matches = selectByPattern('contig.1');
      expect(matches).toEqual([0]);
    });
  });

  // -----------------------------------------------------------------------
  // selectBySize
  // -----------------------------------------------------------------------
  describe('selectBySize', () => {
    it('should filter contigs by minimum size', () => {
      setupStandardState();

      const matches = selectBySize(10000);
      // chr1 (50000), chr2 (30000), chr3 (10000)
      expect(matches).toEqual([0, 1, 2]);
    });

    it('should filter contigs by maximum size', () => {
      setupStandardState();

      const matches = selectBySize(undefined, 5000);
      // scaffold_1 (5000), scaffold_2 (2000)
      expect(matches).toEqual([3, 4]);
    });

    it('should filter contigs by both min and max size', () => {
      setupStandardState();

      const matches = selectBySize(5000, 30000);
      // chr2 (30000), chr3 (10000), scaffold_1 (5000)
      expect(matches).toEqual([1, 2, 3]);
    });

    it('should return all contigs when no bounds specified', () => {
      setupStandardState();

      const matches = selectBySize();
      expect(matches).toEqual([0, 1, 2, 3, 4]);
    });

    it('should return empty array when no contigs match', () => {
      setupStandardState();

      const matches = selectBySize(100000);
      expect(matches).toEqual([]);
    });

    it('should return empty array when no map is loaded', () => {
      const matches = selectBySize(0, 100000);
      expect(matches).toEqual([]);
    });

    it('should include boundary values (inclusive range)', () => {
      setupStandardState();

      // Exact match on boundary: scaffold_1 has exactly 5000 bp
      const matches = selectBySize(5000, 5000);
      expect(matches).toEqual([3]);
    });
  });

  // -----------------------------------------------------------------------
  // batchCutBySize
  // -----------------------------------------------------------------------
  describe('batchCutBySize', () => {
    it('should cut contigs larger than threshold at midpoint', () => {
      setupState([
        { name: 'big',   length: 20000, pixelStart: 0,   pixelEnd: 200 },
        { name: 'small', length: 5000,  pixelStart: 200, pixelEnd: 250 },
        { name: 'big2',  length: 15000, pixelStart: 250, pixelEnd: 400 },
      ]);

      const result = batchCutBySize(10000);

      expect(result.operationsPerformed).toBe(2);

      const s = state.get();
      // Originally 3 contigs, each cut adds 1 (replace 1 with 2), so 3 + 2 = 5
      expect(s.contigOrder.length).toBe(5);
    });

    it('should return correct operation count', () => {
      setupStandardState();

      // Only chr1 (50000) and chr2 (30000) are > 25000
      const result = batchCutBySize(25000);
      expect(result.operationsPerformed).toBe(2);
    });

    it('should not cut contigs at or below the threshold', () => {
      setupState([
        { name: 'exact', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'small', length: 5000,  pixelStart: 100, pixelEnd: 150 },
      ]);

      const result = batchCutBySize(10000);
      expect(result.operationsPerformed).toBe(0);

      const s = state.get();
      expect(s.contigOrder.length).toBe(2);
    });

    it('should cut at midpoint pixel positions', () => {
      setupState([
        { name: 'big', length: 20000, pixelStart: 0, pixelEnd: 200 },
      ]);

      batchCutBySize(10000);

      const s = state.get();
      expect(s.contigOrder.length).toBe(2);

      const leftId = s.contigOrder[0];
      const rightId = s.contigOrder[1];
      const left = s.map!.contigs[leftId];
      const right = s.map!.contigs[rightId];

      // 200 pixel contig cut at midpoint = 100
      expect(left.pixelEnd - left.pixelStart).toBe(100);
      expect(right.pixelEnd - right.pixelStart).toBe(100);
    });

    it('should record individual operations on the undo stack', () => {
      setupState([
        { name: 'big1', length: 20000, pixelStart: 0,   pixelEnd: 200 },
        { name: 'big2', length: 15000, pixelStart: 200, pixelEnd: 350 },
      ]);

      batchCutBySize(10000);

      const s = state.get();
      expect(s.undoStack.length).toBe(2);
      expect(s.undoStack[0].type).toBe('cut');
      expect(s.undoStack[1].type).toBe('cut');
    });

    it('should return descriptive result when no map is loaded', () => {
      const result = batchCutBySize(10000);
      expect(result.operationsPerformed).toBe(0);
      expect(result.description).toBe('No map loaded');
    });

    it('should handle processing right to left correctly', () => {
      setupState([
        { name: 'small', length: 5000,  pixelStart: 0,   pixelEnd: 50 },
        { name: 'big1',  length: 20000, pixelStart: 50,  pixelEnd: 250 },
        { name: 'big2',  length: 15000, pixelStart: 250, pixelEnd: 400 },
      ]);

      const result = batchCutBySize(10000);
      expect(result.operationsPerformed).toBe(2);

      const s = state.get();
      // small (untouched) + big1_L + big1_R + big2_L + big2_R = 5
      expect(s.contigOrder.length).toBe(5);
      // First contig should still be 'small' (untouched)
      expect(s.map!.contigs[s.contigOrder[0]].name).toBe('small');
    });
  });

  // -----------------------------------------------------------------------
  // batchJoinSelected
  // -----------------------------------------------------------------------
  describe('batchJoinSelected', () => {
    it('should join contiguous selected contigs', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
        { name: 'c3', length: 10000, pixelStart: 200, pixelEnd: 300 },
        { name: 'c4', length: 10000, pixelStart: 300, pixelEnd: 400 },
      ]);

      // Select contigs at indices 1, 2 (contiguous pair)
      state.update({ selectedContigs: new Set([1, 2]) });

      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(1);

      const s = state.get();
      // 4 - 1 = 3 contigs remaining
      expect(s.contigOrder.length).toBe(3);
    });

    it('should join a full contiguous run into one contig', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
        { name: 'c3', length: 10000, pixelStart: 200, pixelEnd: 300 },
      ]);

      // Select all three (contiguous run of 3 = 2 joins)
      state.update({ selectedContigs: new Set([0, 1, 2]) });

      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(2);

      const s = state.get();
      expect(s.contigOrder.length).toBe(1);
    });

    it('should handle non-contiguous selections (only join within runs)', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
        { name: 'c3', length: 10000, pixelStart: 200, pixelEnd: 300 },
        { name: 'c4', length: 10000, pixelStart: 300, pixelEnd: 400 },
        { name: 'c5', length: 10000, pixelStart: 400, pixelEnd: 500 },
      ]);

      // Select indices 0, 1, 3, 4 => two runs: [0,1] and [3,4]
      state.update({ selectedContigs: new Set([0, 1, 3, 4]) });

      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(2);

      const s = state.get();
      // 5 - 2 = 3 contigs remaining
      expect(s.contigOrder.length).toBe(3);
    });

    it('should return 0 operations when fewer than 2 contigs selected', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0, pixelEnd: 100 },
      ]);

      state.update({ selectedContigs: new Set([0]) });

      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(0);
    });

    it('should return 0 operations when no contigs are adjacent', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
        { name: 'c3', length: 10000, pixelStart: 200, pixelEnd: 300 },
      ]);

      // Select indices 0 and 2 (not adjacent)
      state.update({ selectedContigs: new Set([0, 2]) });

      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(0);
    });

    it('should return descriptive result when no map is loaded', () => {
      const result = batchJoinSelected();
      expect(result.operationsPerformed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // batchInvertSelected
  // -----------------------------------------------------------------------
  describe('batchInvertSelected', () => {
    it('should invert all selected contigs', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
        { name: 'c3', length: 10000, pixelStart: 200, pixelEnd: 300 },
      ]);

      state.update({ selectedContigs: new Set([0, 2]) });

      const result = batchInvertSelected();
      expect(result.operationsPerformed).toBe(2);

      const s = state.get();
      const contig0 = s.map!.contigs[s.contigOrder[0]];
      const contig1 = s.map!.contigs[s.contigOrder[1]];
      const contig2 = s.map!.contigs[s.contigOrder[2]];

      expect(contig0.inverted).toBe(true);
      expect(contig1.inverted).toBe(false);
      expect(contig2.inverted).toBe(true);
    });

    it('should return 0 operations when nothing is selected', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0, pixelEnd: 100 },
      ]);

      const result = batchInvertSelected();
      expect(result.operationsPerformed).toBe(0);
    });

    it('should record individual invert operations on undo stack', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
      ]);

      state.update({ selectedContigs: new Set([0, 1]) });
      batchInvertSelected();

      const s = state.get();
      expect(s.undoStack.length).toBe(2);
      expect(s.undoStack[0].type).toBe('invert');
      expect(s.undoStack[1].type).toBe('invert');
    });

    it('should invert a single selected contig', () => {
      setupState([
        { name: 'c1', length: 10000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'c2', length: 10000, pixelStart: 100, pixelEnd: 200 },
      ]);

      state.update({ selectedContigs: new Set([1]) });
      const result = batchInvertSelected();
      expect(result.operationsPerformed).toBe(1);

      const s = state.get();
      expect(s.map!.contigs[s.contigOrder[0]].inverted).toBe(false);
      expect(s.map!.contigs[s.contigOrder[1]].inverted).toBe(true);
    });

    it('should return descriptive result when no map is loaded', () => {
      const result = batchInvertSelected();
      expect(result.operationsPerformed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // sortByLength
  // -----------------------------------------------------------------------
  describe('sortByLength', () => {
    it('should sort contigs by length in ascending order', () => {
      setupState([
        { name: 'big',    length: 50000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'medium', length: 20000, pixelStart: 100, pixelEnd: 200 },
        { name: 'small',  length: 5000,  pixelStart: 200, pixelEnd: 300 },
      ]);

      const result = sortByLength(false);
      expect(result.operationsPerformed).toBeGreaterThan(0);

      const s = state.get();
      const lengths = s.contigOrder.map(id => s.map!.contigs[id].length);
      // Ascending: 5000, 20000, 50000
      expect(lengths).toEqual([5000, 20000, 50000]);
    });

    it('should sort contigs by length in descending order', () => {
      setupState([
        { name: 'small',  length: 5000,  pixelStart: 0,   pixelEnd: 50 },
        { name: 'medium', length: 20000, pixelStart: 50,  pixelEnd: 200 },
        { name: 'big',    length: 50000, pixelStart: 200, pixelEnd: 400 },
      ]);

      const result = sortByLength(true);
      expect(result.operationsPerformed).toBeGreaterThan(0);

      const s = state.get();
      const lengths = s.contigOrder.map(id => s.map!.contigs[id].length);
      // Descending: 50000, 20000, 5000
      expect(lengths).toEqual([50000, 20000, 5000]);
    });

    it('should perform 0 moves when already sorted', () => {
      setupState([
        { name: 'small',  length: 5000,  pixelStart: 0,   pixelEnd: 50 },
        { name: 'medium', length: 20000, pixelStart: 50,  pixelEnd: 200 },
        { name: 'big',    length: 50000, pixelStart: 200, pixelEnd: 400 },
      ]);

      const result = sortByLength(false); // ascending, already sorted
      expect(result.operationsPerformed).toBe(0);
    });

    it('should record individual move operations on the undo stack', () => {
      setupState([
        { name: 'big',    length: 50000, pixelStart: 0,   pixelEnd: 100 },
        { name: 'medium', length: 20000, pixelStart: 100, pixelEnd: 200 },
        { name: 'small',  length: 5000,  pixelStart: 200, pixelEnd: 300 },
      ]);

      sortByLength(false);

      const s = state.get();
      // Each move is a separate undo operation
      for (const op of s.undoStack) {
        expect(op.type).toBe('move');
      }
    });

    it('should return descriptive result when no map is loaded', () => {
      const result = sortByLength();
      expect(result.operationsPerformed).toBe(0);
    });

    it('should handle single contig (no moves needed)', () => {
      setupState([
        { name: 'only', length: 10000, pixelStart: 0, pixelEnd: 100 },
      ]);

      const result = sortByLength(false);
      expect(result.operationsPerformed).toBe(0);
    });

    it('should correctly sort 5 contigs of varied sizes', () => {
      setupStandardState();

      sortByLength(false);

      const s = state.get();
      const lengths = s.contigOrder.map(id => s.map!.contigs[id].length);
      expect(lengths).toEqual([2000, 5000, 10000, 30000, 50000]);
    });
  });

  // -----------------------------------------------------------------------
  // batchId tagging
  // -----------------------------------------------------------------------
  describe('batchId tagging', () => {
    it('autoCutContigs tags operations with batchId', async () => {
      const { autoCutContigs } = await import('../../src/curation/BatchOperations');

      const size = 128;
      const contigs = [
        makeContig('chr1', 0, 0, 64, 64000),
        makeContig('chr2', 1, 64, 128, 64000),
      ];

      // Create map with a clear gap at pixel 32 (middle of chr1)
      const map = new Float32Array(size * size);
      for (let i = 0; i < size; i++) {
        for (let d = 1; d <= 10; d++) {
          if (i + d < size) {
            const inGap = (i >= 28 && i < 36) || (i + d >= 28 && i + d < 36);
            const val = inGap ? 0 : 1.0;
            map[(i + d) * size + i] = val;
            map[i * size + (i + d)] = val;
          }
        }
      }

      const testMap = makeTestMap([contigs[0], contigs[1]]);
      testMap.contactMap = map;
      testMap.textureSize = size;

      state.update({
        map: testMap,
        contigOrder: [0, 1],
        undoStack: [],
        redoStack: [],
      });

      const result = autoCutContigs({
        cutThreshold: 0.05,
        windowSize: 4,
        minFragmentSize: 4,
      });

      if (result.operationsPerformed > 0) {
        expect(result.batchId).toBeDefined();
        expect(result.batchId).toMatch(/^autocut-/);

        const s = state.get();
        for (const op of s.undoStack) {
          expect(op.batchId).toBe(result.batchId);
          expect(op.data.algorithm).toBe('autocut');
        }
      }
    });

    it('autoSortContigs tags operations with batchId', async () => {
      const { autoSortContigs } = await import('../../src/curation/BatchOperations');

      const size = 64;
      const contigs = [
        makeContig('b', 0, 0, 16, 16000),
        makeContig('a', 1, 16, 32, 16000),
        makeContig('d', 2, 32, 48, 16000),
        makeContig('c', 3, 48, 64, 16000),
      ];

      // Create map with inter-contig signal for adjacent pairs
      const map = new Float32Array(size * size);
      for (let i = 0; i < size; i++) {
        for (let d = 1; d <= 10; d++) {
          if (i + d < size) {
            map[(i + d) * size + i] = 2.0 / Math.sqrt(d);
            map[i * size + (i + d)] = 2.0 / Math.sqrt(d);
          }
        }
      }

      const testMap = makeTestMap(contigs);
      testMap.contactMap = map;
      testMap.textureSize = size;

      state.update({
        map: testMap,
        contigOrder: [0, 1, 2, 3],
        undoStack: [],
        redoStack: [],
      });

      const result = autoSortContigs({
        maxDiagonalDistance: 10,
        signalCutoff: 0.01,
        hardThreshold: 0.01,
      });

      if (result.operationsPerformed > 0) {
        expect(result.batchId).toBeDefined();
        expect(result.batchId).toMatch(/^autosort-/);

        const s = state.get();
        for (const op of s.undoStack) {
          expect(op.batchId).toBe(result.batchId);
          expect(op.data.algorithm).toBe('autosort');
        }
      }
    });
  });
});
