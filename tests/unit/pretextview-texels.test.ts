/**
 * Which texels each contig owns must be what PretextView computes, because
 * that decides where contig boundaries are drawn and every coordinate in an
 * exported AGP.
 *
 * The reference is a released Sanger curation of king quail: the map, and the
 * AGP PretextView 0.2.5 wrote from it. PretextView writes
 *   component_end = floor((p0 + len) * L / N)
 * for a fragment of `len` texels starting at texel `p0` of its sequence, so
 * the largest end coordinate of a sequence gives its width in texels.
 * Skipped where the files are absent (they are too large to commit).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pako from 'pako';
import { readPretextHeader } from '../../src/formats/PretextParser';

const DIR = resolve(__dirname, '../../test-data/case-study/quail');
const MAP = resolve(DIR, 'bCotChi1.combined.pretext');
const AGP = resolve(DIR, 'bCotChi1.combined.pretext.20240422.agp');
const d = existsSync(MAP) && existsSync(AGP) ? describe : describe.skip;

d('texel ownership against a PretextView export (king quail)', () => {
  it('gives every sequence the width PretextView gave it, and no texel to the ones it left out', () => {
    const bytes = readFileSync(MAP);
    const { header, contigs } = readPretextHeader(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const L = Number(header.totalGenomeLength);
    const N = header.numberOfPixels1D;

    const lines = readFileSync(AGP, 'utf8').split('\n');
    expect(lines[2]).toBe(`# HiC MAP RESOLUTION: ${(L / N).toFixed(6)} bp/texel`);

    const maxEnd = new Map<string, number>();
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const c = line.split('\t');
      if (c[4] !== 'W') continue;
      maxEnd.set(c[5], Math.max(maxEnd.get(c[5]) ?? 0, Number(c[7])));
    }
    expect(maxEnd.size).toBe(485);

    const wrong: string[] = [];
    for (const c of contigs) {
      const width = c.pixelEnd - c.pixelStart;
      const expected = maxEnd.get(c.name);
      if (expected === undefined) {
        if (width !== 0) wrong.push(`${c.name}: ${width} texels here, absent from the AGP`);
      } else if (Math.floor(width * L / N) !== expected) {
        wrong.push(`${c.name}: ${width} texels here, end ${expected} in the AGP`);
      }
    }
    expect(wrong).toEqual([]);
    // Spans are in file order and tile the map.
    let at = 0;
    for (const c of contigs) { expect(c.pixelStart).toBe(at); at = c.pixelEnd; }
    expect(at).toBe(N);
  });
});

describe('texel ownership arithmetic', () => {
  /** A header-only file: enough for readPretextHeader. */
  function headerOnly(fractions: number[], resLog2: number, tilesLog2: number): ArrayBuffer {
    const head = new Uint8Array(15 + 68 * fractions.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 1_000_000_000, true);
    v.setUint32(8, fractions.length, true);
    fractions.forEach((f, i) => {
      v.setFloat32(12 + i * 68, f, true);
      head.set(new TextEncoder().encode(`s${i + 1}`), 16 + i * 68);
    });
    const tail = 12 + 68 * fractions.length;
    head[tail] = resLog2; head[tail + 1] = tilesLog2; head[tail + 2] = 1;
    const comp = pako.deflateRaw(head);
    const out = new Uint8Array(12 + comp.length);
    out.set([0x70, 0x73, 0x74, 0x6d]);
    new DataView(out.buffer).setUint32(4, comp.length, true);
    new DataView(out.buffer).setUint32(8, head.length, true);
    out.set(comp, 12);
    return out.buffer;
  }

  it('follows PretextView: a single-precision running sum, truncated to a texel', () => {
    // Many small fractions, so single and double precision sums drift apart.
    const n = 3000;
    const raw = Array.from({ length: n }, (_, i) => 1 + ((i * 7919) % 13));
    const sum = raw.reduce((a, b) => a + b, 0);
    const fractions = raw.map((r) => Math.fround(r / sum));
    const N = 1 << 15;

    // PretextView's loop, transcribed.
    const expected: Array<[number, number]> = [];
    let total = 0;
    let lastPixel = 0;
    for (const f of fractions) {
      total = Math.fround(total + f);
      const pixel = Math.trunc(N * total);
      const start = lastPixel;
      if (pixel > lastPixel) lastPixel = pixel;
      expected.push([start, lastPixel]);
    }
    expected[n - 1][1] = N; // the remainder goes to the last sequence

    const { contigs } = readPretextHeader(headerOnly(fractions, 10, 5));
    expect(contigs.map((c) => [c.pixelStart, c.pixelEnd])).toEqual(expected);

    // And it is not what a double-precision sum gives (or this test proves nothing).
    let dbl = 0;
    let differs = 0;
    for (let i = 0; i < n - 1; i++) {
      dbl += fractions[i];
      if (Math.floor(dbl * N) !== expected[i][1]) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });
});
