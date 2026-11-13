/**
 * BED export: the standard AGP's layout as BED6.
 *
 * The map is 100 texels over 1,000,000 bp, so a texel is 10,000 bp.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { metaTags } from '../../src/curation/MetaTagManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { exportBED, buildBEDLines, formatBEDLine } from '../../src/export/BEDWriter';
import { exportAGP } from '../../src/export/AGPWriter';

const LAYOUT: Array<[string, number, number]> = [['a', 0, 10], ['b', 10, 30], ['c', 30, 35], ['d', 35, 100]];
let scaffolds: ScaffoldManager;

beforeEach(() => {
  state.reset();
  metaTags.clearAll();
  contigExclusion.clearAll();
  scaffolds = new ScaffoldManager();
  CurationEngine.setScaffoldManager(scaffolds);
  const contigs: ContigInfo[] = LAYOUT.map(([name, s, e], i) => ({
    name, originalIndex: i, length: (e - s) * 10_000, pixelStart: s, pixelEnd: e, inverted: false, scaffoldId: null,
  }));
  const map: MapData = {
    filename: 'm.pretext', textureSize: 100, numMipMaps: 1, tileResolution: 100, tilesPerDimension: 1,
    contigs, fileContigCount: contigs.length, genomeLength: 1_000_000,
    contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
  state.update({ map, contigOrder: [0, 1, 2, 3] });
});

const body = () => exportBED(state.get(), { includeHeader: false }).trimEnd().split('\n');

describe('BEDWriter', () => {
  it('writes one line per sequence row, 0-based and half-open, named by sequence and interval', () => {
    expect(exportBED(state.get()).split('\n')[0]).toBe('#chrom\tchromStart\tchromEnd\tname\tscore\tstrand');
    expect(body()).toEqual([
      'Scaffold_1\t0\t100000\ta:1-100000\t0\t+',
      'Scaffold_2\t0\t200000\tb:1-200000\t0\t+',
      'Scaffold_3\t0\t50000\tc:1-50000\t0\t+',
      'Scaffold_4\t0\t650000\td:1-650000\t0\t+',
    ]);
    expect(exportBED(state.get()).endsWith('\n')).toBe(true);
  });

  it('places the members of a scaffold with the 100 bp gap between them, and shows cuts and strand', () => {
    CurationEngine.cut(1, 5);            // b -> b_L, b_R
    CurationEngine.invert(2);            // b_R reversed
    const id = scaffolds.createScaffold(undefined, { record: false });
    scaffolds.paintContigs([0, 1, 2], id, { record: false });
    expect(body()).toEqual([
      'Scaffold_1\t0\t100000\ta:1-100000\t0\t+',
      'Scaffold_1\t100100\t150100\tb:1-50000\t0\t+',
      'Scaffold_1\t150200\t300200\tb:50001-200000\t0\t-',
      'Scaffold_2\t0\t50000\tc:1-50000\t0\t+',
      'Scaffold_3\t0\t650000\td:1-650000\t0\t+',
    ]);
  });

  it('agrees with the standard AGP line for line', () => {
    CurationEngine.cut(3, 20);
    CurationEngine.move(4, 0);
    CurationEngine.invert(0);
    CurationEngine.join(1);
    const id = scaffolds.createScaffold(undefined, { record: false });
    scaffolds.paintContigs([0, 1], id, { record: false });
    contigExclusion.set(state.get().contigOrder[2], true);

    const agp = exportAGP(state.get(), { flavor: 'standard' }).split('\n')
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((c) => c[4] === 'W');
    expect(buildBEDLines(state.get()).map((l) => [l.chrom, l.chromStart + 1, l.chromEnd, l.name, l.strand]))
      .toEqual(agp.map((c) => [c[0], Number(c[1]), Number(c[2]), `${c[5]}:${c[6]}-${c[7]}`, c[8]]));
  });

  it('leaves out excluded contigs', () => {
    contigExclusion.set(1, true);
    expect(body().map((l) => l.split('\t')[3])).toEqual(['a:1-100000', 'c:1-50000', 'd:1-650000']);
  });

  it('formats a line as six tab-separated fields', () => {
    expect(formatBEDLine({ chrom: 'Scaffold_7', chromStart: 0, chromEnd: 42, name: 'x:1-42', score: 0, strand: '-' }))
      .toBe('Scaffold_7\t0\t42\tx:1-42\t0\t-');
  });

  it('throws with nothing to write', () => {
    state.update({ contigOrder: [] });
    expect(() => exportBED(state.get())).toThrow(/contig order is empty/);
    state.reset();
    expect(() => exportBED(state.get())).toThrow(/no map data loaded/);
  });
});
