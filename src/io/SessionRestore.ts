/**
 * SessionRestore — decide what a saved session means for the loaded map.
 *
 * A session is untrusted input that is about to replace the assembly on
 * screen, and later the exported AGP and FASTA. `planSessionRestore` checks it
 * against the loaded file and returns the contig table and order to install,
 * or throws with a reason a curator can act on. It changes nothing itself, so
 * a refused session leaves the app exactly as it was.
 */

import type { ContigInfo, MapData, PixelSegment } from '../core/State';
import { getPixelSegments } from '../core/DisplayMapping';
import type { SessionData } from './SessionManager';
import type { MetaTagInfo } from '../curation/MetaTagManager';

export interface SessionRestorePlan {
  contigs: ContigInfo[];
  contigOrder: number[];
  /** Classification tags to restore, by contig id. */
  tags: Array<[number, MetaTagInfo]>;
  /** Contig ids excluded from export. */
  excluded: number[];
}

type SessionLayout = Pick<SessionRestorePlan, 'contigs' | 'contigOrder'>;

/** The contigs the file defines, as loaded (orientation and scaffold cleared). */
function fileContigs(map: MapData): ContigInfo[] {
  const n = map.fileContigCount ?? map.contigs.length;
  return map.contigs.slice(0, n).map((c) => ({
    name: c.name,
    originalIndex: c.originalIndex,
    length: c.length,
    pixelStart: c.pixelStart,
    pixelEnd: c.pixelEnd,
    inverted: false,
    scaffoldId: null,
  }));
}

function checkOrder(order: number[], contigCount: number): void {
  const seen = new Set<number>();
  for (const id of order) {
    if (!Number.isInteger(id) || id < 0 || id >= contigCount) {
      throw new Error(`the session places contig ${id}, which it does not define`);
    }
    if (seen.has(id)) throw new Error(`the session places contig ${id} twice`);
    seen.add(id);
  }
}

/**
 * The displayed contigs must show each texel of the file's contigs exactly
 * once: curation rearranges the map and never drops or repeats any of it.
 */
function checkCoverage(contigs: ContigInfo[], order: number[], file: ContigInfo[]): void {
  const shown: PixelSegment[] = [];
  for (const id of order) shown.push(...getPixelSegments(contigs[id]));
  shown.sort((a, b) => a.start - b.start);

  // The file's texels, as disjoint intervals (neighbouring contigs merged,
  // since a join of file neighbours is stored as one span across both).
  const expected: Array<[number, number]> = [];
  for (const c of [...file].sort((a, b) => a.pixelStart - b.pixelStart)) {
    if (c.pixelEnd <= c.pixelStart) continue;
    const last = expected[expected.length - 1];
    if (last && last[1] === c.pixelStart) last[1] = c.pixelEnd;
    else expected.push([c.pixelStart, c.pixelEnd]);
  }

  const fail = () => new Error('the session does not show each part of the map exactly once');
  let i = 0;
  for (const [start, end] of expected) {
    let pos = start;
    while (pos < end) {
      const seg = shown[i];
      if (!seg || seg.start !== pos || seg.end > end) throw fail();
      pos = seg.end;
      i++;
    }
  }
  if (i !== shown.length) throw fail();
}

function planFromContigTable(session: SessionData, map: MapData): SessionLayout {
  const file = fileContigs(map);
  const saved = session.contigs!;
  const assembly = session.assembly!;

  if (assembly.textureSize !== map.textureSize || assembly.fileContigCount !== file.length) {
    throw new Error(
      `it was saved for a different assembly (${assembly.fileContigCount} contigs, ` +
      `${assembly.textureSize} px; this one has ${file.length} contigs, ${map.textureSize} px)`,
    );
  }
  if (saved.length < file.length) throw new Error('its contig table is incomplete');
  for (let i = 0; i < file.length; i++) {
    const a = saved[i];
    const b = file[i];
    if (a.name !== b.name || a.pixelStart !== b.pixelStart || a.pixelEnd !== b.pixelEnd || a.pixelSegments) {
      throw new Error(`it was saved for a different assembly (contig ${i + 1} is "${a.name}", this file has "${b.name}")`);
    }
  }

  const scaffoldIds = new Set(session.scaffolds.map((sc) => sc.id));
  const contigs: ContigInfo[] = saved.map((c, i) => {
    if (c.pixelEnd < c.pixelStart) throw new Error(`contig ${i} has a negative width`);
    if (c.pixelSegments) {
      let width = 0;
      for (const p of c.pixelSegments) {
        if (p.end <= p.start || p.end > map.textureSize) throw new Error(`contig ${i} has an invalid map segment`);
        width += p.end - p.start;
      }
      if (width !== c.pixelEnd - c.pixelStart) throw new Error(`contig ${i} has segments that do not add up to its width`);
    } else if (c.pixelEnd > map.textureSize) {
      throw new Error(`contig ${i} lies outside the map`);
    }
    const out: ContigInfo = {
      name: c.name,
      originalIndex: c.originalIndex,
      length: c.length,
      pixelStart: c.pixelStart,
      pixelEnd: c.pixelEnd,
      inverted: c.inverted,
      // An assignment to a scaffold the session does not define is dropped.
      scaffoldId: c.scaffoldId !== null && scaffoldIds.has(c.scaffoldId) ? c.scaffoldId : null,
    };
    if (c.pixelSegments) out.pixelSegments = c.pixelSegments.map((p) => ({ ...p }));
    if (c.sequenceSegments) out.sequenceSegments = c.sequenceSegments.map((q) => ({ ...q }));
    return out;
  });

  const contigOrder = [...session.contigOrder];
  checkOrder(contigOrder, contigs.length);
  checkCoverage(contigs, contigOrder, file);
  return { contigs, contigOrder };
}

/**
 * A version 1 session records only an order and per-contig orientation and
 * scaffold. That describes the assembly completely only if nothing was cut or
 * joined, in which case the order is a permutation of the file's contigs.
 */
function planFromLegacy(session: SessionData, map: MapData): SessionLayout {
  const file = fileContigs(map);
  const order = session.contigOrder.length > 0 ? [...session.contigOrder] : file.map((_, i) => i);

  const cutOrJoined = order.some((id) => id >= file.length);
  if (cutOrJoined) {
    throw new Error(
      'it was saved after a cut or join by an earlier version of OpenPretext, ' +
      'which did not record the pieces. Replay the edits from the curation log or script instead',
    );
  }
  checkOrder(order, file.length);
  if (order.length !== file.length) {
    throw new Error(`it places ${order.length} contigs and this assembly has ${file.length}`);
  }

  const scaffoldIds = new Set(session.scaffolds.map((sc) => sc.id));
  const contigs = file.map((c, i) => {
    const o = session.contigStates[i];
    if (!o) return c;
    return {
      ...c,
      inverted: o.inverted,
      scaffoldId: o.scaffoldId !== null && scaffoldIds.has(o.scaffoldId) ? o.scaffoldId : null,
    };
  });
  return { contigs, contigOrder: order };
}

/**
 * Work out the contig table and order a session restores on `map`.
 * @throws Error whose message completes "This session cannot be restored: ..."
 */
export function planSessionRestore(session: SessionData, map: MapData): SessionRestorePlan {
  const layout = session.contigs && session.assembly
    ? planFromContigTable(session, map)
    : planFromLegacy(session, map);

  // Tags and exclusions attach to contigs the session places. One that names
  // any other contig means the file is not what it claims to be.
  const placed = new Set(layout.contigOrder);
  const tags: Array<[number, MetaTagInfo]> = [];
  for (const [key, info] of Object.entries(session.contigTags ?? {})) {
    const id = Number(key);
    if (!placed.has(id)) throw new Error(`it tags contig ${key}, which it does not place`);
    tags.push([id, info.notes !== undefined ? { tag: info.tag, notes: info.notes } : { tag: info.tag }]);
  }
  const excluded: number[] = [];
  for (const id of session.excludedContigs ?? []) {
    if (!placed.has(id)) throw new Error(`it excludes contig ${id}, which it does not place`);
    if (!excluded.includes(id)) excluded.push(id);
  }
  return { ...layout, tags, excluded };
}
