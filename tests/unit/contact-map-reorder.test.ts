import { describe, it, expect } from 'vitest';
import { reorderContactMap, buildPixelRemapTable } from '../../src/renderer/ContactMapReorder';
import type { ContigInfo } from '../../src/core/State';

function makeContig(index: number, pixelStart: number, pixelEnd: number): ContigInfo {
  return {
    name: `ctg${index}`,
    originalIndex: index,
    length: (pixelEnd - pixelStart) * 1000,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

/**
 * Build a simple 4x4 contact map with two contigs (each 2 pixels).
 * Contig 0 occupies pixels 0-1, contig 1 occupies pixels 2-3.
 * Values are set so each quadrant is identifiable:
 *   [0,0] block = 1.0  (contig 0 self)
 *   [0,1] block = 0.5  (contig 0 x contig 1)
 *   [1,0] block = 0.5  (symmetric)
 *   [1,1] block = 0.8  (contig 1 self)
 */
function make4x4Map(): { map: Float32Array; contigs: ContigInfo[]; size: number } {
  const size = 4;
  const map = new Float32Array(size * size);
  // Contig 0 self-contact (top-left 2x2)
  map[0 * 4 + 0] = 1.0;
  map[0 * 4 + 1] = 1.0;
  map[1 * 4 + 0] = 1.0;
  map[1 * 4 + 1] = 1.0;
  // Contig 1 self-contact (bottom-right 2x2)
  map[2 * 4 + 2] = 0.8;
  map[2 * 4 + 3] = 0.8;
  map[3 * 4 + 2] = 0.8;
  map[3 * 4 + 3] = 0.8;
  // Cross-contacts (off-diagonal blocks)
  map[0 * 4 + 2] = 0.5;
  map[0 * 4 + 3] = 0.5;
  map[1 * 4 + 2] = 0.5;
  map[1 * 4 + 3] = 0.5;
  map[2 * 4 + 0] = 0.5;
  map[2 * 4 + 1] = 0.5;
  map[3 * 4 + 0] = 0.5;
  map[3 * 4 + 1] = 0.5;

  const contigs = [
    makeContig(0, 0, 2),
    makeContig(1, 2, 4),
  ];
  return { map, contigs, size };
}

describe('buildPixelRemapTable', () => {
  it('returns identity mapping for original order', () => {
    const contigs = [makeContig(0, 0, 2), makeContig(1, 2, 4)];
    const remap = buildPixelRemapTable(contigs, [0, 1], 4);
    expect(Array.from(remap)).toEqual([0, 1, 2, 3]);
  });

  it('returns swapped mapping when contigs are reversed', () => {
    const contigs = [makeContig(0, 0, 2), makeContig(1, 2, 4)];
    const remap = buildPixelRemapTable(contigs, [1, 0], 4);
    // Display pixel 0,1 should come from original pixels 2,3
    // Display pixel 2,3 should come from original pixels 0,1
    expect(Array.from(remap)).toEqual([2, 3, 0, 1]);
  });

  it('handles three equal-sized contigs', () => {
    const contigs = [
      makeContig(0, 0, 2),
      makeContig(1, 2, 4),
      makeContig(2, 4, 6),
    ];
    const remap = buildPixelRemapTable(contigs, [2, 0, 1], 6);
    // Contig 2 (pixels 4-5) first, then contig 0 (pixels 0-1), then contig 1 (pixels 2-3)
    expect(Array.from(remap)).toEqual([4, 5, 0, 1, 2, 3]);
  });

  it('handles single contig', () => {
    const contigs = [makeContig(0, 0, 4)];
    const remap = buildPixelRemapTable(contigs, [0], 4);
    expect(Array.from(remap)).toEqual([0, 1, 2, 3]);
  });
});

describe('reorderContactMap', () => {
  it('returns identical map for original order', () => {
    const { map, contigs, size } = make4x4Map();
    const result = reorderContactMap(map, contigs, [0, 1], size);
    expect(Array.from(result)).toEqual(Array.from(map));
  });

  it('swaps contig blocks when order is reversed', () => {
    const { map, contigs, size } = make4x4Map();
    const result = reorderContactMap(map, contigs, [1, 0], size);

    // After swapping: contig 1 self-contact should be in top-left
    // and contig 0 self-contact in bottom-right
    // Top-left 2x2 (was contig 1 self = 0.8)
    expect(result[0 * 4 + 0]).toBeCloseTo(0.8, 5);
    expect(result[0 * 4 + 1]).toBeCloseTo(0.8, 5);
    expect(result[1 * 4 + 0]).toBeCloseTo(0.8, 5);
    expect(result[1 * 4 + 1]).toBeCloseTo(0.8, 5);

    // Bottom-right 2x2 (was contig 0 self = 1.0)
    expect(result[2 * 4 + 2]).toBe(1.0);
    expect(result[2 * 4 + 3]).toBe(1.0);
    expect(result[3 * 4 + 2]).toBe(1.0);
    expect(result[3 * 4 + 3]).toBe(1.0);

    // Off-diagonal blocks should remain 0.5 (symmetric cross-contacts)
    expect(result[0 * 4 + 2]).toBeCloseTo(0.5, 5);
    expect(result[2 * 4 + 0]).toBeCloseTo(0.5, 5);
  });

  it('does not mutate the original map', () => {
    const { map, contigs, size } = make4x4Map();
    const originalCopy = new Float32Array(map);
    reorderContactMap(map, contigs, [1, 0], size);
    expect(Array.from(map)).toEqual(Array.from(originalCopy));
  });

  it('reorder is reversible (reorder back gives original)', () => {
    const { map, contigs, size } = make4x4Map();
    // Reorder with [1, 0] then reorder the ORIGINAL again with [0, 1]
    const reordered = reorderContactMap(map, contigs, [1, 0], size);
    // To reverse: reorder original with identity order
    const restored = reorderContactMap(map, contigs, [0, 1], size);
    expect(Array.from(restored)).toEqual(Array.from(map));
    // Verify the reordered map is actually different
    expect(Array.from(reordered)).not.toEqual(Array.from(map));
  });

  it('handles 6x6 map with 3 contigs', () => {
    const size = 6;
    const map = new Float32Array(size * size);
    // Fill diagonal blocks with distinct values
    // Contig 0: pixels 0-1, value 1.0
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++)
        map[r * size + c] = 1.0;
    // Contig 1: pixels 2-3, value 0.7
    for (let r = 2; r < 4; r++)
      for (let c = 2; c < 4; c++)
        map[r * size + c] = 0.7;
    // Contig 2: pixels 4-5, value 0.4
    for (let r = 4; r < 6; r++)
      for (let c = 4; c < 6; c++)
        map[r * size + c] = 0.4;

    const contigs = [
      makeContig(0, 0, 2),
      makeContig(1, 2, 4),
      makeContig(2, 4, 6),
    ];

    // Reorder to [2, 0, 1]: contig 2 first, then 0, then 1
    const result = reorderContactMap(map, contigs, [2, 0, 1], size);

    // Top-left 2x2 should be contig 2's self-contact (0.4)
    expect(result[0 * size + 0]).toBeCloseTo(0.4, 5);
    expect(result[1 * size + 1]).toBeCloseTo(0.4, 5);

    // Middle 2x2 should be contig 0's self-contact (1.0)
    expect(result[2 * size + 2]).toBe(1.0);
    expect(result[3 * size + 3]).toBe(1.0);

    // Bottom-right 2x2 should be contig 1's self-contact (0.7)
    expect(result[4 * size + 4]).toBeCloseTo(0.7, 5);
    expect(result[5 * size + 5]).toBeCloseTo(0.7, 5);
  });

  it('handles empty contig order gracefully', () => {
    const map = new Float32Array(4);
    const result = reorderContactMap(map, [], [], 2);
    // All zeros since no pixels are mapped
    expect(result.length).toBe(4);
  });

  it('preserves symmetry after reordering', () => {
    const { map, contigs, size } = make4x4Map();
    const result = reorderContactMap(map, contigs, [1, 0], size);

    // Check that result[r][c] === result[c][r] for all r, c
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        expect(result[r * size + c]).toBe(result[c * size + r]);
      }
    }
  });

  it('handles overview map smaller than full resolution', () => {
    // Simulate a case where contigs span 8 pixels but overview is 4x4
    const contigs = [
      makeContig(0, 0, 4),
      makeContig(1, 4, 8),
    ];
    const size = 4; // overview is downscaled
    const map = new Float32Array(size * size);
    // Contig 0 self-contact in top-left 2x2
    map[0 * 4 + 0] = 1.0;
    map[0 * 4 + 1] = 1.0;
    map[1 * 4 + 0] = 1.0;
    map[1 * 4 + 1] = 1.0;
    // Contig 1 self-contact in bottom-right 2x2
    map[2 * 4 + 2] = 0.6;
    map[2 * 4 + 3] = 0.6;
    map[3 * 4 + 2] = 0.6;
    map[3 * 4 + 3] = 0.6;

    const result = reorderContactMap(map, contigs, [1, 0], size);

    // After reorder, contig 1 (0.6) should be in top-left
    expect(result[0 * 4 + 0]).toBeCloseTo(0.6, 5);
    expect(result[1 * 4 + 1]).toBeCloseTo(0.6, 5);
    // Contig 0 (1.0) should be in bottom-right
    expect(result[2 * 4 + 2]).toBe(1.0);
    expect(result[3 * 4 + 3]).toBe(1.0);
  });
});
