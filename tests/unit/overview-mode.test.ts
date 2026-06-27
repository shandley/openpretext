/**
 * overview-mode.test.ts — assembleOverview clean vs faithful.
 *
 * Verifies the core fix: sparse contacts that the file's coarse mip averages to
 * zero (so the 'clean' overview is empty) are preserved by 'faithful' mode's
 * max-pool from a finer mip — making the overview agree with the detail layer.
 */

import { describe, it, expect } from 'vitest';
import { assembleOverview, type PretextHeader } from '../../src/formats/PretextParser';

// A BC4 block: [a0, a1, 6 bytes of 3-bit palette indices]. With a0=255, a1=0
// (so a0>a1) and all indices 0, every pixel decodes to palette[0]=255 → 1.0.
const HOT_BLOCK = [255, 0, 0, 0, 0, 0, 0, 0];
const EMPTY_BLOCK = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Build a single 8x8 tile (one tile, n1d=1) with two mip levels:
 *   level 0 (8x8): top-left 4x4 block hot, rest empty
 *   level 1 (4x4): empty  (mimics the file's coarse mip dropping a sparse contact)
 * Block iteration order is outer bx, inner by (PretextMap layout).
 */
function makeTile(): Uint8Array {
  const level0 = [
    ...HOT_BLOCK,    // (bx0, by0) → top-left 4x4
    ...EMPTY_BLOCK,  // (bx0, by1)
    ...EMPTY_BLOCK,  // (bx1, by0)
    ...EMPTY_BLOCK,  // (bx1, by1)
  ];
  const level1 = [...EMPTY_BLOCK]; // 4x4 = one block, empty
  return new Uint8Array([...level0, ...level1]);
}

const HEADER: PretextHeader = {
  totalGenomeLength: 0n,
  numberOfContigs: 1,
  textureRes: 3,            // 1<<3 = 8
  nTextRes: 0,              // 1<<0 = 1 tile per dim
  mipMapLevels: 2,
  textureResolution: 8,
  numberOfTextures1D: 1,
  numberOfPixels1D: 8,
  numberOfTextureBlocks: 1,
  bytesPerTexture: 40,
};

describe('assembleOverview', () => {
  it('clean mode decodes the coarsest mip (sparse contact dropped → empty)', () => {
    const { overview, overviewSize } = assembleOverview([makeTile()], HEADER, 'clean');
    expect(overviewSize).toBe(4); // n1d * coarsestRes = 1 * 4
    expect(overview.every((v) => v === 0)).toBe(true);
  });

  it('faithful mode max-pools a finer mip (sparse contact preserved)', () => {
    const { overview, overviewSize } = assembleOverview([makeTile()], HEADER, 'faithful');
    expect(overviewSize).toBe(4);
    // The hot top-left 4x4 of the 8x8 level-0, max-pooled 2x → a 2x2 hot corner.
    const at = (x: number, y: number) => overview[y * overviewSize + x];
    expect(at(0, 0)).toBeCloseTo(1, 5);
    expect(at(1, 1)).toBeCloseTo(1, 5);
    expect(at(2, 2)).toBe(0); // outside the hot region
    // Faithful shows signal exactly where clean is empty.
    expect(overview.some((v) => v > 0)).toBe(true);
  });

  it('faithful overview dominates clean everywhere (max-pool never loses signal)', () => {
    const clean = assembleOverview([makeTile()], HEADER, 'clean').overview;
    const faithful = assembleOverview([makeTile()], HEADER, 'faithful').overview;
    for (let i = 0; i < clean.length; i++) {
      expect(faithful[i]).toBeGreaterThanOrEqual(clean[i]);
    }
  });

  it('produces a symmetric overview', () => {
    const { overview, overviewSize } = assembleOverview([makeTile()], HEADER, 'faithful');
    for (let y = 0; y < overviewSize; y++) {
      for (let x = 0; x < overviewSize; x++) {
        expect(overview[y * overviewSize + x]).toBe(overview[x * overviewSize + y]);
      }
    }
  });
});
