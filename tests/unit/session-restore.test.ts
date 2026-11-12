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
      [[6, { tag: 'haplotig' }], [order[0], { tag: 'contaminant', notes: 'bacterial, see blast' }]],
      [7, 3],
    ));
    expect(session.contigTags).toEqual({
      6: { tag: 'haplotig' },
      [order[0]]: { tag: 'contaminant', notes: 'bacterial, see blast' },
    });
    expect(session.excludedContigs).toEqual([3, 7]);

    const plan = planSessionRestore(session, freshMap(WIDTHS));
    expect(new Map(plan.tags)).toEqual(new Map<number, MetaTagInfo>([
      [6, { tag: 'haplotig' }],
      [order[0], { tag: 'contaminant', notes: 'bacterial, see blast' }],
    ]));
    expect(plan.excluded.sort()).toEqual([3, 7]);
    // The tagged ids are the same contigs after restore.
    expect(plan.contigs[6].name).toBe(state.get().map!.contigs[6].name);
  });

  it('does not save a mark left on a contig that a cut has replaced', () => {
    // Contig 1 was cut and is no longer placed.
    const session = save(marks([[1, { tag: 'haplotig' }], [2, { tag: 'unlocalised' }]], [1, 2]));
    expect(session.contigTags).toEqual({ 2: { tag: 'unlocalised' } });
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
    expect(() => planSessionRestore({ ...session, contigTags: { 1: { tag: 'haplotig' } } }, freshMap(WIDTHS)))
      .toThrow(/tags contig 1, which it does not place/);
    expect(() => planSessionRestore({ ...session, excludedContigs: [99] }, freshMap(WIDTHS)))
      .toThrow(/excludes contig 99/);
  });

  it('rejects malformed marks at import', () => {
    const session = save(marks([[6, { tag: 'haplotig' }]], [7]));
    const bad = (patch: object) => validateSession({ ...session, ...patch });
    expect(bad({ contigTags: { 6: { tag: 'virus' } } })).toBe(false);
    expect(bad({ contigTags: { 6: { tag: 'haplotig', notes: 5 } } })).toBe(false);
    expect(bad({ contigTags: { x: { tag: 'haplotig' } } })).toBe(false);
    expect(bad({ contigTags: [] })).toBe(false);
    expect(bad({ excludedContigs: [1.5] })).toBe(false);
    expect(bad({ excludedContigs: 'all' })).toBe(false);
    expect(validateSession(session)).toBe(true);
  });
});
