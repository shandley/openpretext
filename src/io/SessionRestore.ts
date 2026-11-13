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
import { getPixelSegments, pixelFieldsFor } from '../core/DisplayMapping';
import type { SessionData } from './SessionManager';
import { fromLegacyTag, sortTags, type MetaTagInfo } from '../curation/MetaTagManager';

export interface SessionRestorePlan {
  contigs: ContigInfo[];
  contigOrder: number[];
  /** Classification tags to restore, by contig id. */
  tags: Array<[number, MetaTagInfo]>;
  /** Contig ids excluded from export. */
  excluded: number[];
  /** Things the session held that could not be carried over, for the user. */
  warnings: string[];
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

/**
 * Re-express a saved contig table in the map's texel layout, when the two
 * differ only in where the file's contigs begin and end.
 *
 * The map's picture has not changed, only which contig the texel at some
 * boundaries is counted as. So every texel stays where the curator put it: a
 * cut stays at the same texel of the map. What changes is at the edges of the
 * file's contigs: a piece that reached the edge of its contig still does, so
 * it gains or loses the texel that changed hands. A piece left with no texels
 * (all it held now belongs to a neighbour) keeps its entry with zero width.
 */
function relayout(saved: ContigInfo[], file: ContigInfo[]): ContigInfo[] {
  // The file's contigs that owned texels under the saved layout, in file order.
  const owners = file
    .map((_, i) => ({ i, start: saved[i].pixelStart, end: saved[i].pixelEnd }))
    .filter((o) => o.end > o.start);

  /** A span of the saved layout as spans of the map's, in file order. */
  const moveSpan = (start: number, end: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    // First owner whose end is past `start`.
    let lo = 0;
    let hi = owners.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (owners[mid].end <= start) lo = mid + 1; else hi = mid;
    }
    for (let k = lo; k < owners.length && owners[k].start < end; k++) {
      const o = owners[k];
      const now = file[o.i];
      // Texels keep their positions; a span that reached an edge of the
      // contig reaches its edge still.
      const clamp = (t: number) => Math.min(now.pixelEnd, Math.max(now.pixelStart, t));
      const a = start <= o.start ? now.pixelStart : clamp(start);
      const b = end >= o.end ? now.pixelEnd : clamp(end);
      if (b <= a) continue;
      const last = out[out.length - 1];
      if (last && last[1] === a) last[1] = b; else out.push([a, b]);
    }
    return out;
  };

  // A contig made by a cut or join also records which stretch of which
  // sequence each of its parts is, in base pairs. That says more than its
  // texel spans do: a sequence that owned no texel when the session was saved
  // has no span to move, but it is still named there, so the texel it owns
  // now goes to the contig it was joined into.
  const byName = new Map<string, number>();
  let namesUnique = true;
  file.forEach((c, i) => { if (byName.has(c.name)) namesUnique = false; else byName.set(c.name, i); });
  const fromSequence = (c: ContigInfo): PixelSegment[] | null => {
    if (!namesUnique || !c.sequenceSegments || c.sequenceSegments.length === 0) return null;
    const out: PixelSegment[] = [];
    for (const q of c.sequenceSegments) {
      const i = byName.get(q.sourceName);
      if (i === undefined) return null;
      const length = saved[i].length;
      const oldWidth = saved[i].pixelEnd - saved[i].pixelStart;
      const now = file[i];
      // The texel offsets this stretch had, recovered from its base pairs.
      const k0 = length > 0 ? Math.round((q.start * oldWidth) / length) : 0;
      const k1 = length > 0 ? Math.round((q.end * oldWidth) / length) : oldWidth;
      // The same texels of the map, except that a stretch running to an end
      // of its sequence runs to the end of the sequence's texels as they are now.
      const clamp = (t: number) => Math.min(now.pixelEnd, Math.max(now.pixelStart, t));
      const a = q.start <= 0 || k0 <= 0 ? now.pixelStart : clamp(saved[i].pixelStart + k0);
      const b = q.end >= length || k1 >= oldWidth ? now.pixelEnd : clamp(saved[i].pixelStart + k1);
      if (b > a) out.push({ start: a, end: b, reversed: q.revComp });
    }
    return out;
  };

  return saved.map((c, i) => {
    if (i < file.length) return { ...c, pixelStart: file[i].pixelStart, pixelEnd: file[i].pixelEnd };
    let segments = fromSequence(c);
    if (segments === null) {
      segments = [];
      for (const seg of getPixelSegments(c)) {
        const moved = moveSpan(seg.start, seg.end).map(([a, b]) => ({ start: a, end: b, reversed: seg.reversed }));
        // A reversed slice reads the file backward, so its parts do too.
        segments.push(...(seg.reversed ? moved.reverse() : moved));
      }
    }
    const { pixelSegments: _dropped, ...rest } = c;
    const fields = pixelFieldsFor(segments, c.inverted);
    const out: ContigInfo = { ...rest, ...fields };
    if (fields.pixelSegments === undefined) delete out.pixelSegments;
    return out;
  });
}

function planFromContigTable(session: SessionData, map: MapData, notes: string[]): SessionLayout {
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
  let shifted = 0;
  for (let i = 0; i < file.length; i++) {
    const a = saved[i];
    const b = file[i];
    if (a.name !== b.name || a.pixelSegments) {
      throw new Error(`it was saved for a different assembly (contig ${i + 1} is "${a.name}", this file has "${b.name}")`);
    }
    if (a.pixelStart !== b.pixelStart || a.pixelEnd !== b.pixelEnd) {
      // Sessions saved before contig boundaries were derived the way
      // PretextView derives them (see PretextParser, step 5) can differ from
      // the map by one texel at some boundaries. Anything larger is another map.
      if (Math.abs(a.pixelStart - b.pixelStart) > 1 || Math.abs(a.pixelEnd - b.pixelEnd) > 1) {
        throw new Error(
          `it was saved for a different assembly (contig ${i + 1}, "${a.name}", spans texels ` +
          `${a.pixelStart} to ${a.pixelEnd} in the session and ${b.pixelStart} to ${b.pixelEnd} in this file)`);
      }
      shifted++;
    }
  }
  // Move every texel position in the session from the layout it was saved
  // under to the map's. The session's own contigs are untouched; `savedTable`
  // is what is read from here on.
  const savedTable = shifted > 0 ? relayout(saved, file) : saved;
  if (shifted > 0) {
    notes.push(
      `This session was saved before OpenPretext placed contig boundaries exactly as PretextView does. ` +
      `${shifted} contig${shifted === 1 ? '' : 's'} on this map moved by one texel, and the session was adjusted to match. ` +
      'Check any cut that was made at the very edge of a contig.');
  }

  const scaffoldIds = new Set(session.scaffolds.map((sc) => sc.id));
  const contigs: ContigInfo[] = savedTable.map((c, i) => {
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
  const notes: string[] = [];
  const layout = session.contigs && session.assembly
    ? planFromContigTable(session, map, notes)
    : planFromLegacy(session, map);

  // Tags and exclusions attach to contigs the session places. One that names
  // any other contig means the file is not what it claims to be.
  const placed = new Set(layout.contigOrder);
  const tags: Array<[number, MetaTagInfo]> = [];
  const unnamed: string[] = [];
  for (const [key, info] of Object.entries(session.contigTags ?? {})) {
    const id = Number(key);
    if (!placed.has(id)) throw new Error(`it tags contig ${key}, which it does not place`);
    let list: string[];
    if ('tags' in info) {
      list = sortTags(info.tags);
    } else {
      // Version 2 stored one lower-case tag. Three of the four have an exact
      // equivalent; "sex_chromosome" never said which chromosome.
      const mapped = fromLegacyTag(info.tag);
      if (mapped === null) {
        unnamed.push(layout.contigs[id]?.name ?? `#${id}`);
        continue;
      }
      list = [mapped];
    }
    tags.push([id, info.notes !== undefined ? { tags: list, notes: info.notes } : { tags: list }]);
  }
  const warnings: string[] = [...notes];
  if (unnamed.length > 0) {
    warnings.push(
      `${unnamed.length} sex chromosome tag${unnamed.length === 1 ? '' : 's'} could not be restored, because the ` +
      `session did not record which chromosome (${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ', ...' : ''}). ` +
      'Tag them again as X, Y, Z or W.');
  }
  const excluded: number[] = [];
  for (const id of session.excludedContigs ?? []) {
    if (!placed.has(id)) throw new Error(`it excludes contig ${id}, which it does not place`);
    if (!excluded.includes(id)) excluded.push(id);
  }
  return { ...layout, tags, excluded, warnings };
}
