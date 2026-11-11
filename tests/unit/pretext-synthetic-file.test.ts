/**
 * The parser and tile decoder, on a complete file in the real format.
 *
 * tests/helpers/pretextWriter.ts builds the file from the format description
 * with a known value for every texel at every mip level. These tests read it
 * back through the same code the app uses.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSyntheticPretext, encodeBC4BlockExact, patternTexel, type SyntheticPretextSpec,
} from '../helpers/pretextWriter';
import {
  parsePretextFile, parseAndAssemble, assembleOverview, isPretextFile, decodeBC4Block,
} from '../../src/formats/PretextParser';
import { decodeTile } from '../../src/renderer/TileDecoder';

const SPEC: SyntheticPretextSpec = {
  textureResLog2: 5,   // 32-texel tiles
  tilesLog2: 2,        // 4 x 4 tiles -> 128-texel map
  mipMapLevels: 3,     // 32, 16, 8 texels per tile
  contigs: [
    { name: 'alpha', texels: 40 },
    { name: 'beta', texels: 24 },
    { name: 'gamma', texels: 64 },
  ],
  texel: patternTexel,
  extensions: [{ name: 'coverage', values: Int32Array.from({ length: 128 }, (_, i) => 1000 - i) }],
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('encodeBC4BlockExact', () => {
  const decode = (block: Uint8Array): number[] => {
    const pixels = new Uint8Array(16);
    decodeBC4Block(block, 0, new Uint8Array(8), pixels);
    return Array.from(pixels);
  };

  it('round-trips a single value, two values, and a value with 0 and 255', () => {
    const one = new Array(16).fill(77);
    const two = Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? 200 : 13));
    const three = Array.from({ length: 16 }, (_, i) => [120, 0, 255, 120][i % 4]);
    expect(decode(encodeBC4BlockExact(one))).toEqual(one);
    expect(decode(encodeBC4BlockExact(two))).toEqual(two);
    expect(decode(encodeBC4BlockExact(three))).toEqual(three);
  });

  it('refuses a block it cannot represent exactly', () => {
    expect(() => encodeBC4BlockExact(Array.from({ length: 16 }, (_, i) => i * 10))).toThrow(/not exactly encodable/);
  });
});

describe('a complete synthetic .pretext file', () => {
  const bytes = buildSyntheticPretext(SPEC);
  const buffer = toArrayBuffer(bytes);

  it('is recognised as a pretext file', () => {
    expect(isPretextFile(buffer)).toBe(true);
  });

  it('parses the header and contigs', async () => {
    const file = await parsePretextFile(buffer);
    expect(file.header.textureResolution).toBe(32);
    expect(file.header.numberOfTextures1D).toBe(4);
    expect(file.header.numberOfPixels1D).toBe(128);
    expect(file.header.mipMapLevels).toBe(3);
    expect(file.header.numberOfTextureBlocks).toBe(10);
    expect(file.header.totalGenomeLength).toBe(128000n);
    expect(file.contigs.map((c) => c.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(file.contigs.map((c) => [c.pixelStart, c.pixelEnd])).toEqual([[0, 40], [40, 64], [64, 128]]);
    expect(file.contigs.map((c) => c.length)).toEqual([40000, 24000, 64000]);
  });

  it('reads the graph extension', async () => {
    const file = await parsePretextFile(buffer);
    expect(file.extensions.map((e) => e.name)).toEqual(['coverage']);
    expect(Array.from(file.extensions[0].data.slice(0, 3))).toEqual([1000, 999, 998]);
    expect(file.extensions[0].data[127]).toBe(873);
  });

  it('decodes every texel of every tile at every level to the value written', async () => {
    const file = await parsePretextFile(buffer);
    const n = file.header.numberOfTextures1D;
    let checked = 0;
    for (let level = 0; level < 3; level++) {
      const res = 32 >> level;
      const tmLevel = 2 - level; // TileManager counts up from the coarsest
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const data = decodeTile({ level: tmLevel, col, row }, file.tiles, file.header);
          expect(data.length).toBe(res * res);
          for (let py = 0; py < res; py++) {
            for (let px = 0; px < res; px++) {
              const want = patternTexel(level, col * res + px, row * res + py);
              const got = Math.round(data[py * res + px] * 255);
              if (got !== want) {
                throw new Error(`level ${level} tile (${col},${row}) texel (${px},${py}): got ${got}, want ${want}`);
              }
              checked++;
            }
          }
        }
      }
    }
    // 16 tiles x (32^2 + 16^2 + 8^2) texels
    expect(checked).toBe(16 * (1024 + 256 + 64));
  });

  it('assembles the coarsest level as the load-time overview', async () => {
    const assembled = await parseAndAssemble(buffer);
    expect(assembled.overviewSize).toBe(32);
    expect(assembled.mapSize).toBe(128);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        expect(Math.round(assembled.overview[y * 32 + x] * 255)).toBe(patternTexel(2, x, y));
      }
    }
  });

  it('assembles the finer overview from the finest level that fits', async () => {
    const file = await parsePretextFile(buffer);
    const { overview, overviewSize } = assembleOverview(file.tiles, file.header, 'faithful');
    expect(overviewSize).toBe(128); // the whole map is under the 2048 cap
    for (const [x, y] of [[0, 0], [5, 100], [100, 5], [127, 127], [63, 64], [40, 39]]) {
      expect(Math.round(overview[y * 128 + x] * 255)).toBe(patternTexel(0, x, y));
    }
  });

  it('produces a symmetric map', async () => {
    const file = await parsePretextFile(buffer);
    const { overview } = assembleOverview(file.tiles, file.header, 'faithful');
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < y; x++) {
        if (overview[y * 128 + x] !== overview[x * 128 + y]) throw new Error(`asymmetric at (${x},${y})`);
      }
    }
  });
});
