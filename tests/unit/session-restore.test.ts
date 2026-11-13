/**
 * Session restore against the real curation engine.
 *
 * A session must bring back exactly the assembly that was saved, including the
 * pieces made by cut and join, and must be refused (changing nothing) when it
 * does not describe the loaded file.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { buildDisplayRuns, displayToFileTexel, displayWidth } from '../../src/core/DisplayMapping';
import {
  exportSession, importSession, validateSession, SESSION_VERSION, type SessionData, type SessionContigMarks,
} from '../../src/io/SessionManager';
import type { MetaTagInfo } from '../../src/curation/MetaTagManager';
import { planSessionRestore } from '../../src/io/SessionRestore';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPretextHeader } from '../../src/formats/PretextParser';

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

function freshMap(widths: number[], prefix = 'c'): MapData {
  const contigs: ContigInfo[] = [];
  let pos = 0;
  widths.forEach((w, i) => {
    contigs.push({
      name: `${prefix}${i}`, originalIndex: i, length: w * 1000,
      pixelStart: pos, pixelEnd: pos + w, inverted: false, scaffoldId: null,
    });
    pos += w;
  });
  return {
    filename: 't.pretext', textureSize: pos, numMipMaps: 1, tileResolution: pos,
    tilesPerDimension: 1, contigs, fileContigCount: contigs.length, contactMap: null,
    rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
}

function load(widths: number[]): void {
  state.reset();
  state.update({ map: freshMap(widths), contigOrder: widths.map((_, i) => i) });
}

/** Everything about the assembly a curator or an export depends on. */
function describeAssembly(contigs: ContigInfo[], order: number[]) {
  const runs = buildDisplayRuns(contigs, order);
  return {
    texels: Array.from({ length: displayWidth(runs) }, (_, d) => displayToFileTexel(runs, d)),
    contigs: order.map((id) => {
      const c = contigs[id];
      return {
        name: c.name, length: c.length, width: c.pixelEnd - c.pixelStart,
        inverted: c.inverted, scaffoldId: c.scaffoldId, sequence: c.sequenceSegments ?? null,
      };
    }),
  };
}

function randomEdits(rnd: () => number, n: number): void {
  for (let k = 0; k < n; k++) {
    const s = state.get();
    const count = s.contigOrder.length;
    const i = Math.floor(rnd() * count);
    const r = rnd();
    if (r < 0.3) {
      const c = s.map!.contigs[s.contigOrder[i]];
      const w = c.pixelEnd - c.pixelStart;
      if (w >= 2) CurationEngine.cut(i, 1 + Math.floor(rnd() * (w - 1)));
    } else if (r < 0.5) {
      if (i < count - 1) CurationEngine.join(i);
    } else if (r < 0.75) {
      CurationEngine.invert(i);
    } else {
      CurationEngine.move(i, Math.floor(rnd() * count));
    }
  }
}

/** Save the current assembly and read it back the way a file would be. */
function saveAndReload(scaffolds: ScaffoldManager): SessionData {
  return importSession(JSON.stringify(exportSession(state.get(), scaffolds)));
}

const WIDTHS = [12, 30, 7, 21, 16, 14];

describe('session round trip', () => {
  let scaffolds: ScaffoldManager;
  beforeEach(() => {
    state.reset();
    scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
  });

  it('writes the current version with the contig table and assembly', () => {
    load(WIDTHS);
    CurationEngine.cut(1, 10);
    const session = saveAndReload(scaffolds);
    expect(session.version).toBe(SESSION_VERSION);
    expect(session.contigs).toHaveLength(WIDTHS.length + 2);
    expect(session.assembly).toEqual({ textureSize: 100, fileContigCount: WIDTHS.length });
  });

  it('restores cuts, joins of non-neighbours, inversions and moves exactly', () => {
    for (let seed = 1; seed <= 60; seed++) {
      load(WIDTHS);
      const rnd = mulberry32(seed);
      randomEdits(rnd, 25);
      const sc = scaffolds.createScaffold('chr');
      scaffolds.paintContigs([0, state.get().contigOrder.length - 1], sc);
      const saved = describeAssembly(state.get().map!.contigs, state.get().contigOrder);
      const session = saveAndReload(scaffolds);

      // Onto a freshly loaded file ...
      const plan = planSessionRestore(session, freshMap(WIDTHS));
      expect(describeAssembly(plan.contigs, plan.contigOrder), `seed ${seed}, fresh file`).toEqual(saved);

      // ... and onto the same file after unrelated edits.
      load(WIDTHS);
      randomEdits(rnd, 10);
      const plan2 = planSessionRestore(session, state.get().map!);
      expect(describeAssembly(plan2.contigs, plan2.contigOrder), `seed ${seed}, edited file`).toEqual(saved);
      scaffolds.clear();
    }
  });

  it('does not hand back objects shared with the session', () => {
    load(WIDTHS);
    CurationEngine.move(3, 0);
    CurationEngine.join(0);
    const session = saveAndReload(scaffolds);
    const plan = planSessionRestore(session, freshMap(WIDTHS));
    const joined = plan.contigs[plan.contigOrder[0]];
    expect(joined.pixelSegments).toBeDefined();
    expect(joined.pixelSegments).not.toBe(session.contigs![plan.contigOrder[0]].pixelSegments);
  });
});

describe('sessions that must be refused', () => {
  let scaffolds: ScaffoldManager;
  let session: SessionData;
  beforeEach(() => {
    scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
    load(WIDTHS);
    CurationEngine.cut(1, 10);
    CurationEngine.move(4, 0);
    CurationEngine.join(0);
    session = saveAndReload(scaffolds);
  });

  const restore = (s: SessionData, map = freshMap(WIDTHS)) => () => planSessionRestore(s, map);

  it('accepts the untampered session', () => {
    expect(restore(session)).not.toThrow();
  });

  it('refuses another assembly of a different size', () => {
    expect(restore(session, freshMap([50, 50]))).toThrow(/different assembly/);
  });

  it('refuses another assembly with the same shape and different names', () => {
    expect(restore(session, freshMap(WIDTHS, 'other'))).toThrow(/different assembly/);
  });

  it('refuses another assembly with the same names and different spans', () => {
    expect(restore(session, freshMap([30, 12, 7, 21, 16, 14]))).toThrow(/different assembly/);
  });

  it('refuses an order naming a contig that is not defined', () => {
    expect(restore({ ...session, contigOrder: [...session.contigOrder, 99] })).toThrow(/does not define/);
  });

  it('refuses an order that shows a contig twice', () => {
    const order = [...session.contigOrder, session.contigOrder[0]];
    expect(restore({ ...session, contigOrder: order })).toThrow(/twice/);
  });

  it('refuses an order that leaves part of the map out', () => {
    expect(restore({ ...session, contigOrder: session.contigOrder.slice(1) })).toThrow(/exactly once/);
  });

  it('refuses an order that shows a cut contig together with its pieces', () => {
    // Contig 1 was cut; showing it again would repeat its texels.
    expect(restore({ ...session, contigOrder: [...session.contigOrder, 1] })).toThrow(/exactly once/);
  });

  it('refuses a contig whose segments do not add up to its width', () => {
    const contigs = session.contigs!.map((c) => ({ ...c }));
    const joined = contigs.find((c) => c.pixelSegments)!;
    joined.pixelSegments = joined.pixelSegments!.slice(0, 1);
    expect(restore({ ...session, contigs })).toThrow(/do not add up/);
  });

  it('drops an assignment to a scaffold the session does not define', () => {
    const contigs = session.contigs!.map((c) => ({ ...c, scaffoldId: 7 }));
    const plan = planSessionRestore({ ...session, contigs }, freshMap(WIDTHS));
    expect(plan.contigs.every((c) => c.scaffoldId === null)).toBe(true);
  });
});

describe('version 1 sessions', () => {
  function legacy(overrides: Partial<SessionData> = {}): SessionData {
    return {
      version: 1, filename: 't.pretext', timestamp: 1,
      contigOrder: [2, 0, 1, 3, 4, 5],
      contigStates: {
        0: { inverted: true, scaffoldId: 1 },
        1: { inverted: false, scaffoldId: null },
      },
      scaffolds: [{ id: 1, name: 'chr1', color: '#e6194B' }],
      waypoints: [], camera: { x: 0.5, y: 0.5, zoom: 1 },
      settings: { colorMapName: 'red-white', gamma: 0.35, showGrid: true },
      operationLog: [],
      ...overrides,
    };
  }

  it('still reads through importSession', () => {
    expect(importSession(JSON.stringify(legacy())).version).toBe(1);
  });

  it('restores order, orientation and scaffolds when nothing was cut or joined', () => {
    const plan = planSessionRestore(legacy(), freshMap(WIDTHS));
    expect(plan.contigOrder).toEqual([2, 0, 1, 3, 4, 5]);
    expect(plan.contigs[0]).toMatchObject({ name: 'c0', inverted: true, scaffoldId: 1 });
    expect(plan.contigs[2]).toMatchObject({ name: 'c2', inverted: false, scaffoldId: null });
  });

  it('starts from the file, not from edits made since it was loaded', () => {
    load(WIDTHS);
    CurationEngine.cut(0, 5);
    CurationEngine.invert(3);
    const plan = planSessionRestore(legacy(), state.get().map!);
    expect(plan.contigs).toHaveLength(WIDTHS.length);
    expect(plan.contigs[3].inverted).toBe(false);
  });

  it('says why a session saved after a cut cannot be restored', () => {
    const s = legacy({ contigOrder: [6, 7, 1, 2, 3, 4, 5] });
    expect(() => planSessionRestore(s, freshMap(WIDTHS))).toThrow(/cut or join by an earlier version/);
  });

  it('refuses an order that is not the whole assembly', () => {
    expect(() => planSessionRestore(legacy({ contigOrder: [0, 1] }), freshMap(WIDTHS))).toThrow(/places 2 contigs/);
  });

  it('keeps the file order when the session has none', () => {
    const plan = planSessionRestore(legacy({ contigOrder: [] }), freshMap(WIDTHS));
    expect(plan.contigOrder).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('tags and exclusions', () => {
  let scaffolds: ScaffoldManager;
  beforeEach(() => {
    scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
    load(WIDTHS);
    CurationEngine.cut(1, 10);   // contig 1 -> contigs 6 and 7
    CurationEngine.move(4, 0);
  });

  function marks(tags: Array<[number, MetaTagInfo]>, excluded: number[]): SessionContigMarks {
    return { tags: new Map(tags), excluded: new Set(excluded) };
  }

  const save = (m: SessionContigMarks) =>
    importSession(JSON.stringify(exportSession(state.get(), scaffolds, undefined, m)));

  it('come back on the contigs they were put on, wherever those now sit', () => {
    const order = state.get().contigOrder;
    const session = save(marks(
      [[6, { tags: ['Haplotig', 'Hap_1'] }], [order[0], { tags: ['Contaminant'], notes: 'bacterial, see blast' }]],
      [7, 3],
    ));
    expect(session.contigTags).toEqual({
      6: { tags: ['Haplotig', 'Hap_1'] },
      [order[0]]: { tags: ['Contaminant'], notes: 'bacterial, see blast' },
    });
    expect(session.excludedContigs).toEqual([3, 7]);

    const plan = planSessionRestore(session, freshMap(WIDTHS));
    expect(new Map(plan.tags)).toEqual(new Map<number, MetaTagInfo>([
      [6, { tags: ['Haplotig', 'Hap_1'] }],
      [order[0], { tags: ['Contaminant'], notes: 'bacterial, see blast' }],
    ]));
    expect(plan.excluded.sort()).toEqual([3, 7]);
    // The tagged ids are the same contigs after restore.
    expect(plan.contigs[6].name).toBe(state.get().map!.contigs[6].name);
  });

  it('does not save a mark left on a contig that a cut has replaced', () => {
    // Contig 1 was cut and is no longer placed.
    const session = save(marks([[1, { tags: ['Haplotig'] }], [2, { tags: ['Unloc'] }]], [1, 2]));
    expect(session.contigTags).toEqual({ 2: { tags: ['Unloc'] } });
    expect(session.excludedContigs).toEqual([2]);
  });

  it('saves empty marks as empty, and restores nothing from them', () => {
    const session = save(marks([], []));
    const plan = planSessionRestore(session, freshMap(WIDTHS));
    expect(plan.tags).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it('reads a session written before tags and exclusions were saved', () => {
    const session = save(marks([], []));
    delete session.contigTags;
    delete session.excludedContigs;
    expect(validateSession(session)).toBe(true);
    const plan = planSessionRestore(session, freshMap(WIDTHS));
    expect(plan.tags).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it('refuses a tag or exclusion on a contig the session does not place', () => {
    const session = save(marks([], []));
    expect(() => planSessionRestore({ ...session, contigTags: { 1: { tags: ['Haplotig'] } } }, freshMap(WIDTHS)))
      .toThrow(/tags contig 1, which it does not place/);
    expect(() => planSessionRestore({ ...session, excludedContigs: [99] }, freshMap(WIDTHS)))
      .toThrow(/excludes contig 99/);
  });

  it('reads the single lower-case tags of a version 2 session, and says which it could not carry over', () => {
    const order = state.get().contigOrder;
    const session = save(marks([], []));
    const v2 = {
      ...session,
      version: 2,
      contigTags: {
        [order[0]]: { tag: 'haplotig', notes: 'dup' },
        [order[1]]: { tag: 'contaminant' },
        [order[2]]: { tag: 'unlocalised' },
        [order[3]]: { tag: 'sex_chromosome' },
      },
    };
    expect(validateSession(v2)).toBe(true);
    const plan = planSessionRestore(v2 as never, freshMap(WIDTHS));
    expect(plan.tags).toEqual([
      [order[0], { tags: ['Haplotig'], notes: 'dup' }],
      [order[1], { tags: ['Contaminant'] }],
      [order[2], { tags: ['Unloc'] }],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)));
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/1 sex chromosome tag could not be restored/);
    expect(plan.warnings[0]).toContain(plan.contigs[order[3]].name);
  });

  it('has nothing to warn about for a current session', () => {
    const session = save(marks([[6, { tags: ['Z', 'Hap_2'] }]], []));
    expect(session.version).toBe(3);
    expect(planSessionRestore(session, freshMap(WIDTHS)).warnings).toEqual([]);
  });

  it('rejects malformed marks at import', () => {
    const session = save(marks([[6, { tags: ['Haplotig'] }]], [7]));
    const bad = (patch: object) => validateSession({ ...session, ...patch });
    expect(bad({ contigTags: { 6: { tag: 'virus' } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tags: [] } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tags: ['two words'] } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tags: ['Painted'] } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tags: 'Haplotig' } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tags: ['Haplotig'], notes: 5 } } })).toBe(false);
    expect(bad({ contigTags: { x: { tags: ['Haplotig'] } } })).toBe(false);
    expect(bad({ contigTags: [] })).toBe(false);
    expect(bad({ excludedContigs: [1.5] })).toBe(false);
    expect(bad({ excludedContigs: 'all' })).toBe(false);
    expect(validateSession(session)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sessions saved before contig boundaries followed PretextView
// ---------------------------------------------------------------------------
//
// The parser used to place some contig boundaries one texel away from where
// it places them now (see PretextParser, step 5). A session saved then holds
// texel positions in the old layout. It must still restore on the same map,
// with every position moved to the new layout.

describe('a session saved under the earlier contig boundaries', () => {
  // The same six contigs under the two layouts. Boundaries moved by a texel:
  // c1 gained its first texel (it had none), c2 lost one from its start, c3
  // lost its only texel and c4 gained one.
  const OLD = [10, 0, 10, 1, 9, 10];
  const NEW = [10, 1, 9, 0, 10, 10];

  let scaffolds: ScaffoldManager;
  beforeEach(() => {
    state.reset();
    scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
  });

  it('restores an untouched assembly, and says the boundaries moved', () => {
    load(OLD);
    const session = saveAndReload(scaffolds);
    const plan = planSessionRestore(session, freshMap(NEW));
    expect(plan.contigOrder).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.contigs.map((c) => [c.pixelStart, c.pixelEnd])).toEqual([[0, 10], [10, 11], [11, 20], [20, 20], [20, 30], [30, 40]]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/4 contigs on this map moved by one texel/);
  });

  it('carries cuts across: every cut stays at the texel of the map it was made at', () => {
    load(OLD);
    CurationEngine.cut(2, 4);          // c2 [10,20) -> [10,14) + [14,20)
    CurationEngine.cut(5, 3);          // c4 [21,30) -> [21,24) + [24,30)
    const session = saveAndReload(scaffolds);
    const plan = planSessionRestore(session, freshMap(NEW));
    const spans = plan.contigOrder.map((id) => [plan.contigs[id].name, plan.contigs[id].pixelStart, plan.contigs[id].pixelEnd]);
    expect(spans).toEqual([
      ['c0', 0, 10],
      ['c1', 10, 11],                  // now one texel
      ['c2_L', 11, 14],                // lost texel 10 to c1; the cut is still at texel 14
      ['c2_R', 14, 20],
      ['c3', 20, 20],                  // no texel now
      ['c4_L', 20, 24],                // gained texel 20 from c3; the cut is still at texel 24
      ['c4_R', 24, 30],
      ['c5', 30, 40],
    ]);
  });

  it('keeps the curated order, orientation and ownership through random edits', () => {
    for (let seed = 1; seed <= 60; seed++) {
      load(OLD);
      randomEdits(mulberry32(seed), 14);
      const before = state.get();
      const session = saveAndReload(scaffolds);

      const plan = planSessionRestore(session, freshMap(NEW));   // throws if any texel is lost or repeated
      expect(plan.contigOrder, `seed ${seed}`).toEqual(before.contigOrder);
      expect(plan.contigs.map((c) => c.name), `seed ${seed}`).toEqual(before.map!.contigs.map((c) => c.name));
      // Orientation of every contig still made of one sequence is unchanged.
      // (A joined contig's flag can change when a part of it no longer owns a
      // texel: it then reads one span in one direction.)
      const single = (c: ContigInfo) => !c.pixelSegments && (c.sequenceSegments?.length ?? 1) === 1;
      before.map!.contigs.forEach((c, id) => {
        if (single(c) && c.pixelEnd > c.pixelStart && plan.contigs[id].pixelEnd > plan.contigs[id].pixelStart) {
          expect(plan.contigs[id].inverted, `seed ${seed}, ${c.name}`).toBe(c.inverted);
        }
      });

      // The picture is the same: every texel of the map is shown where it
      // was, apart from the two that changed hands (10, from c2 to c1, and
      // 20, from c3 to c4), which go with their new contig.
      const texelsBefore = describeAssembly(before.map!.contigs, before.contigOrder).texels;
      const texelsNow = describeAssembly(plan.contigs, plan.contigOrder).texels;
      const settled = (a: number[]) => a.filter((t) => t !== 10 && t !== 20);
      expect(settled(texelsNow), `seed ${seed}`).toEqual(settled(texelsBefore));
      expect([...texelsNow].sort((x, y) => x - y), `seed ${seed}`).toEqual(Array.from({ length: 40 }, (_, t) => t));

      // The restored assembly can be edited and saved again without a warning.
      state.reset();
      state.update({ map: { ...freshMap(NEW), contigs: plan.contigs }, contigOrder: plan.contigOrder });
      const again = planSessionRestore(saveAndReload(scaffolds), freshMap(NEW));
      expect(again.warnings, `seed ${seed}`).toEqual([]);
      expect(describeAssembly(again.contigs, again.contigOrder).texels, `seed ${seed}`)
        .toEqual(describeAssembly(plan.contigs, plan.contigOrder).texels);
    }
  });

  it('still refuses a session from a map whose contigs sit elsewhere', () => {
    load([10, 5, 5, 1, 9, 10]);
    const session = saveAndReload(scaffolds);
    expect(() => planSessionRestore(session, freshMap(NEW)))
      .toThrow(/different assembly \(contig 2, "c1", spans texels 10 to 15 in the session and 10 to 11 in this file\)/);
  });

  it('has nothing to say about a session saved under the current boundaries', () => {
    load(NEW);
    CurationEngine.cut(2, 4);
    expect(planSessionRestore(saveAndReload(scaffolds), freshMap(NEW)).warnings).toEqual([]);
  });
});

// The same, on real maps. Skipped where the files are absent.
const REAL_MAPS = [
  'test-data/Phascolarctos_cinereus.pretext',
  'test-data/Coturnix_chinensis_post.pretext',
  'test-data/case-study/quail/bCotChi1.combined.pretext',
  'test-data/Anilios_waitii_post.pretext',
].map((f) => resolve(__dirname, '../..', f)).filter((f) => existsSync(f));

(REAL_MAPS.length > 0 ? describe : describe.skip)('old sessions on real maps', () => {
  it.each(REAL_MAPS)('a session saved under the earlier boundaries restores on %s', (path) => {
    const bytes = readFileSync(path);
    const { header, contigs } = readPretextHeader(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const N = header.numberOfPixels1D;
    const mapWith = (spans: Array<[number, number]>): MapData => ({
      filename: 'real.pretext', textureSize: N, numMipMaps: 1, tileResolution: N, tilesPerDimension: 1,
      contigs: contigs.map((c, i) => ({
        name: c.name, originalIndex: i, length: c.length,
        pixelStart: spans[i][0], pixelEnd: spans[i][1], inverted: false, scaffoldId: null,
      })),
      fileContigCount: contigs.length, contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
    });
    const current = contigs.map((c) => [c.pixelStart, c.pixelEnd] as [number, number]);
    // The earlier rule: the running sum of the fractions in double precision.
    const earlier: Array<[number, number]> = [];
    let sum = 0;
    contigs.forEach((c, i) => {
      const start = Math.min(N, Math.floor(sum * N));
      sum += c.fractionalLength;
      earlier.push([start, i === contigs.length - 1 ? N : Math.min(N, Math.floor(sum * N))]);
    });
    const shifted = earlier.map((e, i) => i).filter((i) => earlier[i][0] !== current[i][0] || earlier[i][1] !== current[i][1]);
    expect(shifted.length, 'this map is one the change affected').toBeGreaterThan(0);

    // Curate under the earlier layout, cutting every affected contig that can
    // be cut and its neighbours, then moving, inverting and joining around them.
    const scaffolds = new ScaffoldManager();
    CurationEngine.setScaffoldManager(scaffolds);
    state.reset();
    state.update({ map: mapWith(earlier), contigOrder: contigs.map((_, i) => i) });
    const targets = [...new Set(shifted.flatMap((i) => [i - 1, i, i + 1]))]
      .filter((i) => i >= 0 && i < contigs.length).sort((a, b) => b - a);
    for (const i of targets) {
      const pos = state.get().contigOrder.indexOf(i);
      const w = earlier[i][1] - earlier[i][0];
      if (pos !== -1 && w >= 2) CurationEngine.cut(pos, w === 2 ? 1 : 1 + (i % (w - 1)));
    }
    randomEdits(mulberry32(7), 40);
    const before = state.get();
    const texelsBefore = describeAssembly(before.map!.contigs, before.contigOrder).texels;
    const session = saveAndReload(scaffolds);

    const plan = planSessionRestore(session, mapWith(current));
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/moved by one texel/);
    expect(plan.contigOrder).toEqual(before.contigOrder);

    // Texels whose owner changed between the two layouts.
    const ownerOf = (spans: Array<[number, number]>) => {
      const o = new Int32Array(N).fill(-1);
      spans.forEach(([a, b], i) => { for (let t = a; t < b; t++) o[t] = i; });
      return o;
    };
    const was = ownerOf(earlier);
    const now = ownerOf(current);
    const changed = new Set<number>();
    for (let t = 0; t < N; t++) if (was[t] !== now[t]) changed.add(t);
    expect(changed.size).toBeGreaterThan(0);
    expect(changed.size).toBeLessThanOrEqual(shifted.length);

    const texelsNow = describeAssembly(plan.contigs, plan.contigOrder).texels;
    expect(texelsNow).toHaveLength(N);
    expect(new Set(texelsNow).size).toBe(N);
    const settled = (a: number[]) => a.filter((t) => !changed.has(t));
    expect(settled(texelsNow)).toEqual(settled(texelsBefore));
  });
});
