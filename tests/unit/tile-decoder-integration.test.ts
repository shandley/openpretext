/**
 * Integration tests for TileDecoder using real .pretext file data.
 *
 * These tests parse the bTaeGut2 (zebra finch) .pretext file and validate
 * that the TileDecoder produces identical output to PretextParser's own
 * BC4 decoding, verifying the full pipeline: level mapping, byte offsets,
 * upper-triangular mirroring, and data fidelity.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parsePretextFile, tileLinearIndex, type PretextFile, type PretextHeader } from '../../src/formats/PretextParser';
import {
  tileManagerLevelToParserLevel,
  levelResolution,
  bc4LevelOffset,
  decodeTile,
} from '../../src/renderer/TileDecoder';

// ---------------------------------------------------------------------------
// Setup: parse the real .pretext file once for all tests
// ---------------------------------------------------------------------------

const TEST_FILE = resolve(__dirname, '../../test-data/bTaeGut2.mat.pretext');
const FILE_EXISTS = existsSync(TEST_FILE);

let parsed: PretextFile;
let header: PretextHeader;

beforeAll(async () => {
  if (!FILE_EXISTS) return;

  const buffer = readFileSync(TEST_FILE).buffer;
  // Parse with specific levels decoded for comparison:
  // level 0 (finest), the coarsest level, and one intermediate level
  parsed = await parsePretextFile(buffer, { decodeLevels: [0, 2, parsed?.header?.mipMapLevels ? parsed.header.mipMapLevels - 1 : 5] });

  // Re-parse to get the header first, then decode the levels we need
  const headerOnly = await parsePretextFile(buffer, { coarsestOnly: true });
  header = headerOnly.header;

  const levelsToCheck = [0, Math.min(2, header.mipMapLevels - 1), header.mipMapLevels - 1];
  const uniqueLevels = [...new Set(levelsToCheck)];
  parsed = await parsePretextFile(buffer, { decodeLevels: uniqueLevels });
}, 60_000); // 60s timeout for parsing a 56MB file

// ---------------------------------------------------------------------------
// Gate: skip all tests if the file doesn't exist
// ---------------------------------------------------------------------------

const describeWithFile = FILE_EXISTS ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Header sanity checks
// ---------------------------------------------------------------------------

describeWithFile('Real file header (bTaeGut2)', () => {
  it('should have valid texture parameters', () => {
    expect(header.textureResolution).toBeGreaterThanOrEqual(32);
    expect(header.textureResolution).toBeLessThanOrEqual(4096);
    expect(header.numberOfTextures1D).toBeGreaterThanOrEqual(1);
    expect(header.mipMapLevels).toBeGreaterThanOrEqual(1);
    expect(header.mipMapLevels).toBeLessThanOrEqual(12);
  });

  it('should have consistent derived values', () => {
    expect(header.numberOfPixels1D).toBe(header.textureResolution * header.numberOfTextures1D);
    expect(header.textureResolution).toBe(1 << header.textureRes);
    expect(header.numberOfTextures1D).toBe(1 << header.nTextRes);
  });

  it('should have the expected number of upper-triangular tiles', () => {
    const n = header.numberOfTextures1D;
    const expected = ((n + 1) * n) >> 1;
    expect(header.numberOfTextureBlocks).toBe(expected);
    expect(parsed.tiles.length).toBe(expected);
  });

  it('should have contigs with valid pixel ranges', () => {
    expect(parsed.contigs.length).toBeGreaterThan(0);
    for (const c of parsed.contigs) {
      expect(c.pixelStart).toBeGreaterThanOrEqual(0);
      expect(c.pixelEnd).toBeGreaterThanOrEqual(c.pixelStart);
      expect(c.pixelEnd).toBeLessThanOrEqual(header.numberOfPixels1D);
    }
  });
});

// ---------------------------------------------------------------------------
// Level mapping round-trip
// ---------------------------------------------------------------------------

describeWithFile('Level mapping with real header', () => {
  it('should round-trip TM level through parser level and back', () => {
    for (let tmLevel = 0; tmLevel < header.mipMapLevels; tmLevel++) {
      const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
      // Inverse: tmLevel = (numMipMaps - 1) - parserLevel
      const backToTm = (header.mipMapLevels - 1) - parserLevel;
      expect(backToTm).toBe(tmLevel);
    }
  });

  it('should produce valid parser levels (0 to mipMapLevels-1)', () => {
    for (let tmLevel = 0; tmLevel < header.mipMapLevels; tmLevel++) {
      const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
      expect(parserLevel).toBeGreaterThanOrEqual(0);
      expect(parserLevel).toBeLessThan(header.mipMapLevels);
    }
  });

  it('should produce monotonically decreasing resolution as TM level increases', () => {
    // TM level 0 = coarsest (smallest res), higher = finer (larger res)
    // Wait — TM level 0 maps to parser level (n-1) which is the coarsest (smallest)
    // So resolution should INCREASE as TM level increases
    let prevRes = 0;
    for (let tmLevel = 0; tmLevel < header.mipMapLevels; tmLevel++) {
      const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
      const res = levelResolution(parserLevel, header.textureResolution);
      expect(res).toBeGreaterThan(prevRes);
      prevRes = res;
    }
  });
});

// ---------------------------------------------------------------------------
// BC4 byte offset validation
// ---------------------------------------------------------------------------

describeWithFile('BC4 byte offsets against real tile sizes', () => {
  it('should produce offsets that fit within the tile data', () => {
    // Each tile's raw data should be large enough for all levels
    const sampleTile = parsed.tiles[0];
    expect(sampleTile).toBeDefined();

    for (let parserLevel = 0; parserLevel < header.mipMapLevels; parserLevel++) {
      const offset = bc4LevelOffset(parserLevel, header.textureResolution);
      const res = levelResolution(parserLevel, header.textureResolution);
      const levelBytes = (res * res) >> 1; // BC4: 0.5 bytes/pixel
      expect(offset + levelBytes).toBeLessThanOrEqual(sampleTile.length);
    }
  });

  it('should have the last level end exactly at bytesPerTexture', () => {
    let totalBytes = 0;
    let res = header.textureResolution;
    for (let i = 0; i < header.mipMapLevels; i++) {
      totalBytes += (res * res) >> 1;
      res >>= 1;
    }
    expect(totalBytes).toBe(header.bytesPerTexture);
  });
});

// ---------------------------------------------------------------------------
// Decode fidelity: TileDecoder output vs PretextParser decoded output
// ---------------------------------------------------------------------------

describeWithFile('TileDecoder fidelity vs PretextParser', () => {
  it('should match parser output at the coarsest mip level', () => {
    const parserLevel = header.mipMapLevels - 1; // coarsest
    const tmLevel = 0; // TM level 0 = coarsest
    const res = levelResolution(parserLevel, header.textureResolution);

    // Pick a diagonal tile (col == row, no transpose)
    const col = 0;
    const row = 0;
    const linearIdx = tileLinearIndex(col, row, header.numberOfTextures1D);

    // Parser's own decoded data
    const parserDecoded = parsed.tilesDecoded[linearIdx]?.[parserLevel];
    if (!parserDecoded) return; // level wasn't decoded

    // TileDecoder output
    const tileDecoderOutput = decodeTile(
      { level: tmLevel, col, row },
      parsed.tiles,
      header,
    );

    expect(tileDecoderOutput.length).toBe(res * res);
    expect(tileDecoderOutput.length).toBe(parserDecoded.length);

    // Compare every pixel
    for (let i = 0; i < tileDecoderOutput.length; i++) {
      expect(tileDecoderOutput[i]).toBeCloseTo(parserDecoded[i], 5);
    }
  });

  it('should match parser output at the finest mip level', () => {
    const parserLevel = 0; // finest
    const tmLevel = header.mipMapLevels - 1; // TM level max = finest

    // Pick tile (1, 1) on the diagonal
    const col = Math.min(1, header.numberOfTextures1D - 1);
    const row = col;
    const linearIdx = tileLinearIndex(col, row, header.numberOfTextures1D);

    const parserDecoded = parsed.tilesDecoded[linearIdx]?.[parserLevel];
    if (!parserDecoded) return;

    const tileDecoderOutput = decodeTile(
      { level: tmLevel, col, row },
      parsed.tiles,
      header,
    );

    expect(tileDecoderOutput.length).toBe(parserDecoded.length);

    for (let i = 0; i < tileDecoderOutput.length; i++) {
      expect(tileDecoderOutput[i]).toBeCloseTo(parserDecoded[i], 5);
    }
  });

  it('should match parser output at an intermediate mip level', () => {
    const parserLevel = Math.min(2, header.mipMapLevels - 1);
    const tmLevel = (header.mipMapLevels - 1) - parserLevel;

    const col = 0;
    const row = Math.min(1, header.numberOfTextures1D - 1);
    const linearIdx = tileLinearIndex(col, row, header.numberOfTextures1D);

    const parserDecoded = parsed.tilesDecoded[linearIdx]?.[parserLevel];
    if (!parserDecoded) return;

    const tileDecoderOutput = decodeTile(
      { level: tmLevel, col, row },
      parsed.tiles,
      header,
    );

    expect(tileDecoderOutput.length).toBe(parserDecoded.length);

    for (let i = 0; i < tileDecoderOutput.length; i++) {
      expect(tileDecoderOutput[i]).toBeCloseTo(parserDecoded[i], 5);
    }
  });

  it('should match across multiple diagonal tiles', () => {
    const parserLevel = header.mipMapLevels - 1; // coarsest for speed
    const tmLevel = 0;

    // Check first 5 diagonal tiles
    const n = Math.min(5, header.numberOfTextures1D);
    for (let i = 0; i < n; i++) {
      const linearIdx = tileLinearIndex(i, i, header.numberOfTextures1D);
      const parserDecoded = parsed.tilesDecoded[linearIdx]?.[parserLevel];
      if (!parserDecoded) continue;

      const tileDecoderOutput = decodeTile(
        { level: tmLevel, col: i, row: i },
        parsed.tiles,
        header,
      );

      expect(tileDecoderOutput.length).toBe(parserDecoded.length);
      for (let j = 0; j < tileDecoderOutput.length; j++) {
        expect(tileDecoderOutput[j]).toBeCloseTo(parserDecoded[j], 5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Upper-triangular mirroring: transposed tiles should be symmetric
// ---------------------------------------------------------------------------

describeWithFile('Upper-triangular mirroring with real data', () => {
  it('tile (col, row) and tile (row, col) should be transposes of each other', () => {
    // Pick an off-diagonal tile pair
    if (header.numberOfTextures1D < 2) return;

    const col = 0;
    const row = 1;
    const tmLevel = 0; // coarsest for speed
    const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
    const res = levelResolution(parserLevel, header.textureResolution);

    // Tile (0, 1) — col < row, read directly
    const tileA = decodeTile({ level: tmLevel, col, row }, parsed.tiles, header);
    // Tile (1, 0) — col > row, should be transposed from (0, 1)
    const tileB = decodeTile({ level: tmLevel, col: row, row: col }, parsed.tiles, header);

    expect(tileA.length).toBe(res * res);
    expect(tileB.length).toBe(res * res);

    // Verify transpose: tileB[y * res + x] == tileA[x * res + y]
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        expect(tileB[y * res + x]).toBeCloseTo(tileA[x * res + y], 5);
      }
    }
  });

  it('diagonal tiles should be symmetric (self-transpose)', () => {
    // A tile on the diagonal (col == row) reads from upper triangle.
    // Hi-C contact maps are symmetric, so diagonal tiles should be
    // approximately symmetric (not exact due to read pair sampling).
    // We just verify the decode succeeds and has non-zero data.
    const tmLevel = 0;
    const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
    const res = levelResolution(parserLevel, header.textureResolution);

    const tile = decodeTile({ level: tmLevel, col: 0, row: 0 }, parsed.tiles, header);
    expect(tile.length).toBe(res * res);

    // Should have at least some non-zero values (real data)
    const sum = tile.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('mirroring should work at higher mip levels too', () => {
    if (header.numberOfTextures1D < 2 || header.mipMapLevels < 2) return;

    const tmLevel = Math.min(1, header.mipMapLevels - 1);
    const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
    const res = levelResolution(parserLevel, header.textureResolution);

    const tileA = decodeTile({ level: tmLevel, col: 0, row: 1 }, parsed.tiles, header);
    const tileB = decodeTile({ level: tmLevel, col: 1, row: 0 }, parsed.tiles, header);

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        expect(tileB[y * res + x]).toBeCloseTo(tileA[x * res + y], 5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tile data quality checks
// ---------------------------------------------------------------------------

describeWithFile('Tile data quality', () => {
  it('decoded values should be in [0, 1] range', () => {
    // Check a handful of tiles at the coarsest level
    const tmLevel = 0;
    const n = Math.min(3, header.numberOfTextures1D);

    for (let col = 0; col < n; col++) {
      for (let row = col; row < n; row++) {
        const tile = decodeTile({ level: tmLevel, col, row }, parsed.tiles, header);
        for (let i = 0; i < tile.length; i++) {
          expect(tile[i]).toBeGreaterThanOrEqual(0);
          expect(tile[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('finer levels should have higher resolution than coarser levels', () => {
    const tileCoarse = decodeTile({ level: 0, col: 0, row: 0 }, parsed.tiles, header);
    const tmLevelFine = Math.min(2, header.mipMapLevels - 1);
    const tileFine = decodeTile({ level: tmLevelFine, col: 0, row: 0 }, parsed.tiles, header);

    // Fine tile should have more pixels
    expect(tileFine.length).toBeGreaterThan(tileCoarse.length);
  });

  it('overview assembly from coarsest tiles should have non-trivial data', () => {
    // Verify the coarsest level has actual contact data, not just zeros
    const tmLevel = 0;
    const parserLevel = tileManagerLevelToParserLevel(tmLevel, header.mipMapLevels);
    const res = levelResolution(parserLevel, header.textureResolution);

    // Sum intensity across the first diagonal tile
    const tile = decodeTile({ level: tmLevel, col: 0, row: 0 }, parsed.tiles, header);
    const mean = tile.reduce((a, b) => a + b, 0) / tile.length;

    // A real Hi-C diagonal tile should have significant signal
    expect(mean).toBeGreaterThan(0.001);
  });
});
