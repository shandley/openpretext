import { describe, it, expect } from 'vitest';
import {
  detectChromosomeBlocks,
  type ChromosomeBlock,
  type ScaffoldDetectionResult,
} from '../../src/analysis/ScaffoldDetection';
import type { ContigInfo } from '../../src/core/State';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a block-diagonal contact map with bright squares along diagonal. */
function makeBlockDiagonalMap(size: number, blockSizes: number[]): Float32Array {
  const map = new Float32Array(size * size);
  let offset = 0;
  for (const blockSize of blockSizes) {
    for (let i = offset; i < offset + blockSize && i < size; i++) {
      for (let j = offset; j < offset + blockSize && j < size; j++) {
        // Strong signal within block (decays with distance from diagonal)
        const d = Math.abs(i - j);
        map[i * size + j] = d === 0 ? 1.0 : Math.max(0, 0.8 - d * 0.01);
      }
    }
    offset += blockSize;
  }
  // Add very faint inter-block signal (noise)
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (map[i * size + j] === 0) {
        map[i * size + j] = 0.001;
      }
    }
  }
  return map;
}

/** Create N equal contigs that tile the texture. */
function makeContigs(n: number, textureSize: number): ContigInfo[] {
  const contigs: ContigInfo[] = [];
  const pixelsPerContig = Math.floor(textureSize / n);
  for (let i = 0; i < n; i++) {
    contigs.push({
      name: `contig_${i}`,
      originalIndex: i,
      length: pixelsPerContig * 1000,
      pixelStart: i * pixelsPerContig,
      pixelEnd: (i + 1) * pixelsPerContig,
      inverted: false,
      scaffoldId: null,
    });
  }
  return contigs;
}

/** Simple identity contig order: [0, 1, 2, ...]. */
function makeOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// ---------------------------------------------------------------------------
// Tests: block detection
// ---------------------------------------------------------------------------

describe('ScaffoldDetection', () => {
  describe('detectChromosomeBlocks', () => {
    it('detects 2 blocks in a 2-chromosome map', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(8, size);
      const order = makeOrder(8);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(2);
      // First block: contigs 0-3 (pixels 0-31)
      expect(result.blocks[0].startIndex).toBe(0);
      expect(result.blocks[0].endIndex).toBeLessThanOrEqual(3);
      // Second block should start after first
      expect(result.blocks[1].startIndex).toBeGreaterThan(result.blocks[0].endIndex);
    });

    it('detects 3 blocks in a 3-chromosome map', () => {
      const size = 96;
      const map = makeBlockDiagonalMap(size, [32, 32, 32]);
      const contigs = makeContigs(12, size);
      const order = makeOrder(12);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(3);
      // Total contigs in all blocks should equal 12
      const totalContigs = result.blocks.reduce((sum, b) => sum + b.contigCount, 0);
      expect(totalContigs).toBe(12);
    });

    it('returns correct start/end indices per block', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(4, size);
      const order = makeOrder(4);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(2);
      // Blocks should be contiguous and cover all contigs
      expect(result.blocks[0].startIndex).toBe(0);
      expect(result.blocks[result.blocks.length - 1].endIndex).toBe(3);
      // Each block's endIndex+1 should equal next block's startIndex
      for (let i = 0; i < result.blocks.length - 1; i++) {
        expect(result.blocks[i + 1].startIndex).toBe(result.blocks[i].endIndex + 1);
      }
    });

    it('handles single contig (1 block)', () => {
      const size = 16;
      const map = makeBlockDiagonalMap(size, [16]);
      const contigs = makeContigs(1, size);
      const order = makeOrder(1);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0]).toEqual({
        startIndex: 0,
        endIndex: 0,
        contigCount: 1,
      });
      expect(result.interContigScores.length).toBe(0);
    });

    it('returns 1 block when all contigs are one chromosome', () => {
      const size = 64;
      // One big block covering the whole map
      const map = makeBlockDiagonalMap(size, [64]);
      const contigs = makeContigs(8, size);
      const order = makeOrder(8);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].startIndex).toBe(0);
      expect(result.blocks[0].endIndex).toBe(7);
      expect(result.blocks[0].contigCount).toBe(8);
    });

    it('handles empty contig order', () => {
      const size = 16;
      const map = new Float32Array(size * size);
      const contigs: ContigInfo[] = [];
      const order: number[] = [];

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      expect(result.blocks.length).toBe(0);
      expect(result.interContigScores.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: inter-contig scoring
  // ---------------------------------------------------------------------------

  describe('inter-contig scoring', () => {
    it('produces high scores within a block', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [64]);
      const contigs = makeContigs(4, size);
      const order = makeOrder(4);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // All scores should be high (close to 1) since all contigs are in one block
      for (let i = 0; i < result.interContigScores.length; i++) {
        expect(result.interContigScores[i]).toBeGreaterThan(0.5);
      }
    });

    it('produces low scores at chromosome boundaries', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(4, size);
      const order = makeOrder(4);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // Score at boundary (between contig 1 and 2) should be much lower
      // than within-block scores
      const withinScores = [result.interContigScores[0], result.interContigScores[2]];
      const boundaryScore = result.interContigScores[1];

      const meanWithin = withinScores.reduce((a, b) => a + b, 0) / withinScores.length;
      expect(boundaryScore).toBeLessThan(meanWithin * 0.5);
    });

    it('normalized scores are in [0, 1] range', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(8, size);
      const order = makeOrder(8);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      for (let i = 0; i < result.interContigScores.length; i++) {
        expect(result.interContigScores[i]).toBeGreaterThanOrEqual(0);
        expect(result.interContigScores[i]).toBeLessThanOrEqual(1);
      }
      // At least one score should be exactly 1 (the max)
      const max = Math.max(...result.interContigScores);
      expect(max).toBeCloseTo(1, 5);
    });

    it('handles zero-contact pairs gracefully', () => {
      const size = 32;
      const map = new Float32Array(size * size); // all zeros
      const contigs = makeContigs(4, size);
      const order = makeOrder(4);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // All scores should be 0
      for (let i = 0; i < result.interContigScores.length; i++) {
        expect(result.interContigScores[i]).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles contigs with very small pixel spans', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [64]);
      // 32 tiny contigs (2px each in a 64px texture)
      const contigs = makeContigs(32, size);
      const order = makeOrder(32);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // Should still produce some blocks without crashing
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      const totalContigs = result.blocks.reduce((sum, b) => sum + b.contigCount, 0);
      expect(totalContigs).toBe(32);
    });

    it('works with small overview (64px)', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(4, 128); // texture is 128, overview is 64
      const order = makeOrder(4);

      const result = detectChromosomeBlocks(map, size, contigs, order, 128);

      // Should detect the 2 blocks
      expect(result.blocks.length).toBe(2);
    });

    it('blocks are contiguous and cover all contigs', () => {
      const size = 128;
      const map = makeBlockDiagonalMap(size, [40, 48, 40]);
      const contigs = makeContigs(12, size);
      const order = makeOrder(12);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // Verify contiguous coverage
      expect(result.blocks[0].startIndex).toBe(0);
      expect(result.blocks[result.blocks.length - 1].endIndex).toBe(11);
      for (let i = 0; i < result.blocks.length - 1; i++) {
        expect(result.blocks[i + 1].startIndex).toBe(result.blocks[i].endIndex + 1);
      }
      // Total contigs across all blocks
      const total = result.blocks.reduce((sum, b) => sum + b.contigCount, 0);
      expect(total).toBe(12);
    });

    it('contigCount matches startIndex/endIndex span', () => {
      const size = 64;
      const map = makeBlockDiagonalMap(size, [32, 32]);
      const contigs = makeContigs(6, size);
      const order = makeOrder(6);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      for (const block of result.blocks) {
        expect(block.contigCount).toBe(block.endIndex - block.startIndex + 1);
      }
    });

    it('detects blocks with unequal sizes', () => {
      const size = 256;
      // 3 blocks: large (128px), medium (80px), small (48px) — larger map for clearer signal
      const map = makeBlockDiagonalMap(size, [128, 80, 48]);
      // Fewer contigs per block for stronger per-contig signal
      const contigs = makeContigs(6, size);
      const order = makeOrder(6);

      const result = detectChromosomeBlocks(map, size, contigs, order, size);

      // Should detect at least 2 blocks
      expect(result.blocks.length).toBeGreaterThanOrEqual(2);
    });
  });
});
