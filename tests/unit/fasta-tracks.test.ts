import { describe, it, expect } from 'vitest';
import type { MapData, ContigInfo } from '../../src/core/State';
import { computeFastaTrackData } from '../../src/analysis/FastaTracks';

function contig(name: string, start: number, end: number, length: number): ContigInfo {
  return { name, originalIndex: 0, length, pixelStart: start, pixelEnd: end, inverted: false, scaffoldId: null };
}
function mapWith(textureSize: number, contigs: ContigInfo[]): MapData {
  return { textureSize, contigs } as unknown as MapData;
}

describe('computeFastaTrackData - gaps from N-runs', () => {
  it('marks the pixels covering an N-run, scaled from bp to the contig span', () => {
    // Contig a: bp length 9, pixels [0,6). "AAA NNN AAA" -> N-run at bp [3,6).
    // px0 = floor(0 + 3/9*6) = 2 ; px1 = ceil(0 + 6/9*6) = 4  -> pixels 2,3.
    const contigs = [contig('a', 0, 6, 9), contig('b', 6, 12, 12)];
    const seqs = new Map<string, string>([
      ['a', 'AAANNNAAA'],
      ['b', 'ACGTACGTACGT'], // no N
    ]);
    const data = computeFastaTrackData(mapWith(12, contigs), seqs);

    expect(data.has('gaps')).toBe(true);
    const gaps = data.get('gaps')!;
    expect(gaps).toHaveLength(12);
    expect([...gaps].map((v, i) => (v ? i : -1)).filter(i => i >= 0)).toEqual([2, 3]);
  });

  it('handles lowercase n and produces no gaps track when there are none', () => {
    const contigs = [contig('a', 0, 12, 12)];
    const withN = computeFastaTrackData(mapWith(12, contigs), new Map([['a', 'ACGTnnnnACGT']]));
    expect(withN.get('gaps')!.some(v => v === 1)).toBe(true);

    const noN = computeFastaTrackData(mapWith(12, contigs), new Map([['a', 'ACGTACGTACGT']]));
    expect(noN.has('gaps')).toBe(false);
  });

  it('skips contigs with no matching reference sequence without crashing', () => {
    const contigs = [contig('a', 0, 6, 9), contig('missing', 6, 12, 9)];
    const data = computeFastaTrackData(mapWith(12, contigs), new Map([['a', 'AAANNNAAA']]));
    expect(data.get('gaps')!.slice(6).every(v => v === 0)).toBe(true);
  });
});

describe('computeFastaTrackData - telomeres from motif hits', () => {
  it('marks contig-end pixels where the telomere motif is dense', () => {
    // Contig a is pure telomere -> 5p and 3p hits -> markers at its start and
    // last pixel. Contig b has no motif -> no markers in its span.
    const telo = 'TTAGGG'.repeat(200); // 1200 bp, dense at both ends
    const rand = 'ACGT'.repeat(300); // 1200 bp, no telomere
    const contigs = [contig('a', 0, 6, telo.length), contig('b', 6, 12, rand.length)];
    const seqs = new Map<string, string>([['a', telo], ['b', rand]]);

    const data = computeFastaTrackData(mapWith(12, contigs), seqs);
    expect(data.has('telomeres')).toBe(true);
    const tel = data.get('telomeres')!;
    expect(tel[0]).toBe(1); // 5p end -> contig a start pixel
    expect(tel[5]).toBe(1); // 3p end -> contig a last pixel
    expect(tel.slice(6).every(v => v === 0)).toBe(true); // none in contig b
  });

  it('produces no telomeres track when no contig end carries the motif', () => {
    const contigs = [contig('a', 0, 12, 1200)];
    const data = computeFastaTrackData(mapWith(12, contigs), new Map([['a', 'ACGT'.repeat(300)]]));
    expect(data.has('telomeres')).toBe(false);
  });
});
