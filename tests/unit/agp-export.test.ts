/**
 * The AGP writer: rows in PretextView's layout, from the curated map.
 *
 * The maps here are 100 texels wide over 1,000,000 bp, so a texel is exactly
 * 10,000 bp and every expected coordinate can be read off by eye. The same
 * code is checked against a real PretextView export in
 * agp-quail-roundtrip.test.ts, which needs files too large to commit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { metaTags } from '../../src/curation/MetaTagManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { exportAGP, agpExportProblems, agpFilename, AGPExportBlocked } from '../../src/export/AGPWriter';
import {
  buildAGPObjects, checkTiling, texelBoundaryBp, formatResolution, genomeLengthOf, fileContigsOf,
} from '../../src/export/AGPModel';
import { APP_VERSION } from '../../src/core/Version';
import { validateAGP } from '../helpers/agpValidate';

// name, first texel, one past the last texel
const LAYOUT: Array<[string, number, number]> = [
  ['a', 0, 10], ['b', 10, 30], ['c', 30, 35], ['tiny', 35, 35], ['d', 35, 100],
];

function makeMap(layout = LAYOUT, genomeLength = 1_000_000): MapData {
  const N = layout[layout.length - 1][2];
  const contigs: ContigInfo[] = layout.map(([name, s, e], i) => ({
    name, originalIndex: i, length: Math.round(((e - s) / N) * genomeLength),
    pixelStart: s, pixelEnd: e, inverted: false, scaffoldId: null,
  }));
  return {
    filename: 'm.pretext', textureSize: N, numMipMaps: 1, tileResolution: N, tilesPerDimension: 1,
    contigs, fileContigCount: contigs.length, genomeLength,
    contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
}

let scaffolds: ScaffoldManager;

function load(layout = LAYOUT, genomeLength = 1_000_000): void {
  state.reset();
  metaTags.clearAll();
  contigExclusion.clearAll();
  scaffolds = new ScaffoldManager();
  CurationEngine.setScaffoldManager(scaffolds);
  state.update({ map: makeMap(layout, genomeLength), contigOrder: layout.map((_, i) => i) });
}

/** Position in the order of the contig called `name`. */
const at = (name: string) => {
  const s = state.get();
  const i = s.contigOrder.findIndex((id) => s.map!.contigs[id].name === name);
  if (i === -1) throw new Error(`no contig ${name}`);
  return i;
};
const idOf = (name: string) => state.get().contigOrder[at(name)];

/** Paint the named contigs into a new scaffold. */
function paint(...names: string[]): number {
  const id = scaffolds.createScaffold(undefined, { record: false });
  scaffolds.paintContigs(names.map(at), id, { record: false });
  return id;
}

/** The data rows, tab-split. */
function rows(flavor: 'pretextview' | 'standard' = 'pretextview'): string[][] {
  return exportAGP(state.get(), { flavor }).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
}
const lines = (flavor: 'pretextview' | 'standard' = 'pretextview') => rows(flavor).map((r) => r.join(' '));

beforeEach(() => load());

describe('texel arithmetic', () => {
  it('is PretextView\'s: floor(p / N * L)', () => {
    expect(texelBoundaryBp(0, 100, 1_000_000)).toBe(0);
    expect(texelBoundaryBp(3, 100, 1_000_000)).toBe(30_000);
    // Real figures (king quail): 59245.052 bp per texel.
    const N = 32768;
    const L = 1941341864;
    for (const p of [1, 2, 3, 15, 1214, 3035, 32767, 32768]) {
      expect(texelBoundaryBp(p, N, L), `texel ${p}`).toBe(Number((BigInt(p) * BigInt(L)) / BigInt(N)));
    }
    expect(texelBoundaryBp(3, N, L)).toBe(177735);
    expect(formatResolution(N, L)).toBe('59245.052002');
    expect(formatResolution(100, 1_000_000)).toBe('10000.000000');
  });

  it('takes the genome length from the map, not from the rounded contig lengths', () => {
    const map = makeMap(LAYOUT, 1_000_003);
    expect(genomeLengthOf(map)).toBe(1_000_003);
    const { genomeLength: _g, ...withoutLength } = map;
    expect(genomeLengthOf(withoutLength as MapData)).toBe(map.contigs.reduce((n, c) => n + c.length, 0));
    expect(fileContigsOf(map).map((c) => c.name)).toEqual(['a', 'b', 'c', 'tiny', 'd']);
  });
});

describe('an untouched map', () => {
  it('writes each sequence as its own one-row object, whole and forward', () => {
    expect(lines()).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 +',
      'Scaffold_2 1 200000 1 W b 1 200000 +',
      'Scaffold_3 1 50000 1 W c 1 50000 +',
      'Scaffold_4 1 650000 1 W d 1 650000 +',
    ]);
  });

  it('leaves out a sequence that owns no texel, as PretextView does', () => {
    expect(exportAGP(state.get())).not.toMatch(/\ttiny\t/);
  });

  it('writes PretextView\'s header, with the resolution line pretext-to-asm requires', () => {
    const head = exportAGP(state.get()).split('\n').slice(0, 3);
    expect(head).toEqual([
      '##agp-version\t2.1',
      `# DESCRIPTION: Generated by OpenPretext Version ${APP_VERSION}`,
      '# HiC MAP RESOLUTION: 10000.000000 bp/texel',
    ]);
    // The pattern pretext-to-asm matches (assembly.py, bp_per_texel).
    expect(head[2].replace(/^#\s*/, '')).toMatch(/^HiC MAP RESOLUTION: ([\d.]+) bp\/texel/);
    expect(exportAGP(state.get(), { includeHeader: false }).startsWith('Scaffold_1\t')).toBe(true);
  });

  it('is the same text every time', () => {
    expect(exportAGP(state.get())).toBe(exportAGP(state.get()));
    expect(exportAGP(state.get()).endsWith('\n')).toBe(true);
  });
});

describe('painted scaffolds', () => {
  it('become one object each, with a U 100 gap row between neighbours and Painted in column 10', () => {
    paint('a', 'b');
    expect(rows()).toEqual([
      ['Scaffold_1', '1', '100000', '1', 'W', 'a', '1', '100000', '+', 'Painted'],
      ['Scaffold_1', '100001', '100100', '2', 'U', '100', 'scaffold', 'yes', 'proximity_ligation'],
      ['Scaffold_1', '100101', '300100', '3', 'W', 'b', '1', '200000', '+', 'Painted'],
      ['Scaffold_2', '1', '50000', '1', 'W', 'c', '1', '50000', '+'],
      ['Scaffold_3', '1', '650000', '1', 'W', 'd', '1', '650000', '+'],
    ]);
  });

  it('are numbered first, in map order, and the unpainted contigs after them', () => {
    paint('c', 'd');     // sits to the right of a and b on the map
    expect(rows().filter((r) => r[4] === 'W').map((r) => `${r[0]}:${r[5]}`)).toEqual([
      'Scaffold_1:c', 'Scaffold_1:d', 'Scaffold_2:a', 'Scaffold_3:b',
    ]);
  });

  it('are split where a contig that is not in the scaffold sits between its members', () => {
    paint('a', 'c');     // b lies between them
    expect(rows().map((r) => `${r[0]}:${r[5]}:${r[9] ?? ''}`)).toEqual([
      'Scaffold_1:a:Painted', 'Scaffold_2:c:Painted', 'Scaffold_3:b:', 'Scaffold_4:d:',
    ]);
  });

  it('a contig that owns no texel does not split the scaffold around it', () => {
    paint('c', 'd');     // tiny lies between them and is not painted
    expect(rows().filter((r) => r[0] === 'Scaffold_1').map((r) => r[4])).toEqual(['W', 'U', 'W']);
  });

  it('write the map orientation, also for a scaffold of one sequence', () => {
    CurationEngine.invert(at('a'));
    CurationEngine.invert(at('d'));
    CurationEngine.invert(at('c'));
    paint('a', 'b');
    paint('d');
    // d is a chromosome made of one sequence, turned round by the curator.
    // pretext-to-asm reverse-complements it on seeing `-`.
    expect(lines()).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 - Painted',
      'Scaffold_1 100001 100100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 100101 300100 3 W b 1 200000 + Painted',
      'Scaffold_2 1 650000 1 W d 1 650000 - Painted',
      'Scaffold_3 1 50000 1 W c 1 50000 -',
    ]);
  });

  it('in the standard file, write a sequence that stands alone as +, as the specification asks', () => {
    CurationEngine.invert(at('a'));
    CurationEngine.invert(at('d'));
    paint('a', 'b');
    expect(lines('standard')).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 -',
      'Scaffold_1 100001 100100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 100101 300100 3 W b 1 200000 +',
      'Scaffold_2 1 50000 1 W c 1 50000 +',
      'Scaffold_3 1 650000 1 W d 1 650000 +',
    ]);
  });
});

describe('cuts', () => {
  it('are written as intervals of the original sequence, never under a new name', () => {
    CurationEngine.cut(at('b'), 5);
    expect(lines()).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 +',
      'Scaffold_2 1 50000 1 W b 1 50000 +',
      'Scaffold_3 1 150000 1 W b 50001 200000 +',
      'Scaffold_4 1 50000 1 W c 1 50000 +',
      'Scaffold_5 1 650000 1 W d 1 650000 +',
    ]);
    expect(exportAGP(state.get())).not.toMatch(/b_L|b_R/);
  });

  it('keep the low and high coordinate in that order when the piece is inverted', () => {
    CurationEngine.cut(at('d'), 20);
    CurationEngine.invert(at('d_R'));
    paint('c', 'd_L', 'd_R');
    expect(lines().slice(0, 5)).toEqual([
      'Scaffold_1 1 50000 1 W c 1 50000 + Painted',
      'Scaffold_1 50001 50100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 50101 250100 3 W d 1 200000 + Painted',
      'Scaffold_1 250101 250200 4 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 250201 700200 5 W d 200001 650000 - Painted',
    ]);
  });

  it('on an inverted contig give the display-left piece the high end of the sequence', () => {
    CurationEngine.invert(at('b'));
    CurationEngine.cut(at('b'), 5);     // 5 texels from the display-left edge
    paint(...state.get().contigOrder.slice(1, 3).map((id) => state.get().map!.contigs[id].name));
    expect(lines().slice(0, 3)).toEqual([
      'Scaffold_1 1 50000 1 W b 150001 200000 - Painted',
      'Scaffold_1 50001 50100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 50101 200100 3 W b 1 150000 - Painted',
    ]);
  });

  it('tile the sequence exactly, however many there are', () => {
    CurationEngine.cut(at('d'), 40);
    CurationEngine.cut(at('d_L'), 7);
    CurationEngine.cut(at('d_R'), 3);
    CurationEngine.move(at('d_L_R'), 0);
    const pieces = rows().filter((r) => r[5] === 'd').map((r) => [Number(r[6]), Number(r[7])]).sort((x, y) => x[0] - y[0]);
    expect(pieces).toEqual([[1, 70000], [70001, 400000], [400001, 430000], [430001, 650000]]);
    expect(checkTiling(buildAGPObjects(state.get().map!, state.get().contigOrder))).toEqual([]);
  });

  it('joined back together are one row again', () => {
    CurationEngine.cut(at('b'), 5);
    CurationEngine.join(at('b_L'));
    expect(lines()[1]).toBe('Scaffold_2 1 200000 1 W b 1 200000 +');
    expect(lines()).toHaveLength(4);
  });
});

describe('joins', () => {
  it('of two sequences are one object holding both, with their own orientations', () => {
    CurationEngine.invert(at('c'));
    CurationEngine.move(at('c'), 0);      // c a b tiny d
    CurationEngine.join(0);               // c+a, not neighbours in the file
    expect(lines().slice(0, 3)).toEqual([
      'Scaffold_1 1 50000 1 W c 1 50000 -',
      'Scaffold_1 50001 50100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 50101 150100 3 W a 1 100000 +',
    ]);
  });

  it('of file neighbours are still two rows: the AGP names sequences, not spans of the map', () => {
    CurationEngine.join(at('a'));         // a+b, one contiguous span of the file
    expect(lines().slice(0, 3)).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 +',
      'Scaffold_1 100001 100100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 100101 300100 3 W b 1 200000 +',
    ]);
  });

  it('inverted as a whole reverse the order of the parts and each part', () => {
    CurationEngine.join(at('a'));         // a+b
    CurationEngine.invert(0);
    expect(lines().slice(0, 3)).toEqual([
      'Scaffold_1 1 200000 1 W b 1 200000 -',
      'Scaffold_1 200001 200100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 200101 300100 3 W a 1 100000 -',
    ]);
  });
});

describe('tags', () => {
  it('follow Painted, one per column, in PretextView\'s order', () => {
    paint('a', 'b');
    metaTags.setTags(idOf('a'), ['Hap_2', 'Z']);
    metaTags.setTags(idOf('b'), ['Unloc']);
    metaTags.setTags(idOf('c'), ['Haplotig']);
    const r = rows();
    expect(r[0].slice(9)).toEqual(['Painted', 'Z', 'Hap_2']);
    expect(r[2].slice(9)).toEqual(['Painted', 'Unloc']);
    expect(r[3].slice(9)).toEqual(['Haplotig']);          // not painted: tags start in column 10
    expect(r[4]).toHaveLength(9);
    expect(r[1]).toHaveLength(9);                          // gap rows carry no tags
  });

  it('are on every row of a contig that has several', () => {
    CurationEngine.move(at('c'), 0);
    CurationEngine.join(0);               // c+a
    metaTags.addTag(state.get().contigOrder[0], 'Contaminant');
    expect(rows().filter((r) => r[0] === 'Scaffold_1' && r[4] === 'W').map((r) => r.slice(9))).toEqual([
      ['Contaminant'], ['Contaminant'],
    ]);
  });
});

describe('what stops the PretextView file being written', () => {
  it('an excluded contig with no tag saying why', () => {
    contigExclusion.set(idOf('b'), true);
    contigExclusion.set(idOf('c'), true);
    const problems = agpExportProblems(state.get().map!, state.get().contigOrder);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^2 excluded contigs have no tag saying why they are removed: "b", "c"\./);
    expect(problems[0]).toMatch(/Haplotig, Contaminant or FalseDuplicate/);
    expect(() => exportAGP(state.get())).toThrow(AGPExportBlocked);
    try { exportAGP(state.get()); } catch (e) { expect((e as AGPExportBlocked).problems).toEqual(problems); }

    metaTags.addTag(idOf('b'), 'Contaminant');
    metaTags.addTag(idOf('c'), 'FalseDuplicate');
    expect(agpExportProblems(state.get().map!, state.get().contigOrder)).toEqual([]);
  });

  it('is not an excluded contig that owns no texel: it has no row to tag', () => {
    contigExclusion.set(idOf('tiny'), true);
    expect(agpExportProblems(state.get().map!, state.get().contigOrder)).toEqual([]);
  });

  it('Unloc on a contig that is not in a scaffold', () => {
    metaTags.addTag(idOf('c'), 'Unloc');
    expect(agpExportProblems(state.get().map!, state.get().contigOrder)[0])
      .toMatch(/^"c" is tagged Unloc but not assigned to a scaffold/);
    paint('b', 'c');
    expect(agpExportProblems(state.get().map!, state.get().contigOrder)).toEqual([]);
  });

  it('two chromosome names, or two haplotypes, in one scaffold', () => {
    paint('a', 'b');
    metaTags.addTag(idOf('a'), 'X');
    metaTags.addTag(idOf('b'), 'Y');
    metaTags.addTag(idOf('a'), 'Hap1');
    metaTags.addTag(idOf('b'), 'Hap2');
    const problems = agpExportProblems(state.get().map!, state.get().contigOrder);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe('the scaffold starting at "a" carries more than one chromosome name (X, Y). A scaffold can have one.');
    expect(problems[1]).toMatch(/more than one haplotype tag \(Hap1, Hap2\)/);
    // The same tags in different scaffolds are fine.
    load();
    paint('a');
    paint('b');
    metaTags.addTag(idOf('a'), 'X');
    metaTags.addTag(idOf('b'), 'Y');
    expect(agpExportProblems(state.get().map!, state.get().contigOrder)).toEqual([]);
  });
});

describe('excluded contigs', () => {
  beforeEach(() => {
    paint('a', 'b', 'c');
    contigExclusion.set(idOf('b'), true);
    metaTags.addTag(idOf('b'), 'Haplotig');
  });

  it('are written in the PretextView file, tagged, so the next tool removes them', () => {
    expect(lines()).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 + Painted',
      'Scaffold_1 100001 100100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 100101 300100 3 W b 1 200000 + Painted Haplotig',
      'Scaffold_1 300101 300200 4 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 300201 350200 5 W c 1 50000 + Painted',
      'Scaffold_2 1 650000 1 W d 1 650000 +',
    ]);
  });

  it('are left out of the standard file, which closes up around them', () => {
    expect(lines('standard')).toEqual([
      'Scaffold_1 1 100000 1 W a 1 100000 +',
      'Scaffold_1 100001 100100 2 U 100 scaffold yes proximity_ligation',
      'Scaffold_1 100101 150100 3 W c 1 50000 +',
      'Scaffold_2 1 650000 1 W d 1 650000 +',
    ]);
  });

  it('do not need a tag for the standard file', () => {
    metaTags.clearAll();
    expect(() => exportAGP(state.get())).toThrow(AGPExportBlocked);
    expect(() => exportAGP(state.get(), { flavor: 'standard' })).not.toThrow();
  });
});

describe('the standard file', () => {
  it('has nine columns on every row and the version line as the specification writes it', () => {
    paint('a', 'b');
    metaTags.setTags(idOf('a'), ['Z', 'Hap_2']);
    const text = exportAGP(state.get(), { flavor: 'standard' });
    expect(text.split('\n')[0]).toBe('##agp-version 2.1');
    expect(text.split('\n')[2]).toBe('# Coordinates are accurate to one Hi-C map texel (10000.000000 bp).');
    for (const r of rows('standard')) expect(r).toHaveLength(9);
    expect(validateAGP(text, { maxColumns: 9 })).toEqual([]);
  });

  it('is named apart from the PretextView file', () => {
    expect(agpFilename('bCotChi1.pretext', 'pretextview')).toBe('bCotChi1.agp');
    expect(agpFilename('bCotChi1.pretext', 'standard')).toBe('bCotChi1.standard.agp');
    expect(agpFilename(undefined, 'pretextview')).toBe('assembly.agp');
  });
});

describe('errors', () => {
  it('no map, or nothing to write', () => {
    state.reset();
    expect(() => exportAGP(state.get())).toThrow(/no map data loaded/);
    load();
    state.update({ contigOrder: [] });
    expect(() => exportAGP(state.get())).toThrow(/contig order is empty/);
    state.update({ contigOrder: [3] });   // only the contig with no texel
    expect(() => exportAGP(state.get())).toThrow(/owns any part of the map/);
  });

  it('checkTiling reports texels missing or used twice', () => {
    const objects = buildAGPObjects(state.get().map!, state.get().contigOrder);
    expect(checkTiling(objects)).toEqual([]);
    const broken = structuredClone(objects);
    broken[1].fragments[0].texelStart = 3;                 // b now starts 3 texels in
    expect(checkTiling(broken)[0]).toMatch(/^b: texels 0 to 3 are missing/);
    const twice = structuredClone(objects);
    twice.push(structuredClone(objects[0]));
    expect(checkTiling(twice)[0]).toMatch(/^a: texels 0 to 10 are used twice/);
  });
});

describe('any curation gives a file the specification and pretext-to-asm accept', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('across random cuts, joins, inversions, moves and painting', () => {
    // Odd figures, so nothing lands on a round number by accident.
    const layout: Array<[string, number, number]> = [
      ['s1', 0, 37], ['s2', 37, 38], ['s3', 38, 38], ['s4', 38, 101], ['s5', 101, 180], ['s6', 180, 256],
    ];
    for (let seed = 1; seed <= 80; seed++) {
      load(layout, 987_654_321);
      const rnd = mulberry32(seed);
      for (let k = 0; k < 18; k++) {
        const s = state.get();
        const count = s.contigOrder.length;
        const i = Math.floor(rnd() * count);
        const r = rnd();
        const c = s.map!.contigs[s.contigOrder[i]];
        const w = c.pixelEnd - c.pixelStart;
        if (r < 0.3) { if (w >= 2) CurationEngine.cut(i, 1 + Math.floor(rnd() * (w - 1))); }
        else if (r < 0.45) { if (i < count - 1) CurationEngine.join(i); }
        else if (r < 0.65) CurationEngine.invert(i);
        else if (r < 0.85) CurationEngine.move(i, Math.floor(rnd() * count));
        else {
          const len = 1 + Math.floor(rnd() * 3);
          const id = scaffolds.createScaffold(undefined, { record: false });
          scaffolds.paintContigs(Array.from({ length: len }, (_, d) => i + d).filter((p) => p < count), id, { record: false });
        }
      }
      const s = state.get();
      for (const flavor of ['pretextview', 'standard'] as const) {
        const text = exportAGP(s, { flavor });
        expect(validateAGP(text, { maxColumns: flavor === 'standard' ? 9 : undefined }), `seed ${seed}, ${flavor}`).toEqual([]);
      }

      // pretext-to-asm: rows from one sequence abut exactly and cover it, at
      // PretextView's coordinates for the texels it owns.
      const N = s.map!.textureSize;
      const L = genomeLengthOf(s.map!);
      const bySequence = new Map<string, Array<[number, number]>>();
      for (const r of exportAGP(s).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'))) {
        if (r[4] !== 'W') continue;
        if (!bySequence.has(r[5])) bySequence.set(r[5], []);
        bySequence.get(r[5])!.push([Number(r[6]), Number(r[7])]);
      }
      for (const [name, s0, e0] of layout) {
        const pieces = (bySequence.get(name) ?? []).sort((x, y) => x[0] - y[0]);
        if (e0 === s0) { expect(pieces, `seed ${seed}, ${name}`).toEqual([]); continue; }
        expect(pieces[0][0], `seed ${seed}, ${name}`).toBe(1);
        expect(pieces[pieces.length - 1][1], `seed ${seed}, ${name}`).toBe(texelBoundaryBp(e0 - s0, N, L));
        for (let k = 1; k < pieces.length; k++) expect(pieces[k][0], `seed ${seed}, ${name}`).toBe(pieces[k - 1][1] + 1);
      }
    }
  });
});
