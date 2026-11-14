/**
 * The haplotype-order check repeats how pretext-to-asm groups painted
 * scaffolds. The expected results here are what the tool itself did on the
 * same layouts (bench/haplotype-order-check.ts, agp-tpf-utils 1.4.1).
 */

import { describe, it, expect } from 'vitest';
import type { ContigInfo, MapData } from '../../src/core/State';
import { checkHaplotypeOrder, haplotypeOrderWarnings, paintedAutosomes, type PaintedAutosome } from '../../src/export/HaplotypeOrder';
import { buildAGPObjects } from '../../src/export/AGPModel';

const H1 = 'Hap_1';
const H2 = 'Hap_2';
const a = (first: string, haplotype: string | null, singleton = false): PaintedAutosome => ({ first, haplotype, singleton });
const lettered = (list: PaintedAutosome[]) => checkHaplotypeOrder(list).lettered.map((r) => `${r.haplotype}:${r.scaffolds.join('+')}`);

describe('checkHaplotypeOrder', () => {
  it('finds nothing when partners sit side by side', () => {
    const r = checkHaplotypeOrder([a('A', H1), a('D', H2), a('B', H1), a('E', H2), a('C', H1), a('F', H2)]);
    expect(r).toEqual({ haplotypes: [H1, H2], untagged: [], lettered: [], missingFirst: [] });
  });

  it('reports every scaffold when one haplotype is painted before the other', () => {
    expect(lettered([a('A', H1), a('B', H1), a('C', H1), a('D', H2), a('E', H2), a('F', H2)]))
      .toEqual(['Hap_1:A+B+C', 'Hap_2:D+E+F']);
  });

  it('reports the runs around one pair out of place', () => {
    expect(lettered([a('A', H1), a('D', H2), a('B', H1), a('C', H1), a('E', H2), a('F', H2)]))
      .toEqual(['Hap_1:B+C', 'Hap_2:E+F']);
  });

  it('reports a chromosome with no partner, unless the one before it is a Singleton', () => {
    expect(lettered([a('A', H1), a('D', H2), a('B', H1), a('C', H1), a('F', H2)])).toEqual(['Hap_1:B+C']);
    expect(lettered([a('A', H1), a('D', H2), a('B', H1, true), a('C', H1), a('F', H2)])).toEqual([]);
    // The tag acts on the scaffold that follows, so it does nothing on the second of the two.
    expect(lettered([a('A', H1), a('D', H2), a('B', H1), a('C', H1, true), a('F', H2)])).toEqual(['Hap_1:B+C']);
  });

  it('reports untagged scaffolds among tagged ones, and nothing else', () => {
    const r = checkHaplotypeOrder([a('A', H1), a('D', H2), a('B', null), a('C', null)]);
    expect(r.untagged).toEqual(['B', 'C']);
    expect(r.lettered).toEqual([]);
  });

  it('reports a chromosome left without the first haplotype', () => {
    const r = checkHaplotypeOrder([a('A', H1), a('D', H2, true), a('E', H2)]);
    expect(r.missingFirst).toEqual(['E']);
  });

  it('has nothing to say about one haplotype, or none', () => {
    expect(checkHaplotypeOrder([a('A', H1), a('B', H1), a('C', H1)]).lettered).toEqual([]);
    expect(checkHaplotypeOrder([a('A', null), a('B', null)]).untagged).toEqual([]);
    expect(checkHaplotypeOrder([])).toEqual({ haplotypes: [], untagged: [], lettered: [], missingFirst: [] });
  });

  it('compares haplotype names without case, as the tool does', () => {
    expect(lettered([a('A', 'Hap1'), a('D', 'Hap2'), a('B', 'HAP1'), a('E', 'hap2')])).toEqual([]);
    expect(lettered([a('A', 'Hap1'), a('B', 'HAP1'), a('D', 'Hap2')])).toEqual(['Hap1:A+B']);
  });
});

// A map of single-sequence contigs, painted and tagged per `layout`.
function build(layout: Array<[string, number | null, string[]]>): { map: MapData; order: number[]; tagsOf: (id: number) => string[] } {
  const contigs: ContigInfo[] = layout.map(([name, scaffoldId], i) => ({
    name, originalIndex: i, length: 10_000, pixelStart: i * 10, pixelEnd: (i + 1) * 10, inverted: false, scaffoldId,
  }));
  const map = {
    filename: 't.pretext', textureSize: layout.length * 10, numMipMaps: 1, tileResolution: 10,
    tilesPerDimension: 1, contigs, contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
    genomeLength: layout.length * 10_000, fileContigCount: layout.length,
  } satisfies MapData;
  return { map, order: layout.map((_, i) => i), tagsOf: (id) => layout[id][2] };
}

describe('paintedAutosomes', () => {
  it('skips unpainted contigs, named chromosomes and scaffolds of removed or unlocalised pieces', () => {
    const { map, order, tagsOf } = build([
      ['s1', 1, [H1]], ['s2', 2, [H2]],
      ['z', 3, ['Z', H1]],
      ['junk', 4, ['Haplotig', H2]],
      ['loose', null, []],
      ['s3', 5, [H1]], ['s3u', 5, ['Unloc']],
    ]);
    expect(paintedAutosomes(buildAGPObjects(map, order), map, tagsOf)).toEqual([
      a('s1', H1), a('s2', H2), a('s3', H1),
    ]);
  });

  it('reads a haplotype from the sequence name when no tag gives one', () => {
    const { map, order, tagsOf } = build([['HAP1_scaffold_3', 1, []], ['scaffold_3', 2, []]]);
    expect(paintedAutosomes(buildAGPObjects(map, order), map, tagsOf)!.map((x) => x.haplotype)).toEqual(['HAP1', null]);
  });

  it('does not model Primary or Target', () => {
    const { map, order, tagsOf } = build([['s1', 1, [H1, 'Primary']], ['s2', 2, [H1]]]);
    expect(paintedAutosomes(buildAGPObjects(map, order), map, tagsOf)).toBeNull();
    expect(haplotypeOrderWarnings(map, order, tagsOf)).toEqual([]);
  });
});

describe('haplotypeOrderWarnings', () => {
  it('is silent for a paired layout and for a single haplotype', () => {
    const paired = build([['a', 1, [H1]], ['d', 2, [H2]], ['b', 3, [H1]], ['e', 4, [H2]]]);
    expect(haplotypeOrderWarnings(paired.map, paired.order, paired.tagsOf)).toEqual([]);
    const single = build([['a', 1, []], ['b', 2, []], ['c', 3, []]]);
    expect(haplotypeOrderWarnings(single.map, single.order, single.tagsOf)).toEqual([]);
  });

  it('says where scaffolds of one haplotype follow one another', () => {
    const { map, order, tagsOf } = build([['a', 1, [H1]], ['b', 2, [H1]], ['d', 3, [H2]], ['e', 4, [H2]]]);
    const w = haplotypeOrderWarnings(map, order, tagsOf);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('in 2 places');
    expect(w[0]).toContain('4 scaffolds; first Hap_1: "a", "b"');
    expect(w[0]).toContain('SUPER_1A');
  });

  it('follows the curated order, not the file order', () => {
    const { map, tagsOf } = build([['a', 1, [H1]], ['b', 2, [H1]], ['d', 3, [H2]], ['e', 4, [H2]]]);
    expect(haplotypeOrderWarnings(map, [0, 2, 1, 3], tagsOf)).toEqual([]);
  });

  it('names untagged painted scaffolds', () => {
    const { map, order, tagsOf } = build([['a', 1, [H1]], ['d', 2, [H2]], ['b', 3, []]]);
    const w = haplotypeOrderWarnings(map, order, tagsOf);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('1 painted scaffold has no haplotype tag');
    expect(w[0]).toContain('"b"');
  });
});
