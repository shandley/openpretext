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
  /**
   * Problems found after the map itself: a track that is cut short, damaged or
   * the wrong size, or bytes that are not a track. Each is a sentence for the
   * user. The map is complete whenever parsing returns at all.
   */
  warnings: string[];
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
// Validation
// ---------------------------------------------------------------------------

/**
 * The file is not a usable .pretext file: too short, damaged, inconsistent or
 * outside what this reader supports. The message is written for the person
 * who chose the file.
 *
 * Damage to the header or to any map tile is always this error, never a map
 * with a blank region: a curator must not be shown part of the data as if it
 * were all of it. Damage to the optional tracks after the map is reported in
 * `warnings` instead, and the map still loads.
 */
export class PretextFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PretextFormatError';
  }
}

/** A tile's side is 2^n texels; BC4 needs at least one 4x4 block. */
const MIN_TEXTURE_RES_LOG2 = 2;
const MAX_TEXTURE_RES_LOG2 = 13;
/** Tiles per side is 2^n. PretextMap writes 32 (64 in high-resolution mode). */
const MAX_TILES_LOG2 = 8;
/** Fixed part of the header: genome length (8), contig count (4), three texture bytes. */
const HEADER_FIXED_BYTES = 15;
const HEADER_BYTES_PER_CONTIG = 68;
/** Declared header sizes above this are refused before anything is inflated. */
const MAX_HEADER_BYTES = 1 << 27;
/**
 * Contig lengths are stored as float32 fractions of the genome and must fill
 * the map. Real files sum to 1 within about 1e-8.
 */
const FRACTION_SUM_TOLERANCE = 1e-3;
/** Largest overview (texels per side) held in memory as one matrix. */
export const MAX_OVERVIEW_SIZE = 4096;

const INCOMPLETE_HINT = 'It is probably an unfinished download or copy.';

function tryInflateRaw(data: Uint8Array): Uint8Array | null {
  try {
    const out = pako.inflateRaw(data);
    return out instanceof Uint8Array ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tile inflation
// ---------------------------------------------------------------------------

/** Tiles inflated concurrently per batch. Large enough to keep DecompressionStream
 *  near-fully parallel, small enough that progress spreads across the inflate on
 *  large files instead of arriving in one burst when a single Promise.all settles. */
const INFLATE_BATCH = 128;

/**
 * Inflate every tile's raw-DEFLATE bytes. Prefers the browser-native
 * DecompressionStream('deflate-raw') (~1.8x faster than pako in practice and run
 * in parallel); falls back to pako.inflateRaw when unavailable or when it
 * rejects the data. A tile that neither can inflate comes back as null; the
 * caller decides what that means.
 */
async function inflateRawTiles(
  comps: Uint8Array[],
  onTileDone?: () => void,
): Promise<(Uint8Array | null)[]> {
  const hasDS =
    typeof DecompressionStream !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof Response !== 'undefined';
  if (hasDS) {
    const out: (Uint8Array | null)[] = new Array(comps.length).fill(null);
    for (let start = 0; start < comps.length; start += INFLATE_BATCH) {
      const end = Math.min(start + INFLATE_BATCH, comps.length);
      await Promise.all(
        comps.slice(start, end).map(async (c, k) => {
          const i = start + k;
          try {
            const stream = new Blob([c as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            out[i] = new Uint8Array(await new Response(stream).arrayBuffer());
          } catch {
            out[i] = tryInflateRaw(c);
          } finally {
            onTileDone?.();
          }
        }),
      );
    }
    return out;
  }
  return comps.map((c) => {
    onTileDone?.();
    return tryInflateRaw(c);
  });
}

// ---------------------------------------------------------------------------
// Helper: compute linear tile index from (x, y) coordinates
// ---------------------------------------------------------------------------

/**
 * Compute the linear index of tile (x, y) in the upper-triangular layout.
 * x and y are 0-based tile coordinates, swapped if needed so that x <= y.
 * Matches the C++ `texture_id_cal` function.
 */
export function tileLinearIndex(x: number, y: number, n: number): number {
  if (x > y) {
    const tmp = x;
    x = y;
    y = tmp;
  }
  return (((2 * n - x - 1) * x) >> 1) + y;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function readName(bytes: Uint8Array, offset: number): string {
  let name = '';
  for (let j = 0; j < 64; j++) {
    const ch = bytes[offset + j];
    if (ch === 0) break;
    name += String.fromCharCode(ch);
  }
  return name;
}

/**
 * Read and validate the header of a .pretext file. Returns the header, the
 * contig table and the offset of the first map tile. Throws PretextFormatError
 * for anything that is not a well-formed header this reader supports.
 */
export function readPretextHeader(buffer: ArrayBuffer): {
  header: PretextHeader;
  contigs: PretextContig[];
  tilesOffset: number;
} {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // ---- 1. Magic bytes ----
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x70 || // 'p'
    bytes[1] !== 0x73 || // 's'
    bytes[2] !== 0x74 || // 't'
    bytes[3] !== 0x6d    // 'm'
  ) {
    throw new PretextFormatError(
      bytes.length === 0
        ? 'Not a .pretext file: the file is empty.'
        : "Not a .pretext file: it does not start with the 'pstm' signature.",
    );
  }
  if (bytes.length < 12) {
    throw new PretextFormatError(
      `This .pretext file is too short to hold a header (${bytes.length} bytes). ${INCOMPLETE_HINT}`,
    );
  }

  // ---- 2. Compressed / uncompressed header sizes ----
  const nBytesHeaderComp = view.getUint32(4, true);
  const nBytesHeader = view.getUint32(8, true);
  const tilesOffset = 12 + nBytesHeaderComp;
  if (nBytesHeaderComp === 0 || nBytesHeader > MAX_HEADER_BYTES) {
    throw new PretextFormatError(
      `The file header is corrupt: it declares ${nBytesHeaderComp} compressed and ${nBytesHeader} uncompressed bytes.`,
    );
  }
  if (tilesOffset > bytes.length) {
    throw new PretextFormatError(
      `The header runs past the end of the file (it needs ${tilesOffset} bytes, the file has ${bytes.length}). ` +
        INCOMPLETE_HINT,
    );
  }

  // ---- 3. Decompress ----
  const headerBytes = tryInflateRaw(bytes.subarray(12, tilesOffset));
  if (!headerBytes) {
    throw new PretextFormatError('The file header is corrupt: it does not decompress.');
  }
  if (headerBytes.length !== nBytesHeader) {
    throw new PretextFormatError(
      `The file header is corrupt: it declares ${nBytesHeader} bytes but holds ${headerBytes.length}.`,
    );
  }
  if (headerBytes.length < HEADER_FIXED_BYTES) {
    throw new PretextFormatError(
      `The file header is corrupt: it holds ${headerBytes.length} bytes, fewer than any header needs.`,
    );
  }

  // ---- 4. Fields ----
  const hdrView = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);

  const totalGenomeLength = hdrView.getBigUint64(0, true);
  if (totalGenomeLength === 0n || totalGenomeLength > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PretextFormatError(
      `The file header is corrupt: it gives a genome length of ${totalGenomeLength} bp.`,
    );
  }
  const totalGenomeLengthNum = Number(totalGenomeLength);

  // The header is exactly the fixed fields plus one record per contig, so the
  // contig count can be checked before it is used to read anything.
  const numberOfContigs = hdrView.getUint32(8, true);
  const expectedBytes = HEADER_FIXED_BYTES + HEADER_BYTES_PER_CONTIG * numberOfContigs;
  if (numberOfContigs === 0) {
    throw new PretextFormatError('The file header is corrupt: it declares no contigs.');
  }
  if (expectedBytes !== headerBytes.length) {
    throw new PretextFormatError(
      `The file header is corrupt: it declares ${numberOfContigs} contigs, which need ${expectedBytes} bytes, ` +
        `but holds ${headerBytes.length}.`,
    );
  }

  const contigs: PretextContig[] = [];
  let hdrOff = 12;
  let fractionSum = 0;
  for (let i = 0; i < numberOfContigs; i++) {
    const fractionalLength = hdrView.getFloat32(hdrOff, true);
    const name = readName(headerBytes, hdrOff + 4);
    hdrOff += HEADER_BYTES_PER_CONTIG;
    if (!Number.isFinite(fractionalLength) || fractionalLength < 0 || fractionalLength > 1) {
      throw new PretextFormatError(
        `The file header is corrupt: contig ${i + 1} (${name}) has an invalid length (${fractionalLength} of the genome).`,
      );
    }
    fractionSum += fractionalLength;
    contigs.push({ name, fractionalLength, length: 0, pixelStart: 0, pixelEnd: 0 });
  }
  if (Math.abs(fractionSum - 1) > FRACTION_SUM_TOLERANCE) {
    throw new PretextFormatError(
      `The file header is corrupt: contig lengths add up to ${(fractionSum * 100).toFixed(2)}% of the genome, not 100%.`,
    );
  }

  // Texture parameters (3 bytes)
  const textureRes = headerBytes[hdrOff];        // log2(single texture resolution)
  const nTextRes = headerBytes[hdrOff + 1];      // log2(number of textures per dimension)
  const mipMapLevels = headerBytes[hdrOff + 2];  // number of mipmap levels

  if (textureRes < MIN_TEXTURE_RES_LOG2 || textureRes > MAX_TEXTURE_RES_LOG2) {
    throw new PretextFormatError(
      `Unsupported tile size: the header gives 2^${textureRes} texels per tile side ` +
        `(supported: 2^${MIN_TEXTURE_RES_LOG2} to 2^${MAX_TEXTURE_RES_LOG2}). The header may be corrupt.`,
    );
  }
  if (nTextRes > MAX_TILES_LOG2) {
    throw new PretextFormatError(
      `Unsupported map layout: the header gives 2^${nTextRes} tiles per side ` +
        `(supported: up to 2^${MAX_TILES_LOG2}). The header may be corrupt.`,
    );
  }
  // The coarsest stored level must still be one whole BC4 block (4 texels).
  const maxMipLevels = textureRes - 1;
  if (mipMapLevels < 1 || mipMapLevels > maxMipLevels) {
    throw new PretextFormatError(
      `The file header is corrupt: it declares ${mipMapLevels} mip levels, ` +
        `but a tile of 2^${textureRes} texels holds between 1 and ${maxMipLevels}.`,
    );
  }

  const textureResolution = 1 << textureRes;
  const numberOfTextures1D = 1 << nTextRes;
  const numberOfPixels1D = textureResolution * numberOfTextures1D;
  const numberOfTextureBlocks =
    ((numberOfTextures1D + 1) * numberOfTextures1D) >> 1;

  // Decompressed size of one tile: every level at half a byte per texel (BC4).
  let bytesPerTexture = 0;
  for (let lev = 0; lev < mipMapLevels; lev++) {
    bytesPerTexture += 2 ** (2 * (textureRes - lev));
  }
  bytesPerTexture /= 2;

  // ---- 5. Contig positions on the map ----
  {
    let cumulativeFrac = 0;
    for (let i = 0; i < numberOfContigs; i++) {
      const startFrac = cumulativeFrac;
      cumulativeFrac += contigs[i].fractionalLength;

      contigs[i].length = Math.round(
        contigs[i].fractionalLength * totalGenomeLengthNum,
      );
      contigs[i].pixelStart = Math.min(numberOfPixels1D, Math.floor(startFrac * numberOfPixels1D));
      contigs[i].pixelEnd = Math.min(numberOfPixels1D, Math.floor(cumulativeFrac * numberOfPixels1D));
    }
    // The last contig extends to the end of the map.
    contigs[numberOfContigs - 1].pixelEnd = numberOfPixels1D;
  }

  return {
    header: {
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
    },
    contigs,
    tilesOffset,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

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
  /**
   * Optional progress callback for the slow tile inflate + decode phases,
   * reported on this function's own 0–100 scale. Large files spend seconds
   * here, so callers surface it to a progress bar.
   */
  onProgress?: (message: string, percent: number) => void;
}

/**
 * Parse a .pretext file from an ArrayBuffer.
 *
 * Throws PretextFormatError if the header or any map tile is missing, damaged
 * or the wrong size. Problems with the tracks after the map are returned in
 * `warnings`; the affected track is left out.
 */
export async function parsePretextFile(buffer: ArrayBuffer, options?: ParseOptions): Promise<PretextFile> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const { header, contigs, tilesOffset } = readPretextHeader(buffer);
  const {
    mipMapLevels, textureResolution, numberOfPixels1D, numberOfTextureBlocks, bytesPerTexture,
  } = header;
  let offset = tilesOffset;

  // Resolve coarsestOnly into decodeLevels
  if (options?.coarsestOnly && !options.decodeLevels) {
    options = { ...options, decodeLevels: [mipMapLevels - 1] };
  }

  // ---- 6. Read texture blocks ----
  // Phase 1: walk the tile section and collect each tile's compressed bytes
  // (cheap zero-copy subarrays; advances `offset` for extension parsing below).
  // Every tile must be present: a file that ends early is refused, not shown
  // with the missing part blank.
  const compTiles: Uint8Array[] = new Array(numberOfTextureBlocks);
  for (let i = 0; i < numberOfTextureBlocks; i++) {
    const tileLabel = `tile ${i + 1} of ${numberOfTextureBlocks}`;
    if (offset + 4 > bytes.length) {
      throw new PretextFormatError(
        `The file is incomplete: it ends before map ${tileLabel} (${bytes.length} bytes). ${INCOMPLETE_HINT}`,
      );
    }
    const compSize = view.getUint32(offset, true);
    offset += 4;
    if (compSize === 0) {
      throw new PretextFormatError(`The file is corrupt: map ${tileLabel} is empty.`);
    }
    if (offset + compSize > bytes.length) {
      throw new PretextFormatError(
        `The file is incomplete: it ends inside map ${tileLabel} ` +
          `(${bytes.length} bytes, at least ${offset + compSize} needed). ${INCOMPLETE_HINT}`,
      );
    }
    compTiles[i] = bytes.subarray(offset, offset + compSize);
    offset += compSize;
  }

  // Phase 2: inflate all tiles in parallel (native DecompressionStream when
  // available, ~1.8x faster than pako; falls back to pako otherwise). This is
  // the bulk of parse time on large files, so report incremental progress
  // (0–80% of this function's scale) as each tile finishes.
  const onProgress = options?.onProgress;
  let inflated = 0;
  const inflateStep = Math.max(1, Math.floor(numberOfTextureBlocks / 25));
  const inflatedTiles = await inflateRawTiles(
    compTiles,
    onProgress
      ? () => {
          inflated++;
          if (inflated % inflateStep === 0 || inflated === numberOfTextureBlocks) {
            onProgress('Decompressing tiles…', Math.round((inflated / numberOfTextureBlocks) * 80));
          }
        }
      : undefined,
  );

  // Every tile must hold exactly the bytes its levels need. Deflate carries no
  // checksum, so this size check is the only evidence that a tile is whole.
  const tiles: Uint8Array[] = new Array(numberOfTextureBlocks);
  for (let i = 0; i < numberOfTextureBlocks; i++) {
    const tile = inflatedTiles[i];
    const tileLabel = `tile ${i + 1} of ${numberOfTextureBlocks}`;
    if (!tile) {
      throw new PretextFormatError(`The file is corrupt: map ${tileLabel} does not decompress.`);
    }
    if (tile.length !== bytesPerTexture) {
      throw new PretextFormatError(
        `The file is corrupt: map ${tileLabel} holds ${tile.length} bytes, not the ${bytesPerTexture} its header calls for.`,
      );
    }
    tiles[i] = tile;
  }

  // Phase 3: decode the requested mip levels per tile
  // (80–100% of this function's scale).
  const tilesDecoded: Float32Array[][] = new Array(numberOfTextureBlocks);
  const decodeLevels = options?.decodeLevels;
  const decodeStep = Math.max(1, Math.floor(numberOfTextureBlocks / 15));
  for (let i = 0; i < numberOfTextureBlocks; i++) {
    if (onProgress && (i % decodeStep === 0)) {
      onProgress('Decoding tiles…', 80 + Math.round((i / numberOfTextureBlocks) * 20));
    }
    const levels: Float32Array[] = new Array(mipMapLevels);
    let levelOffset = 0;
    let levelRes = textureResolution;
    for (let lev = 0; lev < mipMapLevels; lev++) {
      if (!decodeLevels || decodeLevels.includes(lev)) {
        levels[lev] = decodeBC4Level(tiles[i], levelOffset, levelRes);
      }
      levelOffset += (levelRes * levelRes) >> 1; // BC4: 0.5 bytes/pixel
      levelRes >>= 1;
    }
    tilesDecoded[i] = levels;
  }

  // ---- 7. Read extensions (tracks) ----
  // Tracks follow the last tile directly, each starting with 'psgh'. A damaged
  // track is left out and reported; the map itself is already known to be whole.
  const extensions: PretextExtension[] = [];
  const warnings: string[] = [];
  const expectedSize = 64 + 4 * numberOfPixels1D;

  for (let trackNo = 1; offset < bytes.length; trackNo++) {
    const remaining = bytes.length - offset;
    const isTrack =
      remaining >= 4 &&
      bytes[offset] === 0x70 &&     // 'p'
      bytes[offset + 1] === 0x73 && // 's'
      bytes[offset + 2] === 0x67 && // 'g'
      bytes[offset + 3] === 0x68;   // 'h'
    if (!isTrack) {
      // Not something this reader knows. Searching it for a track signature
      // would be guessing, so everything from here on is left unread.
      warnings.push(
        `${remaining} bytes after the map were not recognised and were ignored. ` +
          'Any tracks stored there were not loaded.',
      );
      break;
    }
    if (remaining < 8) {
      warnings.push(`Track ${trackNo} is incomplete (the file ends inside it) and was not loaded.`);
      break;
    }
    const compSize = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + compSize > bytes.length) {
      warnings.push(`Track ${trackNo} is incomplete (the file ends inside it) and was not loaded.`);
      break;
    }
    const decompressed = tryInflateRaw(bytes.subarray(offset, offset + compSize));
    offset += compSize;

    if (!decompressed || decompressed.length < 64) {
      warnings.push(`Track ${trackNo} is corrupt (it does not decompress) and was not loaded.`);
      continue;
    }
    const extName = readName(decompressed, 0);
    if (decompressed.length !== expectedSize) {
      const values = Math.floor((decompressed.length - 64) / 4);
      warnings.push(
        `Track ${trackNo} ("${extName}") holds ${values} values, but the map is ${numberOfPixels1D} texels wide. ` +
          'It was not loaded.',
      );
      continue;
    }

    // Graph values: one s32 per map texel, starting at byte 64.
    const valuesView = new DataView(decompressed.buffer, decompressed.byteOffset + 64, 4 * numberOfPixels1D);
    const values = new Int32Array(numberOfPixels1D);
    for (let j = 0; j < numberOfPixels1D; j++) {
      values[j] = valuesView.getInt32(j * 4, true);
    }
    extensions.push({ name: extName, data: values });
  }

  return {
    header,
    contigs,
    tiles,
    tilesDecoded,
    extensions,
    warnings,
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
  /** See PretextFile.warnings. */
  warnings: string[];
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
  onProgress?.('Parsing header and metadata...', 10);
  // The overview is the coarsest stored level of every tile, held as one
  // matrix. Check that it is a size that can be held before reading any tile.
  {
    const h = readPretextHeader(buffer).header;
    const size = h.numberOfTextures1D * (h.textureResolution >> (h.mipMapLevels - 1));
    if (size > MAX_OVERVIEW_SIZE) {
      throw new PretextFormatError(
        `This file cannot be opened: its coarsest stored level makes an overview of ${size} texels per side, ` +
          `and the largest supported is ${MAX_OVERVIEW_SIZE}.`,
      );
    }
  }
  // Map the parser's own 0–100 progress (the slow inflate + decode phase, which
  // dominates load time on large files) into the 10–65% band of the overall bar.
  const parsed = await parsePretextFile(buffer, {
    coarsestOnly: true,
    onProgress: onProgress
      ? (msg, pct) => onProgress(msg, 10 + Math.round(pct * 0.55))
      : undefined,
  });
  const h = parsed.header;
  const mapSize = h.numberOfPixels1D;

  onProgress?.('Assembling contact map...', 65);
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
      const tileData = parsed.tilesDecoded[linIdx][coarsestMip];

      for (let py = 0; py < coarsestRes; py++) {
        for (let px = 0; px < coarsestRes; px++) {
          const val = tileData[py * coarsestRes + px];
          const gx = tx * coarsestRes + px;
          const gy = ty * coarsestRes + py;
          overview[gy * overviewSize + gx] = val;
          overview[gx * overviewSize + gy] = val;
        }
      }

      tilesDone++;
      if (tilesDone % Math.max(1, Math.floor(totalTiles / 20)) === 0) {
        onProgress?.(
          `Assembling tiles... (${tilesDone}/${totalTiles})`,
          65 + Math.round((tilesDone / totalTiles) * 25),
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
    warnings: parsed.warnings,
  };
}

export type OverviewMode = 'clean' | 'faithful';

/** Largest dimension (px) allowed for the faithful overview, bounding memory and
 *  compute. The finest mip whose full overview fits this cap is used. */
const FAITHFUL_MAX_SIZE = 2048;

/**
 * Re-assemble the overview texture from already-inflated raw BC4 tile bytes,
 * in the file's original contig order.
 *
 * - 'clean': decode the coarsest mip per tile — identical to what
 *   `parseAndAssemble` produces at load. The file's own averaging has dropped
 *   sparse off-diagonal contacts here, giving the familiar clean block-diagonal.
 * - 'faithful': decode a *finer* mip per tile and assemble it at that mip's
 *   native resolution (a larger overview). This is the file's own finer mean
 *   downsample, so it preserves structured off-diagonal/haplotype contacts the
 *   coarsest mip averages away — without the flooding that max-pooling to the
 *   coarse grid produces (a single contact would light a whole coarse cell).
 *
 * The faithful overview is therefore larger than the clean one; callers derive
 * the dimension from `overviewSize` / array length. Pure (no DOM/GPU).
 */
export function assembleOverview(
  rawTiles: Uint8Array[],
  header: PretextHeader,
  mode: OverviewMode,
): { overview: Float32Array; overviewSize: number } {
  const N = header.numberOfTextures1D;
  const coarsestMip = header.mipMapLevels - 1;

  // Clean uses the coarsest mip; faithful steps to the finest mip whose full
  // overview still fits FAITHFUL_MAX_SIZE.
  let srcMip = coarsestMip;
  if (mode === 'faithful') {
    while (srcMip > 0 && N * (header.textureResolution >> (srcMip - 1)) <= FAITHFUL_MAX_SIZE) {
      srcMip--;
    }
  }
  const srcRes = header.textureResolution >> srcMip;
  const overviewSize = N * srcRes;
  const overview = new Float32Array(overviewSize * overviewSize);

  // BC4 byte offset of srcMip within a tile (sum of finer levels' sizes).
  let srcOffset = 0;
  for (let lev = 0, r = header.textureResolution; lev < srcMip; lev++) {
    srcOffset += (r * r) >> 1;
    r >>= 1;
  }
  const srcBytes = (srcRes * srcRes) >> 1;

  for (let tx = 0; tx < N; tx++) {
    for (let ty = tx; ty < N; ty++) {
      const tile = rawTiles[tileLinearIndex(tx, ty, N)];
      if (!tile || srcOffset + srcBytes > tile.length) continue;
      const src = decodeBC4Level(tile, srcOffset, srcRes);

      for (let py = 0; py < srcRes; py++) {
        for (let px = 0; px < srcRes; px++) {
          const val = src[py * srcRes + px];
          const gx = tx * srcRes + px;
          const gy = ty * srcRes + py;
          overview[gy * overviewSize + gx] = val;
          overview[gx * overviewSize + gy] = val;
        }
      }
    }
  }

  return { overview, overviewSize };
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
 * Decode a single BC4 mipmap level from raw BC4 bytes.
 * Exported for cases where callers want to decode individual levels
 * from the raw tile data.
 */
export { decodeBC4Level, decodeBC4Block };
