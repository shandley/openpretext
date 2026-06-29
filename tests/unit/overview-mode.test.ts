/**
 * overview-mode.test.ts — assembleOverview clean vs faithful.
 *
 * Verifies the core behaviour: 'clean' decodes the coarsest mip (so contacts the
 * file averaged away are absent), while 'faithful' assembles a *finer* mip at its
 * native resolution (a larger overview) that preserves those contacts — without
 * the flooding that max-pooling to the coarse grid would cause.
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

  it('faithful mode assembles a finer mip at native resolution (contact preserved)', () => {
    const { overview, overviewSize } = assembleOverview([makeTile()], HEADER, 'faithful');
    // Finer mip (level 0, 8x8) fits the size cap, so the overview is larger.
    expect(overviewSize).toBe(8);
    // Level-0 has the top-left 4x4 hot; values are shown at native res (no pool).
    const at = (x: number, y: number) => overview[y * overviewSize + x];
    expect(at(0, 0)).toBeCloseTo(1, 5);
    expect(at(3, 3)).toBeCloseTo(1, 5);
    expect(at(4, 4)).toBe(0); // outside the hot 4x4 region
    expect(at(7, 7)).toBe(0);
  });

  it('faithful carries signal that clean (coarsest mip) drops entirely', () => {
    const cleanSum = assembleOverview([makeTile()], HEADER, 'clean').overview
      .reduce((s, v) => s + v, 0);
    const faithfulSum = assembleOverview([makeTile()], HEADER, 'faithful').overview
      .reduce((s, v) => s + v, 0);
    expect(cleanSum).toBe(0);
    expect(faithfulSum).toBeGreaterThan(0);
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
