import { describe, it, expect } from 'vitest';
import { decodeBC4Block, decodeBC4Level } from '../../src/formats/PretextParser';

/**
 * Ground-truth tests for the BC4 (RGTC1) codec.
 *
 * Every number the tool displays or computes comes out of this decoder, so an
 * error here is silent and total. The expected values below are therefore
 * derived from the specifications, never from the decoder's own output. Two
 * independent sources are involved and each assertion cites the one it rests on:
 *
 *   [RGTC]   EXT_texture_compression_rgtc, COMPRESSED_RED_RGTC1. Defines the
 *            block layout: bytes red0, red1, bits_0..bits_5; the 48-bit vector
 *            bits = bits_0 + 256*(bits_1 + 256*(...)); the per-texel control
 *            code code(x,y) = bits[3*(4*y+x)+2 .. 3*(4*y+x)+0]; the two
 *            interpolation tables; and MINRED/MAXRED = 0.0/1.0.
 *
 *   [FORMAT] docs/PRETEXT_FORMAT.md sections 4.5 and 5. Defines how PretextMap
 *            *feeds* image pixels to stb_compress_bc4_block: 4x4 blocks are
 *            emitted column-major over the tile (outer x, inner y) and pixels
 *            within a block are also column-major (outer dxt_x, inner dxt_y).
 *            RGTC says nothing about this; it is a property of the writer.
 *
 * Combining the two: the k-th control code in the bit vector describes the k-th
 * pixel handed to the encoder, which is image pixel (x0 + (k >> 2), y0 + (k & 3)).
 * The block's internal (x,y) is thus the transpose of the image's.
 */

// ---------------------------------------------------------------------------
// Block construction helpers (the test's own encoder)
// ---------------------------------------------------------------------------

/**
 * Assemble one 8-byte BC4 block from endpoints and 16 three-bit control codes.
 *
 * `codes[k]` is the code for the k-th texel in [RGTC] numbering. BigInt keeps
 * the 48-bit vector exact and, more importantly, keeps this helper structurally
 * different from the decoder (which reads the field as two 24-bit halves) so a
 * shared misreading of the bit order cannot cancel out. `packBlock` itself is
 * pinned against hand-computed bytes in the first describe block below.
 */
function packBlock(alpha0: number, alpha1: number, codes: number[]): Uint8Array {
  if (codes.length !== 16) throw new Error('a BC4 block holds exactly 16 codes');
  let bits = 0n;
  for (let k = 0; k < 16; k++) {
    if (codes[k] < 0 || codes[k] > 7) throw new Error(`code ${k} out of 3-bit range`);
    bits |= BigInt(codes[k]) << BigInt(3 * k);
  }
  const block = new Uint8Array(8);
  block[0] = alpha0;
  block[1] = alpha1;
  for (let b = 0; b < 6; b++) {
    block[2 + b] = Number((bits >> BigInt(8 * b)) & 0xffn);
  }
  return block;
}

/** Every texel in the block gets the same control code. */
function uniformCodes(code: number): number[] {
  return new Array(16).fill(code);
}

/** Decode a single block and return its 16 raw u8 texel values. */
function decodeOneBlock(block: Uint8Array, offset = 0): Uint8Array {
  const palette = new Uint8Array(8);
  const pixels = new Uint8Array(16);
  decodeBC4Block(block, offset, palette, pixels);
  return pixels;
}

/** Decode a single block and return the 8-entry interpolation table it built. */
function paletteOf(alpha0: number, alpha1: number): Uint8Array {
  const palette = new Uint8Array(8);
  const pixels = new Uint8Array(16);
  decodeBC4Block(packBlock(alpha0, alpha1, uniformCodes(0)), 0, palette, pixels);
  return palette;
}

// ---------------------------------------------------------------------------
// The test's own packer, checked by hand
// ---------------------------------------------------------------------------

describe('packBlock (test fixture, verified against [RGTC] by hand)', () => {
  it('places endpoints in bytes 0 and 1', () => {
    const block = packBlock(200, 100, uniformCodes(0));
    expect(block[0]).toBe(200);
    expect(block[1]).toBe(100);
    expect(Array.from(block.slice(2))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('packs code 0 into the three least significant bits of bits_0', () => {
    // code(0) occupies bits 2..0, so bits = 7 and only bits_0 is non-zero.
    const block = packBlock(0, 0, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(block.slice(2))).toEqual([0x07, 0, 0, 0, 0, 0]);
  });

  it('splits a code that straddles the bits_0/bits_1 byte boundary', () => {
    // code(2) occupies bits 8..6. Value 5 = 0b101 puts bit6=1, bit7=0, bit8=1,
    // so bits = 5 << 6 = 0x140: bits_0 = 0x40, bits_1 = 0x01.
    const block = packBlock(0, 0, [0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(block.slice(2))).toEqual([0x40, 0x01, 0, 0, 0, 0]);
  });

  it('splits a code that straddles the bits_1/bits_2 byte boundary', () => {
    // code(5) occupies bits 17..15. Value 7 = 0b111 gives bits = 7 << 15 =
    // 0x38000: bits_1 = 0x80 (bit 15), bits_2 = 0x03 (bits 16 and 17).
    const block = packBlock(0, 0, [0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(block.slice(2))).toEqual([0x00, 0x80, 0x03, 0, 0, 0]);
  });

  it('splits a code that straddles the bits_3/bits_4 byte boundary', () => {
    // code(10) occupies bits 32..30. Value 7 gives bits = 7 << 30 = 0x1C0000000:
    // bits_3 = 0xC0 (bits 30, 31), bits_4 = 0x01 (bit 32). This one also sits in
    // the upper half of the 48-bit field, where the decoder switches accumulator.
    const block = packBlock(0, 0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0]);
    expect(Array.from(block.slice(2))).toEqual([0x00, 0x00, 0x00, 0xc0, 0x01, 0x00]);
  });

  it('sets the most significant bit of bits_5 for the last texel', () => {
    // code(15) occupies bits 47..45, the top of the vector.
    const block = packBlock(0, 0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
    expect(Array.from(block.slice(2))).toEqual([0, 0, 0, 0, 0, 0xe0]);
  });
});

// ---------------------------------------------------------------------------
// Interpolation tables [RGTC]
// ---------------------------------------------------------------------------

describe('BC4 interpolation table', () => {
  it('yields a constant block when both endpoints are equal and no special code is used', () => {
    // red0 == red1 selects the 6-value branch, where codes 0..5 all evaluate to
    // the shared endpoint: (4a + a)/5 = a, (3a + 2a)/5 = a, and so on.
    const pixels = decodeOneBlock(packBlock(137, 137, uniformCodes(0)));
    expect(Array.from(pixels)).toEqual(new Array(16).fill(137));

    for (const code of [1, 2, 3, 4, 5]) {
      const p = decodeOneBlock(packBlock(137, 137, uniformCodes(code)));
      expect(Array.from(p)).toEqual(new Array(16).fill(137));
    }
  });

  it('still emits MINRED/MAXRED for codes 6 and 7 when the endpoints are equal', () => {
    // Equal endpoints do NOT make a block uniform: red0 <= red1 holds, so codes
    // 6 and 7 are the 0.0/1.0 escapes and ignore the endpoints entirely. A
    // decoder that short-circuits "endpoints equal => constant" breaks here.
    expect(Array.from(decodeOneBlock(packBlock(137, 137, uniformCodes(6))))).toEqual(
      new Array(16).fill(0),
    );
    expect(Array.from(decodeOneBlock(packBlock(137, 137, uniformCodes(7))))).toEqual(
      new Array(16).fill(255),
    );
  });

  it('builds the 8-value table when red0 > red1', () => {
    // Endpoints 70 and 0 make every seventh exact: 6*70/7 = 60, 5*70/7 = 50,
    // 4*70/7 = 40, 3*70/7 = 30, 2*70/7 = 20, 1*70/7 = 10. Choosing an exactly
    // divisible pair keeps the expectation independent of rounding mode.
    expect(Array.from(paletteOf(70, 0))).toEqual([70, 0, 60, 50, 40, 30, 20, 10]);
  });

  it('builds the 6-value table plus MINRED/MAXRED when red0 <= red1', () => {
    // Endpoints 10 and 60 divide exactly by 5: (4*10+60)/5 = 20,
    // (3*10+2*60)/5 = 30, (2*10+3*60)/5 = 40, (10+4*60)/5 = 50.
    expect(Array.from(paletteOf(10, 60))).toEqual([10, 60, 20, 30, 40, 50, 0, 255]);
  });

  it('selects the mode strictly on red0 > red1, not on a tolerance', () => {
    // One-apart endpoints separate the two branches sharply at codes 6 and 7:
    // under the 8-value table both are ~100, under the 6-value table they are
    // the 0/255 escapes. A decoder using >= or a near-equality test fails here.
    expect(Array.from(paletteOf(101, 100))).toEqual([
      101,
      100,
      // (6*101 + 100)/7 = 706/7 = 100.857 -> 101
      101,
      // (5*101 + 2*100)/7 = 705/7 = 100.714 -> 101
      101,
      // (4*101 + 3*100)/7 = 704/7 = 100.571 -> 101
      101,
      // (3*101 + 4*100)/7 = 703/7 = 100.429 -> 100
      100,
      // (2*101 + 5*100)/7 = 702/7 = 100.286 -> 100
      100,
      // (101 + 6*100)/7 = 701/7 = 100.143 -> 100
      100,
    ]);

    expect(Array.from(paletteOf(100, 101))).toEqual([
      100,
      101,
      // (4*100 + 101)/5 = 501/5 = 100.2 -> 100
      100,
      // (3*100 + 2*101)/5 = 502/5 = 100.4 -> 100
      100,
      // (2*100 + 3*101)/5 = 503/5 = 100.6 -> 101
      101,
      // (100 + 4*101)/5 = 504/5 = 100.8 -> 101
      101,
      0,
      255,
    ]);
  });

  it('quantises inexact interpolants to within half a step of the exact value', () => {
    // [RGTC] defines the arithmetic on normalised values, so (6*RED0+RED1)/7 is
    // an exact rational that generally has no 8-bit representation. The tightest
    // error an 8-bit intermediate can achieve is half a step; anything looser
    // (truncation, for instance) exceeds it. N/7 and N/5 never land on .5 for
    // integer N, so the nearest value is never ambiguous.
    const palette = paletteOf(255, 0);
    const exact = [255, 0, (6 * 255) / 7, (5 * 255) / 7, (4 * 255) / 7, (3 * 255) / 7, (2 * 255) / 7, 255 / 7];
    for (let i = 0; i < 8; i++) {
      expect(Math.abs(palette[i] - exact[i])).toBeLessThanOrEqual(0.5);
    }
  });

  it('reads endpoints and codes from the requested byte offset', () => {
    // Mipmap levels are concatenated in one buffer, so every level past the
    // finest is decoded at a non-zero offset. A decoder that ignores the offset
    // would return the first block here.
    const buffer = new Uint8Array(16);
    buffer.set(packBlock(9, 9, uniformCodes(0)), 0);
    buffer.set(packBlock(70, 0, uniformCodes(2)), 8);
    expect(Array.from(decodeOneBlock(buffer, 8))).toEqual(new Array(16).fill(60));
  });
});

// ---------------------------------------------------------------------------
// Per-texel bit field and spatial layout
// ---------------------------------------------------------------------------

describe('decodeBC4Level texel placement', () => {
  it('maps all 16 control codes to their own texel, including every straddling field', () => {
    // The centrepiece. Endpoints 70/0 give the exactly divisible 8-value table
    // [70, 0, 60, 50, 40, 30, 20, 10], and the codes run 0..7 then 7..0 so no two
    // adjacent texels share a value and every one of the 16 three-bit fields --
    // several of which cross byte boundaries, one of which crosses the halfway
    // point of the 48-bit vector -- is checked independently.
    //
    // Placement per [FORMAT] section 5: code k belongs to the k-th pixel the
    // encoder was handed, i.e. image pixel (x = k >> 2, y = k & 3).
    const codes = [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0];
    const table = [70, 0, 60, 50, 40, 30, 20, 10];
    const out = decodeBC4Level(packBlock(70, 0, codes), 0, 4);

    expect(out.length).toBe(16);
    for (let k = 0; k < 16; k++) {
      const x = k >> 2;
      const y = k & 3;
      expect(out[y * 4 + x]).toBeCloseTo(table[codes[k]] / 255, 6);
    }
  });

  it('varies along x, not y, when the codes vary along x (transpose guard)', () => {
    // Restatement of the same mapping in a form a transpose cannot survive: all
    // four pixels of an encoder-order group share a code, so each *column* of
    // the decoded image is constant. Row-major within-block handling would
    // produce constant rows instead, which on a symmetric Hi-C matrix off the
    // diagonal silently reflects signal across the wrong axis.
    const codes = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
    const expectedColumn = [70, 0, 60, 50];
    const out = decodeBC4Level(packBlock(70, 0, codes), 0, 4);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(out[y * 4 + x]).toBeCloseTo(expectedColumn[x] / 255, 6);
      }
    }
  });

  it('walks blocks down each column before moving right', () => {
    // [FORMAT] section 5: the encoder loop is `for x { for y { ... } }`, so the
    // second block on disk is the one *below* the first, not to its right. Four
    // constant blocks at 8x8 make the two orders disagree: a row-major reader
    // would place value 20 at the top right instead of the bottom left.
    const values = [10, 20, 30, 40];
    const data = new Uint8Array(4 * 8);
    values.forEach((v, i) => data.set(packBlock(v, v, uniformCodes(0)), i * 8));

    const out = decodeBC4Level(data, 0, 8);

    // Block order on disk: (bx=0,by=0), (0,1), (1,0), (1,1).
    const expectedByQuadrant = [
      { x0: 0, y0: 0, value: 10 },
      { x0: 0, y0: 4, value: 20 },
      { x0: 4, y0: 0, value: 30 },
      { x0: 4, y0: 4, value: 40 },
    ];
    for (const { x0, y0, value } of expectedByQuadrant) {
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = x0; x < x0 + 4; x++) {
          expect(out[y * 8 + x]).toBeCloseTo(value / 255, 6);
        }
      }
    }
  });

  it('decodes each block at its own offset across a multi-block level', () => {
    // Guards the block stride: 8 bytes per 4x4 block, no padding. A wrong stride
    // shows up as one block's values repeated or shifted across the tile.
    const data = new Uint8Array(4 * 8);
    // Distinct code per block, all sharing the 70/0 table.
    [2, 3, 4, 5].forEach((code, i) => data.set(packBlock(70, 0, uniformCodes(code)), i * 8));
    const out = decodeBC4Level(data, 0, 8);

    expect(out[0 * 8 + 0]).toBeCloseTo(60 / 255, 6); // block (0,0), code 2
    expect(out[4 * 8 + 0]).toBeCloseTo(50 / 255, 6); // block (0,1), code 3
    expect(out[0 * 8 + 4]).toBeCloseTo(40 / 255, 6); // block (1,0), code 4
    expect(out[4 * 8 + 4]).toBeCloseTo(30 / 255, 6); // block (1,1), code 5
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('decodeBC4Level normalisation', () => {
  it('maps the endpoint range onto [0, 1] exactly at the extremes', () => {
    // Downstream analysis treats these as intensities in [0, 1]; the endpoints
    // of that range have to be exact or contrast and thresholds drift.
    const black = decodeBC4Level(packBlock(0, 0, uniformCodes(0)), 0, 4);
    const white = decodeBC4Level(packBlock(255, 255, uniformCodes(0)), 0, 4);
    for (let i = 0; i < 16; i++) {
      expect(black[i]).toBe(0);
      expect(white[i]).toBe(1);
    }
  });

  it('scales by 1/255, so an all-zero buffer decodes to an empty tile', () => {
    // Missing or unwritten tiles arrive as zero-filled buffers and must render
    // as no contact rather than as signal.
    const out = decodeBC4Level(new Uint8Array(4 * 8), 0, 8);
    expect(out.every((v) => v === 0)).toBe(true);

    const mid = decodeBC4Level(packBlock(128, 128, uniformCodes(0)), 0, 4);
    expect(mid[0]).toBeCloseTo(128 / 255, 6);
  });
});
