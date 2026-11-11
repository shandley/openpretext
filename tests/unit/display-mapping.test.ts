import { describe, it, expect } from 'vitest';
import { isFileOrder } from '../../src/core/DisplayMapping';
import type { ContigInfo } from '../../src/core/State';

function contig(pixelStart: number, pixelEnd: number, inverted = false): ContigInfo {
  return {
    name: `c${pixelStart}`, originalIndex: 0, length: (pixelEnd - pixelStart) * 1000,
    pixelStart, pixelEnd, inverted, scaffoldId: null,
  };
}

describe('isFileOrder', () => {
  const contigs = [contig(0, 10), contig(10, 30), contig(30, 40)];

  it('is true for the order a file loads in', () => {
    expect(isFileOrder(contigs, [0, 1, 2])).toBe(true);
  });

  it('is false after a move', () => {
    expect(isFileOrder(contigs, [1, 0, 2])).toBe(false);
    expect(isFileOrder(contigs, [0, 2, 1])).toBe(false);
  });

  it('is false when any contig with pixels is inverted', () => {
    const inv = [contig(0, 10), contig(10, 30, true), contig(30, 40)];
    expect(isFileOrder(inv, [0, 1, 2])).toBe(false);
  });

  it('stays true after a cut, which splits a span without moving pixels', () => {
    // contig 1 cut at offset 5 -> children 3 and 4 replace it in the order
    const cut = [...contigs, contig(10, 15), contig(15, 30)];
    expect(isFileOrder(cut, [0, 3, 4, 2])).toBe(true);
  });

  it('is false when the halves of a cut are swapped', () => {
    const cut = [...contigs, contig(10, 15), contig(15, 30)];
    expect(isFileOrder(cut, [0, 4, 3, 2])).toBe(false);
  });

  it('ignores zero-width contigs wherever they sit and however they are oriented', () => {
    const withEmpty = [...contigs, contig(40, 40), contig(7, 7, true)];
    expect(isFileOrder(withEmpty, [3, 0, 4, 1, 2])).toBe(true);
  });

  it('is false when a contig id has no record', () => {
    expect(isFileOrder(contigs, [0, 1, 7])).toBe(false);
  });

  it('is true for an empty order', () => {
    expect(isFileOrder(contigs, [])).toBe(true);
  });
});
