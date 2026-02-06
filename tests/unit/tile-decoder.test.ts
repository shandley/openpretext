import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tileManagerLevelToParserLevel,
  levelResolution,
  bc4LevelOffset,
  decodeTile,
  decodeTileBatch,
} from '../../src/renderer/TileDecoder';
import type { PretextHeader } from '../../src/formats/PretextParser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PretextHeader for testing.
 * Defaults match a typical file: textureRes=10 (1024), nTextRes=5 (32 tiles),
 * mipMapLevels=6 (1024, 512, 256, 128, 64, 32).
 */
function makeHeader(overrides?: Partial<PretextHeader>): PretextHeader {
  const textureResolution = overrides?.textureResolution ?? 1024;
  const numberOfTextures1D = overrides?.numberOfTextures1D ?? 32;
  const mipMapLevels = overrides?.mipMapLevels ?? 6;
  return {
    totalGenomeLength: BigInt(0),
    numberOfContigs: 0,
    textureRes: Math.log2(textureResolution),
    nTextRes: Math.log2(numberOfTextures1D),
    mipMapLevels,
    textureResolution,
    numberOfTextures1D,
    numberOfPixels1D: textureResolution * numberOfTextures1D,
    numberOfTextureBlocks: ((numberOfTextures1D + 1) * numberOfTextures1D) >> 1,
    bytesPerTexture: 0, // not used in decoder
    ...overrides,
  };
}

/**
 * Create a minimal BC4 tile that decodes to a known pattern.
 * For testing we create data large enough for all mipmap levels but
 * filled with zeros (BC4 blocks of all-zero decode to 0.0).
 */
function makeRawTile(header: PretextHeader): Uint8Array {
  let totalBytes = 0;
  let res = header.textureResolution;
  for (let i = 0; i < header.mipMapLevels; i++) {
    totalBytes += (res * res) >> 1;
    res >>= 1;
  }
  return new Uint8Array(totalBytes);
}

/**
 * Create a BC4 tile with a recognizable constant value.
 * Each BC4 block has alpha0=val, alpha1=val, indices all 0 → all pixels = val.
 */
function makeConstantRawTile(header: PretextHeader, byteVal: number): Uint8Array {
  const tile = makeRawTile(header);
  // Fill BC4 blocks: each block is 8 bytes
  // byte 0 = alpha0 = val, byte 1 = alpha1 = val, bytes 2-7 = 0 (index 0)
  for (let i = 0; i < tile.length; i += 8) {
    tile[i] = byteVal;
    tile[i + 1] = byteVal;
    // indices remain 0
  }
  return tile;
}

// ---------------------------------------------------------------------------
// Level mapping
// ---------------------------------------------------------------------------

describe('tileManagerLevelToParserLevel', () => {
  it('should map TM level 0 (coarsest) to parser level numMipMaps-1 (coarsest)', () => {
    expect(tileManagerLevelToParserLevel(0, 6)).toBe(5);
  });

  it('should map TM level numMipMaps-1 (finest) to parser level 0 (finest)', () => {
    expect(tileManagerLevelToParserLevel(5, 6)).toBe(0);
  });

  it('should map intermediate levels correctly', () => {
    // numMipMaps = 6: TM 0→5, 1→4, 2→3, 3→2, 4→1, 5→0
    expect(tileManagerLevelToParserLevel(1, 6)).toBe(4);
    expect(tileManagerLevelToParserLevel(2, 6)).toBe(3);
    expect(tileManagerLevelToParserLevel(3, 6)).toBe(2);
    expect(tileManagerLevelToParserLevel(4, 6)).toBe(1);
  });

  it('should handle numMipMaps = 1 (single level)', () => {
    expect(tileManagerLevelToParserLevel(0, 1)).toBe(0);
  });

  it('should work for typical values (mipMapLevels=8)', () => {
    expect(tileManagerLevelToParserLevel(0, 8)).toBe(7);
    expect(tileManagerLevelToParserLevel(7, 8)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution computation
// ---------------------------------------------------------------------------

describe('levelResolution', () => {
  it('should return textureResolution at parser level 0 (finest)', () => {
    expect(levelResolution(0, 1024)).toBe(1024);
  });

  it('should halve resolution at each subsequent level', () => {
    expect(levelResolution(1, 1024)).toBe(512);
    expect(levelResolution(2, 1024)).toBe(256);
    expect(levelResolution(3, 1024)).toBe(128);
    expect(levelResolution(4, 1024)).toBe(64);
    expect(levelResolution(5, 1024)).toBe(32);
  });

  it('should work with textureResolution = 512', () => {
    expect(levelResolution(0, 512)).toBe(512);
    expect(levelResolution(1, 512)).toBe(256);
    expect(levelResolution(2, 512)).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// BC4 byte offset
// ---------------------------------------------------------------------------

describe('bc4LevelOffset', () => {
  it('should return 0 for parser level 0 (finest level is first)', () => {
    expect(bc4LevelOffset(0, 1024)).toBe(0);
  });

  it('should return correct offset for level 1', () => {
    // Level 0 = 1024x1024 pixels, BC4 = 0.5 bytes/pixel = 524288 bytes
    expect(bc4LevelOffset(1, 1024)).toBe(524288);
  });

  it('should return correct offset for level 2', () => {
    // Level 0: 1024*1024/2 = 524288
    // Level 1: 512*512/2 = 131072
    // Total offset for level 2: 655360
    expect(bc4LevelOffset(2, 1024)).toBe(524288 + 131072);
  });

  it('should compute cumulative offsets correctly', () => {
    // Verify each level's offset is the sum of all prior levels
    let expectedOffset = 0;
    let res = 1024;
    for (let level = 0; level < 6; level++) {
      expect(bc4LevelOffset(level, 1024)).toBe(expectedOffset);
      expectedOffset += (res * res) >> 1;
      res >>= 1;
    }
  });

  it('should work for small textures', () => {
    // textureResolution = 32: level 0 = 32*32/2 = 512 bytes
    expect(bc4LevelOffset(0, 32)).toBe(0);
    expect(bc4LevelOffset(1, 32)).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// decodeTile
// ---------------------------------------------------------------------------

describe('decodeTile', () => {
  const header = makeHeader({ textureResolution: 32, mipMapLevels: 3, numberOfTextures1D: 4 });
  // 3 mip levels at res 32: 32, 16, 8
  // TM level 0 = parser level 2 = res 8
  // TM level 1 = parser level 1 = res 16
  // TM level 2 = parser level 0 = res 32

  it('should decode a tile on the diagonal (no transpose)', () => {
    // Tile (1, 1) — on the diagonal, col == row
    const numTiles = ((header.numberOfTextures1D + 1) * header.numberOfTextures1D) >> 1;
    const rawTiles: Uint8Array[] = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(makeRawTile(header));
    }

    const key = { level: 0, col: 1, row: 1 };
    const result = decodeTile(key, rawTiles, header);
    // TM level 0 → parser level 2 → resolution 8
    expect(result.length).toBe(8 * 8);
  });

  it('should decode a tile from the upper triangle (col <= row)', () => {
    const numTiles = ((header.numberOfTextures1D + 1) * header.numberOfTextures1D) >> 1;
    const rawTiles: Uint8Array[] = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(makeRawTile(header));
    }

    const key = { level: 0, col: 0, row: 2 };
    const result = decodeTile(key, rawTiles, header);
    expect(result.length).toBe(8 * 8);
  });

  it('should transpose when col > row (lower triangle)', () => {
    const smallHeader = makeHeader({
      textureResolution: 8,
      mipMapLevels: 1,
      numberOfTextures1D: 4,
    });
    const numTiles = ((smallHeader.numberOfTextures1D + 1) * smallHeader.numberOfTextures1D) >> 1;
    const rawTiles: Uint8Array[] = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(makeConstantRawTile(smallHeader, 128));
    }

    // Tile (2, 1): col > row, should read from (1, 2) and transpose
    const key = { level: 0, col: 2, row: 1 };
    const result = decodeTile(key, rawTiles, smallHeader);
    expect(result.length).toBe(8 * 8);
    // For constant data, transpose doesn't change anything
    // but the output should still be valid
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeCloseTo(128 / 255, 2);
    }
  });

  it('should return correct resolution for different TM levels', () => {
    const numTiles = ((header.numberOfTextures1D + 1) * header.numberOfTextures1D) >> 1;
    const rawTiles: Uint8Array[] = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(makeRawTile(header));
    }

    // TM level 0 → parser level 2 → res 8
    expect(decodeTile({ level: 0, col: 0, row: 0 }, rawTiles, header).length).toBe(64);
    // TM level 1 → parser level 1 → res 16
    expect(decodeTile({ level: 1, col: 0, row: 0 }, rawTiles, header).length).toBe(256);
    // TM level 2 → parser level 0 → res 32
    expect(decodeTile({ level: 2, col: 0, row: 0 }, rawTiles, header).length).toBe(1024);
  });

  it('should return zeroed output for missing tile data', () => {
    const rawTiles: Uint8Array[] = []; // empty array
    const result = decodeTile({ level: 0, col: 0, row: 0 }, rawTiles, header);
    expect(result.length).toBe(8 * 8);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('transpose should swap (x,y) data correctly', () => {
    // Use a minimal setup with textureResolution=4 so there's a single
    // 4x4 BC4 block per tile. We create asymmetric data and verify
    // the transpose swaps rows and columns.
    const tinyHeader = makeHeader({
      textureResolution: 4,
      mipMapLevels: 1,
      numberOfTextures1D: 2,
    });
    // 2 tiles per dim → 3 upper-triangular tiles: (0,0), (0,1), (1,1)
    const numTiles = 3;
    const rawTiles: Uint8Array[] = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(new Uint8Array(8)); // one BC4 block = 8 bytes
    }

    // Set tile (0,1) = linear index for (0,1) with asymmetric data
    // alpha0=200, alpha1=100 for 8-value interpolation
    const tileIdx = 1; // tileLinearIndex(0, 1, 2) = 1
    rawTiles[tileIdx][0] = 200; // alpha0
    rawTiles[tileIdx][1] = 100; // alpha1

    // Decode tile (0, 1) — col < row, no transpose
    const normal = decodeTile({ level: 0, col: 0, row: 1 }, rawTiles, tinyHeader);
    // Decode tile (1, 0) — col > row, should transpose
    const transposed = decodeTile({ level: 0, col: 1, row: 0 }, rawTiles, tinyHeader);

    // Verify the transpose relationship: transposed[y*4+x] == normal[x*4+y]
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(transposed[y * 4 + x]).toBeCloseTo(normal[x * 4 + y], 5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// decodeTileBatch
// ---------------------------------------------------------------------------

describe('decodeTileBatch', () => {
  const header = makeHeader({ textureResolution: 8, mipMapLevels: 1, numberOfTextures1D: 2 });
  const numTiles = 3;

  let rawTiles: Uint8Array[];
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafIdCounter: number;

  beforeEach(() => {
    rawTiles = [];
    for (let i = 0; i < numTiles; i++) {
      rawTiles.push(makeConstantRawTile(header, 100));
    }

    // Polyfill requestAnimationFrame for Node test environment
    rafCallbacks = [];
    rafIdCounter = 0;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafIdCounter;
    };
  });

  afterEach(() => {
    delete (globalThis as any).requestAnimationFrame;
  });

  /**
   * Flush pending requestAnimationFrame callbacks (one level deep per call).
   */
  function flushRAF(times = 10) {
    for (let i = 0; i < times; i++) {
      const pending = rafCallbacks.splice(0);
      if (pending.length === 0) break;
      for (const cb of pending) {
        cb(performance.now());
      }
    }
  }

  it('should decode all requested tiles and call onComplete', () => {
    const decoded: Array<{ key: { level: number; col: number; row: number }; length: number }> = [];
    let completed = false;

    const keys = [
      { level: 0, col: 0, row: 0 },
      { level: 0, col: 0, row: 1 },
      { level: 0, col: 1, row: 1 },
    ];

    decodeTileBatch(
      keys,
      rawTiles,
      header,
      (key, data) => decoded.push({ key, length: data.length }),
      () => { completed = true; },
      2, // batch size
    );

    flushRAF();

    expect(decoded.length).toBe(3);
    expect(completed).toBe(true);
    // Each tile at level 0 (parser level 0) with textureRes=8 → 8*8=64 pixels
    for (const d of decoded) {
      expect(d.length).toBe(64);
    }
  });

  it('should process in batches across frames', () => {
    const decoded: Array<{ key: { level: number; col: number; row: number } }> = [];
    let completed = false;

    const keys = [
      { level: 0, col: 0, row: 0 },
      { level: 0, col: 0, row: 1 },
      { level: 0, col: 1, row: 1 },
    ];

    decodeTileBatch(
      keys,
      rawTiles,
      header,
      (key) => decoded.push({ key }),
      () => { completed = true; },
      1, // batch size of 1 → each tile in a separate frame
    );

    // After first rAF: 1 tile decoded
    flushRAF(1);
    expect(decoded.length).toBe(1);
    expect(completed).toBe(false);

    // After second rAF: 2 tiles
    flushRAF(1);
    expect(decoded.length).toBe(2);

    // After third rAF: all 3 tiles + complete
    flushRAF(1);
    expect(decoded.length).toBe(3);
    expect(completed).toBe(true);
  });

  it('should support cancellation', () => {
    const decoded: Array<{ key: { level: number; col: number; row: number } }> = [];
    let completed = false;

    const keys = [
      { level: 0, col: 0, row: 0 },
      { level: 0, col: 0, row: 1 },
      { level: 0, col: 1, row: 1 },
    ];

    const cancel = decodeTileBatch(
      keys,
      rawTiles,
      header,
      (key) => decoded.push({ key }),
      () => { completed = true; },
      1,
    );

    // Decode one tile
    flushRAF(1);
    expect(decoded.length).toBe(1);

    // Cancel before remaining tiles
    cancel();

    // Flush remaining frames — should not decode more
    flushRAF();

    expect(decoded.length).toBe(1);
    expect(completed).toBe(true); // onComplete is still called on cancel
  });

  it('should handle empty key list', () => {
    let completed = false;

    decodeTileBatch(
      [],
      rawTiles,
      header,
      () => { throw new Error('should not be called'); },
      () => { completed = true; },
    );

    flushRAF();
    expect(completed).toBe(true);
  });
});
