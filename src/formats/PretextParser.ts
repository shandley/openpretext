/**
 * Parser for the .pretext binary file format.
 *
 * The .pretext format stores Hi-C contact maps as BC4-compressed texture tiles
 * organized in an upper-triangular grid layout with multiple mipmap levels.
 *
 * File layout (see docs/PRETEXT_FORMAT.md for full specification):
 *
 * 1. Magic bytes: 'pstm' (4 bytes)
 * 2. Compressed header size (u32) + Uncompressed header size (u32)
 * 3. Deflate-compressed header containing:
 *    - Total genome length (u64)
 *    - Number of contigs (u32)
 *    - Per-contig: fractional length (f32) + name (64 bytes as u32[16])
 *    - textureRes (u08), nTextRes (u08), mipMapLevels (u08)
 * 4. For each tile in the upper triangle of the texture grid:
 *    - Compressed size (u32) + deflate-compressed BC4 data (all mipmap levels)
 * 5. Optional graph extensions (magic 'psgh' + compressed name + s32 values)
 *
 * Compression: raw DEFLATE (libdeflate level 12), decompressed with pako.inflateRaw.
 * Texture format: BC4 / RGTC1 (single-channel, 8 bytes per 4x4 block).
 *
 * Derived from reading the source code of:
 *   - PretextMap  (https://github.com/sanger-tol/PretextMap)
 *   - PretextView (https://github.com/sanger-tol/PretextView)
 *   - PretextGraph (https://github.com/sanger-tol/PretextGraph)
 */

import pako from 'pako';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PretextContig {
  name: string;
  /** Fractional length as stored in the file (contig_bp / total_genome_bp). */
  fractionalLength: number;
  /** Absolute length in base pairs (reconstructed: fractionalLength * totalGenomeLength). */
  length: number;
  /** Start position in the 1-D pixel map (inclusive). */
  pixelStart: number;
  /** End position in the 1-D pixel map (exclusive). */
  pixelEnd: number;
}

export interface PretextExtension {
  name: string;
  /** One signed 32-bit value per pixel in the 1-D map (Number_of_Pixels_1D). */
  data: Int32Array;
}

export interface PretextHeader {
  totalGenomeLength: bigint;
  numberOfContigs: number;
  textureRes: number;      // log2(single texture resolution)
  nTextRes: number;        // log2(number of textures per dimension)
  mipMapLevels: number;
  textureResolution: number;     // 1 << textureRes   (e.g. 1024)
  numberOfTextures1D: number;    // 1 << nTextRes      (e.g. 32)
  numberOfPixels1D: number;      // textureResolution * numberOfTextures1D
  numberOfTextureBlocks: number; // upper-triangle tile count
  bytesPerTexture: number;       // decompressed size of one tile (all mipmaps)
}

export interface PretextFile {
  header: PretextHeader;
  contigs: PretextContig[];
  /**
   * Raw decompressed tile data. Each entry is one upper-triangular tile
   * containing BC4-compressed data for all mipmap levels concatenated.
   * Index is the linear tile index from texture_id_cal().
   */
  tiles: Uint8Array[];
  /**
   * Decoded intensity values per mipmap level for each tile.
   * tiles_decoded[tileIndex][mipmapLevel] is a Float32Array of size
   * (levelRes * levelRes), where pixels are in row-major order.
   */
  tilesDecoded: Float32Array[][];
  extensions: PretextExtension[];
}

// ---------------------------------------------------------------------------
// BC4 (RGTC1) decoding
// ---------------------------------------------------------------------------

/**
 * Decode a single BC4 block (8 bytes) into 16 u08 pixel values.
 *
 * BC4 encodes 4x4 single-channel pixels as:
 *   - byte 0: alpha0 (reference value 0)
 *   - byte 1: alpha1 (reference value 1)
 *   - bytes 2-7: 16 x 3-bit lookup indices (48 bits, little-endian)
 */
function decodeBC4Block(
  data: Uint8Array,
  offset: number,
  palette: Uint8Array,
  pixels: Uint8Array,
): void {
  const alpha0 = data[offset];
  const alpha1 = data[offset + 1];

  // Build the 8-entry interpolation palette (into the caller's scratch buffer)
  palette[0] = alpha0;
  palette[1] = alpha1;

  if (alpha0 > alpha1) {
    // 8-value interpolation
    palette[2] = Math.round((6 * alpha0 + 1 * alpha1) / 7);
    palette[3] = Math.round((5 * alpha0 + 2 * alpha1) / 7);
    palette[4] = Math.round((4 * alpha0 + 3 * alpha1) / 7);
    palette[5] = Math.round((3 * alpha0 + 4 * alpha1) / 7);
    palette[6] = Math.round((2 * alpha0 + 5 * alpha1) / 7);
    palette[7] = Math.round((1 * alpha0 + 6 * alpha1) / 7);
  } else {
    // 6-value interpolation + 0 and 255
    palette[2] = Math.round((4 * alpha0 + 1 * alpha1) / 5);
    palette[3] = Math.round((3 * alpha0 + 2 * alpha1) / 5);
    palette[4] = Math.round((2 * alpha0 + 3 * alpha1) / 5);
    palette[5] = Math.round((1 * alpha0 + 4 * alpha1) / 5);
    palette[6] = 0;
    palette[7] = 255;
  }

  // Read 48 bits of index data (6 bytes, little-endian), two 24-bit halves.
  const lo24 =
    data[offset + 2] |
    (data[offset + 3] << 8) |
    (data[offset + 4] << 16);
  const hi24 =
    data[offset + 5] |
    (data[offset + 6] << 8) |
    (data[offset + 7] << 16);

  for (let i = 0; i < 8; i++) {
    pixels[i] = palette[(lo24 >> (i * 3)) & 0x7];
  }
  for (let i = 0; i < 8; i++) {
    pixels[8 + i] = palette[(hi24 >> (i * 3)) & 0x7];
  }
}

/**
 * Decode an entire BC4-compressed mipmap level into a Float32Array of
 * normalised intensity values [0..1].
 *
 * The BC4 data for a level of resolution `res x res` is `res * (res / 2)`
 * bytes. Blocks are written column-major per 4-pixel-wide vertical strip
 * (matching PretextMap's iteration order: outer loop x+=4, inner loop y+=4).
 *
 * Within each 4x4 block, PretextMap fills pixels in column-major order
 * (outer dxt_x, inner dxt_y), so the 16 pixels in a block map to:
 *   index 0 -> (x+0, y+0), index 1 -> (x+0, y+1), ...
 *   index 4 -> (x+1, y+0), ...
 */
function decodeBC4Level(
  bc4Data: Uint8Array,
  bc4Offset: number,
  resolution: number,
): Float32Array {
  const output = new Float32Array(resolution * resolution);
  const blocksPerDim = resolution >> 2; // resolution / 4
  let blockPtr = bc4Offset;

  // Scratch buffers reused across every block (was ~2 allocations per 4x4 block).
  const palette = new Uint8Array(8);
  const pixels = new Uint8Array(16);

  // PretextMap iteration: outer x (column of blocks), inner y (row of blocks)
  for (let bx = 0; bx < blocksPerDim; bx++) {
    for (let by = 0; by < blocksPerDim; by++) {
      decodeBC4Block(bc4Data, blockPtr, palette, pixels);
      blockPtr += 8;

      // Map the 16 decoded pixels back into the output image.
      // PretextMap packs them column-major within the block:
      //   dxt_ptr = dxt_x * 4 + dxt_y  (outer dxt_x, inner dxt_y)
      for (let dx = 0; dx < 4; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const px = bx * 4 + dx;
          const py = by * 4 + dy;
          if (px < resolution && py < resolution) {
            // stb_compress_bc4_block receives pixels in the order they were
            // packed: index = dxt_x * 4 + dxt_y (column-major within block)
            output[py * resolution + px] = pixels[dx * 4 + dy] / 255;
          }
        }
      }
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Helper: compute linear tile index from (x, y) coordinates
// ---------------------------------------------------------------------------

/**
 * Compute the linear index of tile (x, y) in the upper-triangular layout.
 * Assumes x <= y. Matches the C++ `texture_id_cal` function.
 */
/**
 * Inflate every tile's raw-DEFLATE bytes. Prefers the browser-native
 * DecompressionStream('deflate-raw') (~1.8x faster than pako in practice and run
 * in parallel); falls back to pako.inflateRaw when unavailable. Null entries
 * (truncated tiles) yield a zeroed buffer.
 */
async function inflateRawTiles(
  comps: (Uint8Array | null)[],
  fallbackLen: number,
): Promise<Uint8Array[]> {
  const hasDS =
    typeof DecompressionStream !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof Response !== 'undefined';
  if (hasDS) {
    return Promise.all(
      comps.map(async (c) => {
        if (!c) return new Uint8Array(fallbackLen);
        try {
          const stream = new Blob([c as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch {
          try { return pako.inflateRaw(c); } catch { return new Uint8Array(fallbackLen); }
        }
      }),
    );
  }
  return comps.map((c) => {
    if (!c) return new Uint8Array(fallbackLen);
    try { return pako.inflateRaw(c); } catch { return new Uint8Array(fallbackLen); }
  });
}

export function tileLinearIndex(x: number, y: number, n: number): number {
  if (x > y) {
    const tmp = x;
    x = y;
    y = tmp;
  }
  return (((2 * n - x - 1) * x) >> 1) + y;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a .pretext file from an ArrayBuffer.
 */
export interface ParseOptions {
  /**
   * Which mipmap levels to decode. If not provided, all levels are decoded.
   * Level 0 is the finest (full resolution), level (mipMapLevels-1) is the coarsest.
   * Use `[mipMapLevels - 1]` to decode only the coarsest level for large files.
   */
  decodeLevels?: number[];
  /**
   * If true, only decode the coarsest mipmap level (level mipMapLevels-1).
   * This is equivalent to decodeLevels: [mipMapLevels - 1] but doesn't
   * require knowing the number of levels ahead of time.
   */
  coarsestOnly?: boolean;
}

export async function parsePretextFile(buffer: ArrayBuffer, options?: ParseOptions): Promise<PretextFile> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  // ---- 1. Validate magic bytes ----
  if (
    bytes[0] !== 0x70 || // 'p'
    bytes[1] !== 0x73 || // 's'
    bytes[2] !== 0x74 || // 't'
    bytes[3] !== 0x6d    // 'm'
  ) {
    throw new Error(
      `Invalid pretext file: expected magic 'pstm', got ` +
        `'${String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])}'`,
    );
  }
  offset = 4;

  // ---- 2. Read compressed / uncompressed header sizes ----
  const nBytesHeaderComp = view.getUint32(offset, true);
  offset += 4;
  const nBytesHeader = view.getUint32(offset, true);
  offset += 4;

  // ---- 3. Decompress header ----
  const compressedHeader = bytes.slice(offset, offset + nBytesHeaderComp);
  offset += nBytesHeaderComp;

  let headerBytes: Uint8Array;
  try {
    headerBytes = pako.inflateRaw(compressedHeader);
  } catch (e) {
    throw new Error(`Failed to decompress pretext header: ${e}`);
  }

  if (headerBytes.length !== nBytesHeader) {
    throw new Error(
      `Header size mismatch: expected ${nBytesHeader}, got ${headerBytes.length}`,
    );
  }

  // ---- 4. Parse decompressed header ----
  const hdrView = new DataView(
    headerBytes.buffer,
    headerBytes.byteOffset,
    headerBytes.byteLength,
  );
  let hdrOff = 0;

  // Total genome length (u64, little-endian)
  const totalGenomeLengthLo = hdrView.getUint32(hdrOff, true);
  const totalGenomeLengthHi = hdrView.getUint32(hdrOff + 4, true);
  const totalGenomeLength =
    BigInt(totalGenomeLengthLo) | (BigInt(totalGenomeLengthHi) << 32n);
  const totalGenomeLengthNum = Number(totalGenomeLength);
  hdrOff += 8;

  // Number of contigs (u32)
  const numberOfContigs = hdrView.getUint32(hdrOff, true);
  hdrOff += 4;

  // Per-contig records
  const contigs: PretextContig[] = [];
  for (let i = 0; i < numberOfContigs; i++) {
    // Fractional length (f32)
    const fractionalLength = hdrView.getFloat32(hdrOff, true);
    hdrOff += 4;

    // Contig name: 64 bytes (u32[16]), null-terminated ASCII string
    const nameBytes = headerBytes.slice(hdrOff, hdrOff + 64);
    hdrOff += 64;

    let name = '';
    for (let j = 0; j < 64; j++) {
      if (nameBytes[j] === 0) break;
      name += String.fromCharCode(nameBytes[j]);
    }

    contigs.push({
      name,
      fractionalLength,
      length: 0,      // filled in below
      pixelStart: 0,  // filled in below
      pixelEnd: 0,    // filled in below
    });
  }

  // Texture parameters (3 bytes)
  const textureRes = headerBytes[hdrOff++];   // log2(single texture resolution)
  const nTextRes = headerBytes[hdrOff++];     // log2(number of textures per dimension)
  const mipMapLevels = headerBytes[hdrOff];   // number of mipmap levels

  const textureResolution = 1 << textureRes;
  const numberOfTextures1D = 1 << nTextRes;
  const numberOfPixels1D = textureResolution * numberOfTextures1D;
  const numberOfTextureBlocks =
    ((numberOfTextures1D + 1) * numberOfTextures1D) >> 1;

  // Compute Bytes_Per_Texture (decompressed size of one tile)
  let bytesPerTexture = 0;
  {
    let tRes = textureRes;
    for (let i = 0; i < mipMapLevels; i++) {
      bytesPerTexture += 1 << (2 * tRes);
      tRes--;
    }
    bytesPerTexture >>= 1; // BC4: 0.5 bytes per pixel
  }

  // ---- 5. Reconstruct pixel positions for contigs ----
  {
    let cumulativeFrac = 0;
    for (let i = 0; i < numberOfContigs; i++) {
      const startFrac = cumulativeFrac;
      cumulativeFrac += contigs[i].fractionalLength;

      contigs[i].length = Math.round(
        contigs[i].fractionalLength * totalGenomeLengthNum,
      );
      contigs[i].pixelStart = Math.floor(startFrac * numberOfPixels1D);
      contigs[i].pixelEnd = Math.floor(cumulativeFrac * numberOfPixels1D);
    }
    // Ensure the last contig extends to the end
    if (numberOfContigs > 0) {
      contigs[numberOfContigs - 1].pixelEnd = numberOfPixels1D;
    }
  }

  const header: PretextHeader = {
    totalGenomeLength,
    numberOfContigs,
    textureRes,
    nTextRes,
    mipMapLevels,
    textureResolution,
    numberOfTextures1D,
    numberOfPixels1D,
    numberOfTextureBlocks,
    bytesPerTexture,
  };

  // Resolve coarsestOnly into decodeLevels
  if (options?.coarsestOnly && !options.decodeLevels) {
    options = { ...options, decodeLevels: [mipMapLevels - 1] };
  }

  // ---- 6. Read texture blocks ----
  const tiles: Uint8Array[] = new Array(numberOfTextureBlocks);
  const tilesDecoded: Float32Array[][] = new Array(numberOfTextureBlocks);

  // Phase 1: walk the tile section and collect each tile's compressed bytes
  // (cheap zero-copy subarrays; advances `offset` for extension parsing below).
  const compTiles: (Uint8Array | null)[] = new Array(numberOfTextureBlocks).fill(null);
  let lastBlock = numberOfTextureBlocks;
  for (let i = 0; i < numberOfTextureBlocks; i++) {
    if (offset + 4 > bytes.length) {
      console.warn(`Unexpected end of file at texture block ${i}/${numberOfTextureBlocks}`);
      lastBlock = i;
      break;
    }
    const compSize = view.getUint32(offset, true);
    offset += 4;
    if (offset + compSize > bytes.length) {
      console.warn(`Texture block ${i} compressed data extends past end of file`);
      lastBlock = i;
      break;
    }
    compTiles[i] = bytes.subarray(offset, offset + compSize);
    offset += compSize;
  }

  // Phase 2: inflate all tiles in parallel (native DecompressionStream when
  // available, ~1.8x faster than pako; falls back to pako otherwise).
  const decompressedTiles = await inflateRawTiles(compTiles, bytesPerTexture);

  // Phase 3: store raw bytes and decode the requested mip levels per tile.
  const decodeLevels = options?.decodeLevels;
  for (let i = 0; i < lastBlock; i++) {
    const decompressed = decompressedTiles[i];
    tiles[i] = decompressed;

    const levels: Float32Array[] = new Array(mipMapLevels);
    let levelOffset = 0;
    let levelRes = textureResolution;
    for (let lev = 0; lev < mipMapLevels; lev++) {
      const levelBytes = (levelRes * levelRes) >> 1; // BC4: 0.5 bytes/pixel
      if (!decodeLevels || decodeLevels.includes(lev)) {
        if (levelOffset + levelBytes <= decompressed.length) {
          levels[lev] = decodeBC4Level(decompressed, levelOffset, levelRes);
        } else {
          levels[lev] = new Float32Array(levelRes * levelRes);
        }
      }
      levelOffset += levelBytes;
      levelRes >>= 1;
    }
    tilesDecoded[i] = levels;
  }

  // ---- 7. Read extensions ----
  const extensions: PretextExtension[] = [];
  const GRAPH_MAGIC = [0x70, 0x73, 0x67, 0x68]; // 'psgh'

  while (offset + 4 <= bytes.length) {
    // Check for graph extension magic
    if (
      bytes[offset] === GRAPH_MAGIC[0] &&
      bytes[offset + 1] === GRAPH_MAGIC[1] &&
      bytes[offset + 2] === GRAPH_MAGIC[2] &&
      bytes[offset + 3] === GRAPH_MAGIC[3]
    ) {
      offset += 4;

      if (offset + 4 > bytes.length) break;
      const compSize = view.getUint32(offset, true);
      offset += 4;

      if (offset + compSize > bytes.length) {
        console.warn('Extension compressed data extends past end of file');
        break;
      }

      const compData = bytes.slice(offset, offset + compSize);
      offset += compSize;

      // Expected decompressed size: 64 bytes name + 4 * numberOfPixels1D bytes values
      const expectedSize = 64 + 4 * numberOfPixels1D;

      let decompressed: Uint8Array;
      try {
        decompressed = pako.inflateRaw(compData);
      } catch (e) {
        console.warn(`Failed to decompress graph extension: ${e}`);
        continue;
      }

      if (decompressed.length < expectedSize) {
        console.warn(
          `Graph extension too small: expected ${expectedSize}, got ${decompressed.length}`,
        );
        continue;
      }

      // Parse extension name (first 64 bytes, null-terminated string)
      let extName = '';
      for (let j = 0; j < 64; j++) {
        if (decompressed[j] === 0) break;
        extName += String.fromCharCode(decompressed[j]);
      }

      // Parse graph values (s32 array starting at byte 64)
      const valuesView = new DataView(
        decompressed.buffer,
        decompressed.byteOffset + 64,
        4 * numberOfPixels1D,
      );
      const values = new Int32Array(numberOfPixels1D);
      for (let j = 0; j < numberOfPixels1D; j++) {
        values[j] = valuesView.getInt32(j * 4, true);
      }

      extensions.push({ name: extName, data: values });
    } else {
      // Unknown data; try advancing one byte and scanning
      // This handles potential padding or unknown extension types.
      offset++;
    }
  }

  return {
    header,
    contigs,
    tiles,
    tilesDecoded,
    extensions,
  };
}

// ---------------------------------------------------------------------------
// Parse + overview assembly (shared by the parse worker and the sync fallback)
// ---------------------------------------------------------------------------

/** Result of parsing a .pretext file and assembling its overview texture. */
export interface AssembledPretext {
  header: PretextHeader;
  contigs: PretextContig[];
  extensions: PretextExtension[];
  /** Raw inflated BC4 bytes per upper-triangular tile (for detail streaming). */
  tiles: Uint8Array[];
  /** Downsampled overview contact map (row-major, symmetric). */
  overview: Float32Array;
  overviewSize: number;
  /** Full-resolution map dimension (numberOfPixels1D). */
  mapSize: number;
}

/**
 * Parse a .pretext file and assemble its downsampled overview texture.
 *
 * This is the heavy, CPU-bound part of loading (full-file inflate + BC4 decode
 * of the coarsest mip per tile). It is pure (no DOM/GPU) so it can run inside a
 * worker; `onProgress` is invoked with coarse progress updates.
 */
export async function parseAndAssemble(
  buffer: ArrayBuffer,
  onProgress?: (message: string, percent: number) => void,
): Promise<AssembledPretext> {
  onProgress?.('Parsing header and metadata...', 20);
  const parsed = await parsePretextFile(buffer, { coarsestOnly: true });
  const h = parsed.header;
  const mapSize = h.numberOfPixels1D;

  onProgress?.('Assembling contact map...', 50);
  const N = h.numberOfTextures1D;
  const coarsestMip = h.mipMapLevels - 1;
  const coarsestRes = h.textureResolution >> coarsestMip;
  const overviewSize = N * coarsestRes;
  const overview = new Float32Array(overviewSize * overviewSize);
  const totalTiles = (N * (N + 1)) / 2;
  let tilesDone = 0;

  for (let tx = 0; tx < N; tx++) {
    for (let ty = tx; ty < N; ty++) {
      const linIdx = tileLinearIndex(tx, ty, N);
      const tileData = parsed.tilesDecoded[linIdx]?.[coarsestMip];
      if (!tileData) { tilesDone++; continue; }

      for (let py = 0; py < coarsestRes; py++) {
        for (let px = 0; px < coarsestRes; px++) {
          const val = tileData[py * coarsestRes + px];
          const gx = tx * coarsestRes + px;
          const gy = ty * coarsestRes + py;
          if (gx < overviewSize && gy < overviewSize) {
            overview[gy * overviewSize + gx] = val;
            overview[gx * overviewSize + gy] = val;
          }
        }
      }

      tilesDone++;
      if (tilesDone % Math.max(1, Math.floor(totalTiles / 20)) === 0) {
        onProgress?.(
          `Assembling tiles... (${tilesDone}/${totalTiles})`,
          50 + Math.round((tilesDone / totalTiles) * 40),
        );
      }
    }
  }

  return {
    header: h,
    contigs: parsed.contigs,
    extensions: parsed.extensions,
    tiles: parsed.tiles,
    overview,
    overviewSize,
    mapSize,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Quick validation: is this likely a pretext file?
 * Checks for the 'pstm' magic bytes.
 */
export function isPretextFile(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  return (
    bytes[0] === 0x70 && // 'p'
    bytes[1] === 0x73 && // 's'
    bytes[2] === 0x74 && // 't'
    bytes[3] === 0x6d    // 'm'
  );
}

/**
 * Compute the linear tile index for a given (x, y) tile coordinate.
 * Exported for use by renderers that need to map tile coordinates to
 * the tiles[] array.
 *
 * x and y are 0-based tile coordinates. The function automatically
 * swaps to ensure x <= y (upper triangle).
 */
/**
 * Decode a single BC4 mipmap level from raw BC4 bytes.
 * Exported for cases where callers want to decode individual levels
 * from the raw tile data.
 */
export { decodeBC4Level, decodeBC4Block };
