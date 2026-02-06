/**
 * On-demand BC4 tile decoder.
 *
 * Bridges between TileManager tile keys (level 0 = coarsest) and the
 * PretextParser raw tile data (level 0 = finest).
 *
 * Handles:
 * - Level convention mapping between TileManager and PretextParser
 * - Byte-offset calculation into the concatenated BC4 mipmap data
 * - Upper-triangular mirroring (transpose when col > row)
 * - Batched async decoding to avoid jank
 */

import { decodeBC4Level, tileLinearIndex, type PretextHeader } from '../formats/PretextParser';
import type { TileKey } from './TileManager';

// ---------------------------------------------------------------------------
// Level mapping
// ---------------------------------------------------------------------------

/**
 * Convert a TileManager mip level to a PretextParser mip level.
 *
 * TileManager: level 0 = coarsest (zoom 1), higher = finer.
 * PretextParser: level 0 = finest (1024x1024), higher = coarser.
 *
 * Mapping: parserLevel = (numMipMaps - 1) - tileManagerLevel
 */
export function tileManagerLevelToParserLevel(tmLevel: number, numMipMaps: number): number {
  return (numMipMaps - 1) - tmLevel;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Compute the pixel resolution of a single tile at a given parser mip level.
 *
 * Level 0 (finest) = textureResolution (e.g. 1024).
 * Each subsequent level halves: level 1 = 512, level 2 = 256, etc.
 */
export function levelResolution(parserLevel: number, textureResolution: number): number {
  return textureResolution >> parserLevel;
}

// ---------------------------------------------------------------------------
// BC4 byte offset
// ---------------------------------------------------------------------------

/**
 * Compute the byte offset of a given parser mip level within a tile's
 * concatenated BC4 data.
 *
 * Levels are stored finest-first (level 0, then level 1, ...).
 * BC4 is 0.5 bytes per pixel, so a level of resolution R occupies
 * (R * R) / 2 bytes.
 */
export function bc4LevelOffset(parserLevel: number, textureResolution: number): number {
  let offset = 0;
  let res = textureResolution;
  for (let i = 0; i < parserLevel; i++) {
    offset += (res * res) >> 1; // BC4: 0.5 bytes per pixel
    res >>= 1;
  }
  return offset;
}

// ---------------------------------------------------------------------------
// Single tile decode
// ---------------------------------------------------------------------------

/**
 * Decode a single tile from raw BC4 data.
 *
 * Handles upper-triangular mirroring: if col > row, the raw data comes from
 * tile (row, col) and the decoded pixels are transposed.
 *
 * @param key      The TileKey to decode (TileManager convention).
 * @param rawTiles Array of raw BC4 data per upper-triangular tile index.
 * @param header   PretextHeader with resolution and mipmap info.
 * @returns        Float32Array of decoded pixel intensities [0,1], row-major.
 */
export function decodeTile(
  key: TileKey,
  rawTiles: Uint8Array[],
  header: PretextHeader,
): Float32Array {
  const parserLevel = tileManagerLevelToParserLevel(key.level, header.mipMapLevels);
  const res = levelResolution(parserLevel, header.textureResolution);
  const offset = bc4LevelOffset(parserLevel, header.textureResolution);

  // Upper-triangular: always read the tile with smaller index first
  const needsTranspose = key.col > key.row;
  const readCol = needsTranspose ? key.row : key.col;
  const readRow = needsTranspose ? key.col : key.row;

  const linearIdx = tileLinearIndex(readCol, readRow, header.numberOfTextures1D);
  const tileData = rawTiles[linearIdx];

  if (!tileData) {
    return new Float32Array(res * res);
  }

  const decoded = decodeBC4Level(tileData, offset, res);

  if (needsTranspose) {
    // Transpose the square tile in-place (swap across diagonal)
    const transposed = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        transposed[y * res + x] = decoded[x * res + y];
      }
    }
    return transposed;
  }

  return decoded;
}

// ---------------------------------------------------------------------------
// Batched async decode
// ---------------------------------------------------------------------------

/**
 * Decode a batch of tiles across multiple animation frames to avoid jank.
 *
 * @param keys       Array of TileKeys to decode.
 * @param rawTiles   Raw BC4 tile data array.
 * @param header     PretextHeader.
 * @param onDecoded  Callback for each decoded tile.
 * @param onComplete Called when all tiles are decoded (or cancelled).
 * @param batchSize  Number of tiles to decode per frame. Default: 4.
 * @returns          A cancel function. Call it to abort remaining decodes.
 */
export function decodeTileBatch(
  keys: TileKey[],
  rawTiles: Uint8Array[],
  header: PretextHeader,
  onDecoded: (key: TileKey, data: Float32Array) => void,
  onComplete: () => void,
  batchSize: number = 4,
): () => void {
  let cancelled = false;
  let index = 0;

  function processNextBatch() {
    if (cancelled) {
      onComplete();
      return;
    }

    const end = Math.min(index + batchSize, keys.length);
    for (let i = index; i < end; i++) {
      if (cancelled) break;
      const data = decodeTile(keys[i], rawTiles, header);
      onDecoded(keys[i], data);
    }
    index = end;

    if (index >= keys.length || cancelled) {
      onComplete();
    } else {
      requestAnimationFrame(processNextBatch);
    }
  }

  requestAnimationFrame(processNextBatch);

  return () => {
    cancelled = true;
  };
}
