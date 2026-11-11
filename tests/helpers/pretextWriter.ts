/**
 * Build a valid `.pretext` file in memory, for tests.
 *
 * Real `.pretext` files are tens of megabytes and cannot be committed, which
 * left the parser's file handling, the tile decoder and the renderer without
 * any test that runs in CI. This writer produces a small file in the real
 * format whose every texel, at every mip level, is known to the test.
 *
 * It is written from the format description in docs/PRETEXT_FORMAT.md, not by
 * inverting the parser, and it encodes BC4 blocks exactly: a block must hold
 * values the format can represent without fitting, otherwise it throws. So a
 * test that reads back a different value has found a real disagreement.
 *
 * Layout (all integers little-endian):
 *   'pstm' | u32 compressed header size | u32 header size | deflate(header)
 *   then, per upper-triangle tile in linear order: u32 size | deflate(tile)
 *   then, per graph extension: 'psgh' | u32 size | deflate(name[64] + i32 per pixel)
 * Header: u64 total bp | u32 contigs | per contig (f32 fraction, char[64] name)
 *         | u8 log2(tile res) | u8 log2(tiles per axis) | u8 mip levels
 * Tile: each mip level's BC4 data, finest first.
 */

import pako from 'pako';

export interface SyntheticContig {
  name: string;
  /** Width in full-resolution texels. Widths must sum to the map size. */
  texels: number;
}

export interface SyntheticPretextSpec {
  /** log2 of a tile's side in texels at the finest level (>= 2). */
  textureResLog2: number;
  /** log2 of the number of tiles per axis. */
  tilesLog2: number;
  /** Number of mip levels stored per tile (finest first). */
  mipMapLevels: number;
  contigs: SyntheticContig[];
  /** Base pairs per full-resolution texel. Default 1000. */
  bpPerTexel?: number;
  /**
   * Value (0-255) of the texel at column `x`, row `y` of the whole map at mip
   * level `level` (0 = finest). Called only for the stored triangle, where
   * the texel's tile column is <= its tile row; the map is mirrored from it.
   */
  texel: (level: number, x: number, y: number) => number;
  /** Optional graph extensions: one value per full-resolution texel. */
  extensions?: Array<{ name: string; values: Int32Array }>;
}

/**
 * Encode 16 values (index = dx * 4 + dy, column-major as PretextMap packs
 * them) as one exact BC4 block. Exactly representable blocks are:
 *   - at most two distinct values, or
 *   - one value v plus any of 0 and 255.
 */
export function encodeBC4BlockExact(values: number[]): Uint8Array {
  if (values.length !== 16) throw new Error('A BC4 block has 16 values');
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`Texel value ${v} is not a byte`);
  }
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  let alpha0: number;
  let alpha1: number;
  let indexOf: (v: number) => number;

  if (distinct.length <= 2) {
    const lo = distinct[0];
    const hi = distinct[distinct.length - 1];
    if (hi > lo) {
      // alpha0 > alpha1: eight-value mode; index 0 is alpha0, index 1 is alpha1.
      alpha0 = hi; alpha1 = lo;
      indexOf = (v) => (v === hi ? 0 : 1);
    } else {
      // alpha0 == alpha1: six-value mode; index 0 is alpha0.
      alpha0 = lo; alpha1 = lo;
      indexOf = () => 0;
    }
  } else {
    // One mid value plus 0 and/or 255: alpha0 == alpha1 == mid puts the block
    // in six-value mode, where index 6 is 0 and index 7 is 255.
    const mids = distinct.filter((v) => v !== 0 && v !== 255);
    if (mids.length !== 1) {
      throw new Error(`BC4 block is not exactly encodable: values ${distinct.join(', ')}`);
    }
    const mid = mids[0];
    alpha0 = mid; alpha1 = mid;
    indexOf = (v) => (v === mid ? 0 : v === 0 ? 6 : 7);
  }

  // 16 three-bit indices, little-endian across six bytes.
  let bits = 0n;
  values.forEach((v, i) => { bits |= BigInt(indexOf(v)) << BigInt(3 * i); });
  const out = new Uint8Array(8);
  out[0] = alpha0;
  out[1] = alpha1;
  for (let b = 0; b < 6; b++) out[2 + b] = Number((bits >> BigInt(8 * b)) & 0xffn);
  return out;
}

/** Encode a square image (`at(px, py)` = value at column px, row py) as BC4. */
function encodeBC4Level(res: number, at: (px: number, py: number) => number): Uint8Array {
  const blocks = res >> 2;
  const out = new Uint8Array(blocks * blocks * 8);
  let ptr = 0;
  // Blocks run column by column: outer x, inner y.
  for (let bx = 0; bx < blocks; bx++) {
    for (let by = 0; by < blocks; by++) {
      const values: number[] = new Array(16);
      for (let dx = 0; dx < 4; dx++) {
        for (let dy = 0; dy < 4; dy++) values[dx * 4 + dy] = at(bx * 4 + dx, by * 4 + dy);
      }
      out.set(encodeBC4BlockExact(values), ptr);
      ptr += 8;
    }
  }
  return out;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function fixedName(name: string): Uint8Array {
  const b = new Uint8Array(64);
  for (let i = 0; i < Math.min(63, name.length); i++) b[i] = name.charCodeAt(i) & 0xff;
  return b;
}

/** Build the file. Returns its bytes. */
export function buildSyntheticPretext(spec: SyntheticPretextSpec): Uint8Array {
  const tileRes = 1 << spec.textureResLog2;
  const tiles = 1 << spec.tilesLog2;
  const mapSize = tileRes * tiles;
  if (tileRes >> (spec.mipMapLevels - 1) < 4) {
    throw new Error('The coarsest mip level must be at least 4 texels (one BC4 block) per tile');
  }
  const totalTexels = spec.contigs.reduce((n, c) => n + c.texels, 0);
  if (totalTexels !== mapSize) {
    throw new Error(`Contig widths sum to ${totalTexels}, but the map is ${mapSize} texels`);
  }
  const bpPerTexel = spec.bpPerTexel ?? 1000;
  const totalBp = BigInt(mapSize) * BigInt(bpPerTexel);

  // ---- header ----
  const head = new Uint8Array(8 + 4 + spec.contigs.length * 68 + 3);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, Number(totalBp & 0xffffffffn), true);
  hv.setUint32(4, Number(totalBp >> 32n), true);
  hv.setUint32(8, spec.contigs.length, true);
  let off = 12;
  for (const c of spec.contigs) {
    hv.setFloat32(off, c.texels / mapSize, true);
    head.set(fixedName(c.name), off + 4);
    off += 68;
  }
  head[off] = spec.textureResLog2;
  head[off + 1] = spec.tilesLog2;
  head[off + 2] = spec.mipMapLevels;
  const headComp = pako.deflateRaw(head);

  const parts: Uint8Array[] = [
    new Uint8Array([0x70, 0x73, 0x74, 0x6d]), // 'pstm'
    u32(headComp.length),
    u32(head.length),
    headComp,
  ];

  // ---- tiles: (tx, ty) with tx <= ty, in linear order ----
  for (let tx = 0; tx < tiles; tx++) {
    for (let ty = tx; ty < tiles; ty++) {
      const levels: Uint8Array[] = [];
      for (let level = 0; level < spec.mipMapLevels; level++) {
        const res = tileRes >> level;
        levels.push(encodeBC4Level(res, (px, py) => spec.texel(level, tx * res + px, ty * res + py)));
      }
      const comp = pako.deflateRaw(concat(levels));
      parts.push(u32(comp.length), comp);
    }
  }

  // ---- graph extensions ----
  for (const ext of spec.extensions ?? []) {
    if (ext.values.length !== mapSize) throw new Error(`Extension ${ext.name} needs ${mapSize} values`);
    const body = new Uint8Array(64 + 4 * mapSize);
    body.set(fixedName(ext.name), 0);
    const bv = new DataView(body.buffer);
    for (let i = 0; i < mapSize; i++) bv.setInt32(64 + 4 * i, ext.values[i], true);
    const comp = pako.deflateRaw(body);
    parts.push(new Uint8Array([0x70, 0x73, 0x67, 0x68]), u32(comp.length), comp); // 'psgh'
  }

  return concat(parts);
}

// ---------------------------------------------------------------------------
// A ready-made pattern
// ---------------------------------------------------------------------------

function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b) ^ Math.imul(c + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * A symmetric, position-identifying test pattern.
 *
 * Every 4x4 block has its own mid value (64-191, in steps of 8), and each
 * texel in it is that value, 0 or 255, chosen by a hash of the texel's
 * position and the mip level. So a texel read from the wrong place, the wrong
 * orientation or the wrong level almost always has the wrong value, and the
 * values differ by enough that colour-map rounding cannot hide it. The
 * pattern is symmetric (value(x, y) = value(y, x)), as a contact map is.
 */
export function patternTexel(level: number, x: number, y: number): number {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  const mid = 64 + (hash3(a >> 2, b >> 2, level) % 17) * 8;
  const pick = hash3(a, b, level + 100) % 4;
  return pick === 0 ? 0 : pick === 1 ? 255 : mid;
}
