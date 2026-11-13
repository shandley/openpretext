/**
 * What the parser does with a file that is short, damaged or inconsistent.
 *
 * A curator must never be shown a map that is partly missing without being
 * told. So damage to the header or to any map tile refuses the file with a
 * message saying what is wrong, and damage to the optional tracks after the
 * map loads the map and reports a warning.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import pako from 'pako';
import { createHash } from 'node:crypto';
import { buildSyntheticPretext, patternTexel, type SyntheticPretextSpec } from '../helpers/pretextWriter';
import {
  parsePretextFile, parseAndAssemble, PretextFormatError,
} from '../../src/formats/PretextParser';

const SPEC: SyntheticPretextSpec = {
  textureResLog2: 5,   // 32-texel tiles
  tilesLog2: 2,        // 4 x 4 tiles -> 128-texel map, 10 stored tiles
  mipMapLevels: 3,
  contigs: [
    { name: 'alpha', texels: 40 },
    { name: 'beta', texels: 24 },
    { name: 'gamma', texels: 64 },
  ],
  texel: patternTexel,
  extensions: [
    { name: 'coverage', values: Int32Array.from({ length: 128 }, (_, i) => 1000 - i) },
    { name: 'gaps', values: Int32Array.from({ length: 128 }, (_, i) => i % 7) },
  ],
};
const TILES = 10;
const GOOD = buildSyntheticPretext(SPEC);

function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Where things are in a well-formed file. */
function layout(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerComp = v.getUint32(4, true);
  let off = 12 + headerComp;
  const tiles: Array<{ sizeAt: number; dataAt: number; size: number }> = [];
  for (let i = 0; i < TILES; i++) {
    const size = v.getUint32(off, true);
    tiles.push({ sizeAt: off, dataAt: off + 4, size });
    off += 4 + size;
  }
  return { headerComp, tilesStart: 12 + headerComp, tilesEnd: off, tiles };
}

/** The same file with its header rewritten by `mutate`. */
function withHeader(mutate: (head: Uint8Array) => Uint8Array | void, declaredSize?: number): Uint8Array {
  const { headerComp } = layout(GOOD);
  let head = pako.inflateRaw(GOOD.subarray(12, 12 + headerComp));
  head = mutate(head) ?? head;
  const comp = pako.deflateRaw(head);
  return concat(GOOD.subarray(0, 4), u32(comp.length), u32(declaredSize ?? head.length), comp, GOOD.subarray(12 + headerComp));
}

/** The same file with tile `i` replaced by `data` (already compressed). */
function withTile(i: number, data: Uint8Array): Uint8Array {
  const t = layout(GOOD).tiles[i];
  return concat(GOOD.subarray(0, t.sizeAt), u32(data.length), data, GOOD.subarray(t.dataAt + t.size));
}

const HEADER_TAIL = 12 + SPEC.contigs.length * 68; // offset of the three texture bytes

async function failure(bytes: Uint8Array): Promise<Error> {
  try {
    await parsePretextFile(ab(bytes));
  } catch (e) {
    return e as Error;
  }
  throw new Error('the file was accepted');
}

async function refused(bytes: Uint8Array, message: RegExp): Promise<void> {
  const e = await failure(bytes);
  expect(e).toBeInstanceOf(PretextFormatError);
  expect(e.message).toMatch(message);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('a well-formed file', () => {
  it('loads with no warnings', async () => {
    const file = await parsePretextFile(ab(GOOD));
    expect(file.warnings).toEqual([]);
    expect(file.tiles).toHaveLength(TILES);
    expect(file.extensions.map((e) => e.name)).toEqual(['coverage', 'gaps']);
  });
});

describe('a file too short to hold a header', () => {
  it.each([0, 3, 4, 11])('refuses %i bytes', async (n) => {
    await refused(GOOD.subarray(0, n), n < 4 ? /not a \.pretext file|too short/i : /too short|incomplete/i);
  });

  it('refuses a file that is not .pretext', async () => {
    await refused(new TextEncoder().encode('>chr1\nACGTACGTACGTACGT\n'), /not a \.pretext file/i);
  });
});

describe('a damaged header', () => {
  it('refuses a header that runs past the end of the file', async () => {
    const bytes = GOOD.slice();
    new DataView(bytes.buffer).setUint32(4, bytes.length, true);
    await refused(bytes, /header.*(past|beyond) the end of the file/i);
  });

  it('refuses a header that does not decompress', async () => {
    const bytes = GOOD.slice();
    const { headerComp } = layout(GOOD);
    for (let i = 12; i < 12 + headerComp; i++) bytes[i] = 0xff;
    await refused(bytes, /header.*(corrupt|decompress)/i);
  });

  it('refuses a header whose size differs from the size it declares', async () => {
    await refused(withHeader(() => {}, 9999), /header/i);
  });

  it('refuses a contig count that does not fit the header', async () => {
    await refused(withHeader((h) => { new DataView(h.buffer).setUint32(8, 4, true); }), /4 contigs/);
    await refused(withHeader((h) => { new DataView(h.buffer).setUint32(8, 0, true); }), /contig/i);
    await refused(withHeader((h) => { new DataView(h.buffer).setUint32(8, 0xffffffff, true); }), /contig/i);
  });

  it('refuses a header cut short inside the contig table', async () => {
    await refused(withHeader((h) => h.slice(0, 12 + 68 + 20)), /header/i);
  });

  it('refuses a zero genome length', async () => {
    await refused(withHeader((h) => { h.fill(0, 0, 8); }), /genome length/i);
  });

  it.each([
    ['a tile size below one block', 1, 2, 1],
    ['a tile size too large', 20, 2, 3],
    ['too many tiles', 5, 12, 3],
    ['no mip levels', 5, 2, 0],
    ['more mip levels than the tile size allows', 5, 2, 5],
  ])('refuses %s', async (_label, res, n, mips) => {
    await refused(withHeader((h) => {
      h[HEADER_TAIL] = res; h[HEADER_TAIL + 1] = n; h[HEADER_TAIL + 2] = mips;
    }), /tile size|tiles per side|mip level/i);
  });

  it('refuses contig lengths that are not numbers, are negative, or do not fill the map', async () => {
    const setFraction = (i: number, f: number) => withHeader((h) => {
      new DataView(h.buffer).setFloat32(12 + i * 68, f, true);
    });
    await refused(setFraction(1, NaN), /contig 2 \(beta\)/);
    await refused(setFraction(0, -0.25), /contig 1 \(alpha\)/);
    await refused(setFraction(2, Infinity), /contig 3 \(gamma\)/);
    // gamma is half the map; shrinking it leaves a quarter of the map unowned.
    await refused(setFraction(2, 0.25), /contig lengths (add up|sum)/i);
    await refused(setFraction(2, 0.75), /contig lengths (add up|sum)/i);
  });
});

describe('a file that ends early', () => {
  const { tilesStart, tilesEnd, tiles } = layout(GOOD);

  it('refuses a file cut inside a tile, and says which', async () => {
    const t = tiles[6];
    const e = await failure(GOOD.subarray(0, t.dataAt + Math.floor(t.size / 2)));
    expect(e).toBeInstanceOf(PretextFormatError);
    expect(e.message).toMatch(/tile 7 of 10/);
    expect(e.message).toMatch(/incomplete/i);
  });

  it('refuses a file cut between tiles or inside a tile length', async () => {
    await refused(GOOD.subarray(0, tiles[3].sizeAt), /tile 4 of 10/);
    await refused(GOOD.subarray(0, tiles[3].sizeAt + 2), /tile 4 of 10/);
    await refused(GOOD.subarray(0, tilesStart), /tile 1 of 10/);
  });

  it('never accepts any prefix that ends before the last tile does', async () => {
    const cuts = new Set<number>();
    for (let n = 0; n < tilesEnd; n += 37) cuts.add(n);
    for (const t of tiles) { cuts.add(t.sizeAt); cuts.add(t.dataAt); cuts.add(t.dataAt + t.size - 1); }
    for (const n of cuts) {
      const e = await failure(GOOD.subarray(0, n));
      expect(e, `prefix of ${n} bytes`).toBeInstanceOf(PretextFormatError);
    }
  });

  it('loads the map but warns when the cut falls inside a track', async () => {
    const full = await parsePretextFile(ab(GOOD));
    for (const n of [tilesEnd + 2, tilesEnd + 6, tilesEnd + 40, GOOD.length - 1]) {
      const file = await parsePretextFile(ab(GOOD.subarray(0, n)));
      expect(file.tiles, `prefix of ${n} bytes`).toEqual(full.tiles);
      expect(file.warnings.length, `prefix of ${n} bytes`).toBeGreaterThan(0);
      expect(file.extensions.length).toBeLessThan(2);
    }
    const first = await parsePretextFile(ab(GOOD.subarray(0, GOOD.length - 1)));
    expect(first.extensions.map((e) => e.name)).toEqual(['coverage']);
    expect(first.warnings[0]).toMatch(/track/i);
  });

  it('loads a file that ends exactly after the map, with no warning', async () => {
    const file = await parsePretextFile(ab(GOOD.subarray(0, tilesEnd)));
    expect(file.extensions).toEqual([]);
    expect(file.warnings).toEqual([]);
  });
});

describe('a damaged tile', () => {
  const { tiles } = layout(GOOD);
  const bytesPerTile = (32 * 32 + 16 * 16 + 8 * 8) / 2;

  const cases: Array<[string, () => Uint8Array, RegExp]> = [
    ['bytes that do not decompress',
      () => { const b = GOOD.slice(); b.fill(0xff, tiles[4].dataAt, tiles[4].dataAt + tiles[4].size); return b; },
      /tile 5 of 10.*(corrupt|decompress)/i],
    ['a tile that decompresses to too few bytes',
      () => withTile(2, pako.deflateRaw(new Uint8Array(bytesPerTile - 8))), /tile 3 of 10/],
    ['a tile that decompresses to too many bytes',
      () => withTile(9, pako.deflateRaw(new Uint8Array(bytesPerTile + 8))), /tile 10 of 10/],
    ['an empty tile',
      () => withTile(0, new Uint8Array(0)), /tile 1 of 10/],
    // Right size once inflated, but the deflate stream is not finished.
    ['a tile whose compressed data never reaches its end marker',
      () => {
        const whole = pako.inflateRaw(GOOD.subarray(tiles[7].dataAt, tiles[7].dataAt + tiles[7].size));
        const d = new pako.Deflate({ raw: true });
        d.push(whole, 2 /* Z_SYNC_FLUSH: all the data, no final block */);
        const chunks = (d as unknown as { chunks: Uint8Array[] }).chunks;
        return withTile(7, concat(...chunks));
      },
      /tile 8 of 10/],
  ];

  it.each(cases)('refuses %s', async (_label, build, message) => {
    await refused(build(), message);
  });

  it.each(cases)('refuses %s without the browser decompressor', async (_label, build, message) => {
    vi.stubGlobal('DecompressionStream', undefined);
    await refused(build(), message);
  });

  it.each([['with', false], ['without', true]])(
    'reads a tile followed by spare bytes the same way %s the browser decompressor',
    async (_label, noStream) => {
      // The tile's data is whole; only slack follows it. Runtimes disagree on
      // whether DecompressionStream tolerates this, so the result must not
      // depend on which one is in use.
      if (noStream) vi.stubGlobal('DecompressionStream', undefined);
      const t = tiles[3];
      const padded = withTile(3, concat(GOOD.subarray(t.dataAt, t.dataAt + t.size), new Uint8Array([0x00, 0x41])));
      const file = await parsePretextFile(ab(padded));
      const good = await parsePretextFile(ab(GOOD));
      expect(file.tiles).toEqual(good.tiles);
      expect(file.extensions.map((e) => e.name)).toEqual(['coverage', 'gaps']);
      expect(file.warnings).toEqual([]);
    },
  );

  it('a single flipped byte in a tile is either refused or changes nothing silently', async () => {
    // Deflate has no checksum, so a flip can survive decompression. What must
    // not happen is a tile of the wrong size being accepted.
    const t = tiles[5];
    for (let k = 0; k < t.size; k += 5) {
      const b = GOOD.slice();
      b[t.dataAt + k] ^= 0x10;
      try {
        const file = await parsePretextFile(ab(b));
        expect(file.tiles[5].length).toBe(bytesPerTile);
      } catch (e) {
        expect(e).toBeInstanceOf(PretextFormatError);
      }
    }
  });
});

describe('damage after the map', () => {
  const { tilesEnd } = layout(GOOD);

  it('warns about bytes it does not recognise and keeps the map', async () => {
    const junk = new Uint8Array(50).fill(0x41);
    const file = await parsePretextFile(ab(concat(GOOD.subarray(0, tilesEnd), junk)));
    expect(file.tiles).toHaveLength(TILES);
    expect(file.extensions).toEqual([]);
    expect(file.warnings).toHaveLength(1);
    expect(file.warnings[0]).toMatch(/50 bytes/);
  });

  it('does not go looking for a track inside unrecognised bytes', async () => {
    // Junk, then a real track. Reading on past junk would be guessing.
    const junk = new Uint8Array(9).fill(0x41);
    const file = await parsePretextFile(ab(concat(GOOD.subarray(0, tilesEnd), junk, GOOD.subarray(tilesEnd))));
    expect(file.extensions).toEqual([]);
    expect(file.warnings).toHaveLength(1);
  });

  it('skips a track that does not decompress, and keeps the next one', async () => {
    const b = GOOD.slice();
    const size = new DataView(b.buffer).getUint32(tilesEnd + 4, true);
    b.fill(0xff, tilesEnd + 8, tilesEnd + 8 + size);
    const file = await parsePretextFile(ab(b));
    expect(file.extensions.map((e) => e.name)).toEqual(['gaps']);
    expect(file.warnings).toHaveLength(1);
    expect(file.warnings[0]).toMatch(/track 1/i);
  });

  it('skips a track with the wrong number of values', async () => {
    const body = new Uint8Array(64 + 4 * 100);
    body.set(new TextEncoder().encode('short'), 0);
    const comp = pako.deflateRaw(body);
    const ext = concat(new Uint8Array([0x70, 0x73, 0x67, 0x68]), u32(comp.length), comp);
    const file = await parsePretextFile(ab(concat(GOOD.subarray(0, tilesEnd), ext)));
    expect(file.extensions).toEqual([]);
    expect(file.warnings[0]).toMatch(/short/);
    expect(file.warnings[0]).toMatch(/128/);
  });
});

describe('parseAndAssemble', () => {
  it('reports the size, MD5 and SHA-256 of the file it read', async () => {
    const out = await parseAndAssemble(ab(GOOD));
    expect(out.checksums).toEqual({
      byteLength: GOOD.length,
      md5: createHash('md5').update(GOOD).digest('hex'),
      sha256: createHash('sha256').update(GOOD).digest('hex'),
    });
    // One changed byte in a track changes both.
    const flipped = GOOD.slice();
    flipped[flipped.length - 3] ^= 1;
    const sums = (await parseAndAssemble(ab(flipped)).catch(() => null))?.checksums;
    if (sums) {
      expect(sums.md5).not.toBe(out.checksums.md5);
      expect(sums.sha256).not.toBe(out.checksums.sha256);
    }
  });

  it('passes warnings through', async () => {
    const { tilesEnd } = layout(GOOD);
    const out = await parseAndAssemble(ab(concat(GOOD.subarray(0, tilesEnd), new Uint8Array(5).fill(1))));
    expect(out.warnings).toHaveLength(1);
  });

  it('refuses a file whose coarsest level is too large to hold as one overview', async () => {
    // 64 tiles per side of 256 texels with a single level: a 16384-texel overview.
    const head = new Uint8Array(15 + 68);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 1_000_000, true);
    hv.setUint32(8, 1, true);
    hv.setFloat32(12, 1, true);
    head[12 + 68] = 8; head[13 + 68] = 6; head[14 + 68] = 1;
    const comp = pako.deflateRaw(head);
    const bytes = concat(new Uint8Array([0x70, 0x73, 0x74, 0x6d]), u32(comp.length), u32(head.length), comp);
    const e = await parseAndAssemble(ab(bytes)).then(() => null, (err: Error) => err);
    expect(e).toBeInstanceOf(PretextFormatError);
    expect(e!.message).toMatch(/overview/i);
  });
});
