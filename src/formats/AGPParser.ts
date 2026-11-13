/**
 * AGP (A Golden Path) reader: put a curation written as AGP onto a loaded map.
 *
 * Reads the AGP PretextView writes (and the one `src/export/AGPWriter.ts`
 * writes, which has the same layout): each sequence row names an original
 * sequence and an interval of it at texel resolution, painted rows carry
 * `Painted` in column 10, and tags follow one per column. Plain nine-column
 * AGP is read too.
 *
 * `parseAGP` reads the text. `planAGPImport` turns it into an assembly for
 * the loaded map without changing anything, so a file that does not fit is
 * refused before any state moves. An import is a load, like opening a
 * session: it replaces the current order, cuts, scaffolds and tags.
 *
 * What an AGP cannot carry, and so does not come back: which contigs were
 * excluded (tags such as `Contaminant` do come back, the exclusion does not),
 * and, in PretextView's default layout, where unpainted contigs sat among the
 * painted ones (it writes painted scaffolds first).
 *
 * Pure: no DOM or app-state dependencies.
 */

import type { ContigInfo, MapData, PixelSegment } from '../core/State';
import { pixelFieldsFor } from '../core/DisplayMapping';
import { isValidTag, sortTags } from '../curation/MetaTagManager';
import { fileContigsOf, genomeLengthOf, texelBoundaryBp } from '../export/AGPModel';

/** One sequence row of an AGP file. */
export interface AGPSequenceRow {
  object: string;
  component: string;
  /** Interval of the component, 1-based and inclusive. */
  beg: number;
  end: number;
  reversed: boolean;
  /** Column 10 was `Painted`. */
  painted: boolean;
  /** The other words from column 10 onward. */
  tags: string[];
  /** Line number in the file, for messages. */
  line: number;
}

export interface ParsedAGP {
  rows: AGPSequenceRow[];
  /** bp per texel from a `# HiC MAP RESOLUTION:` header line, if there is one. */
  resolution: number | null;
  /** True when any row has a tenth column: the PretextView layout. */
  hasExtraColumns: boolean;
  /** Lines that were neither a comment, a gap row nor a usable sequence row. */
  skippedLines: number[];
}

/**
 * Parse AGP text. Comment and blank lines are skipped, gap rows (`N`, `U`)
 * are recognised and dropped (they say nothing an import uses), and lines
 * that are not a usable sequence row are counted in `skippedLines`.
 */
export function parseAGP(text: string): ParsedAGP {
  const rows: AGPSequenceRow[] = [];
  const skippedLines: number[] = [];
  let resolution: number | null = null;
  let hasExtraColumns = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    if (raw.startsWith('#')) {
      const m = /HiC MAP RESOLUTION:\s*([\d.]+)\s*bp\/texel/.exec(raw);
      if (m) resolution = Number(m[1]);
      continue;
    }
    // PretextView leaves a stray tab at the end of tagged rows.
    const cols = raw.replace(/[\t ]+$/, '').split('\t');
    if (cols.length >= 5 && (cols[4] === 'N' || cols[4] === 'U')) continue;
    const beg = Number(cols[6]);
    const end = Number(cols[7]);
    if (
      cols.length < 9 || !cols[0] || !cols[5] ||
      !Number.isInteger(beg) || !Number.isInteger(end) || beg < 1 || end < beg ||
      !['+', '-', '?', '0', 'na'].includes(cols[8])
    ) {
      skippedLines.push(i + 1);
      continue;
    }
    const extra = cols.slice(9).map((c) => c.trim()).filter((c) => c !== '');
    if (extra.length > 0) hasExtraColumns = true;
    rows.push({
      object: cols[0],
      component: cols[5],
      beg,
      end,
      reversed: cols[8] === '-',
      painted: extra.includes('Painted'),
      tags: extra.filter((t) => t !== 'Painted'),
      line: i + 1,
    });
  }
  return { rows, resolution, hasExtraColumns, skippedLines };
}

/** The assembly an AGP describes, for the loaded map. */
export interface AGPImportPlan {
  /** The map's contig table: the file's contigs, then the pieces and joins the AGP calls for. */
  contigs: ContigInfo[];
  /** Curated order, by contig id. Every texel of the map is in it exactly once. */
  contigOrder: number[];
  /** Scaffolds to create, in file order, with the contigs to paint into each. */
  scaffolds: Array<{ name: string; contigIds: number[] }>;
  /** Tags by contig id. */
  tags: Array<[number, string[]]>;
  /** Things the curator should know, as sentences. */
  warnings: string[];
  /** Counts for the confirmation message. */
  stats: { rows: number; cuts: number; scaffolds: number; tagged: number };
}

/** The AGP cannot be applied to this map. The message says why. */
export class AGPImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AGPImportError';
  }
}

interface Piece {
  row: AGPSequenceRow;
  source: number;
  /** Texel range within the source sequence. */
  t0: number;
  t1: number;
}

function sample(names: string[]): string {
  const shown = names.slice(0, 5).map((n) => `"${n}"`).join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

/**
 * Work out the assembly an AGP describes for `map`. Throws AGPImportError if
 * the file does not belong to this map; otherwise never drops any part of the
 * map: whatever the AGP does not place is kept, after everything it does.
 */
export function planAGPImport(parsed: ParsedAGP, map: MapData): AGPImportPlan {
  const files = fileContigsOf(map);
  const N = map.textureSize;
  const L = genomeLengthOf(map);
  const warnings: string[] = [];

  if (parsed.rows.length === 0) throw new AGPImportError('it has no sequence rows');

  const byName = new Map<string, number>();
  files.forEach((c, i) => { if (!byName.has(c.name)) byName.set(c.name, i); });

  const unknown = [...new Set(parsed.rows.filter((r) => !byName.has(r.component)).map((r) => r.component))];
  if (parsed.rows.every((r) => !byName.has(r.component))) {
    throw new AGPImportError(
      `none of its sequences are in the loaded map (for example ${sample(unknown)}). It was written for a different assembly`);
  }
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.length} sequence${unknown.length === 1 ? '' : 's'} named in the AGP ${unknown.length === 1 ? 'is' : 'are'} ` +
      `not in the loaded map and ${unknown.length === 1 ? 'was' : 'were'} skipped: ${sample(unknown)}.`);
  }
  if (parsed.resolution !== null) {
    const ours = L / N;
    if (Math.abs(parsed.resolution - ours) > ours * 1e-6 + 1e-6) {
      throw new AGPImportError(
        `it was written for a map of ${parsed.resolution} bp per texel, and the loaded map has ${ours.toFixed(6)}`);
    }
  }

  // ---- Rows to texel ranges ----
  const rowsPerComponent = new Map<string, number>();
  for (const r of parsed.rows) rowsPerComponent.set(r.component, (rowsPerComponent.get(r.component) ?? 0) + 1);

  /** Nearest texel boundary to a base-pair boundary (bp count from the start of the sequence). */
  const toTexel = (bp: number, width: number): { texel: number; exact: boolean } => {
    const guess = Math.round((bp * N) / L);
    for (const k of [guess, guess - 1, guess + 1]) {
      if (k >= 0 && k <= width && texelBoundaryBp(k, N, L) === bp) return { texel: k, exact: true };
    }
    return { texel: Math.min(width, Math.max(0, guess)), exact: false };
  };

  let moved = 0;
  const pieces: Piece[] = [];
  const noTexels: string[] = [];
  for (const row of parsed.rows) {
    const source = byName.get(row.component);
    if (source === undefined) continue;
    const width = files[source].pixelEnd - files[source].pixelStart;
    if (width === 0) {
      // A sequence too small to own a texel. It has nothing to place.
      noTexels.push(row.component);
      continue;
    }
    if (rowsPerComponent.get(row.component) === 1 && row.beg === 1) {
      // The only row for its sequence: the whole of it, whatever the end
      // coordinate says (a corrected AGP carries the true length there).
      pieces.push({ row, source, t0: 0, t1: width });
      continue;
    }
    const a = toTexel(row.beg - 1, width);
    const b = toTexel(row.end, width);
    if (!a.exact || !b.exact) moved++;
    if (b.texel <= a.texel) {
      throw new AGPImportError(
        `line ${row.line}: ${row.component} ${row.beg}-${row.end} is smaller than one texel of this map`);
    }
    pieces.push({ row, source, t0: a.texel, t1: b.texel });
  }
  if (moved > 0) {
    warnings.push(
      `${moved} row${moved === 1 ? '' : 's'} had coordinates that are not on a texel boundary of this map; ` +
      'they were moved to the nearest one. (An AGP corrected to true sequence lengths reads this way.)');
  }

  // ---- Each sequence must be used at most once per texel ----
  const bySource = new Map<number, Piece[]>();
  for (const p of pieces) {
    if (!bySource.has(p.source)) bySource.set(p.source, []);
    bySource.get(p.source)!.push(p);
  }
  /** Texel ranges of each sequence that no row placed. */
  const leftover: Array<{ source: number; t0: number; t1: number }> = [];
  for (const [source, list] of bySource) {
    const sorted = [...list].sort((x, y) => x.t0 - y.t0);
    const width = files[source].pixelEnd - files[source].pixelStart;
    let at = 0;
    for (const p of sorted) {
      if (p.t0 < at) {
        throw new AGPImportError(
          `line ${p.row.line}: ${p.row.component} ${p.row.beg}-${p.row.end} overlaps another row for the same sequence`);
      }
      if (p.t0 > at) leftover.push({ source, t0: at, t1: p.t0 });
      at = p.t1;
    }
    if (at < width) leftover.push({ source, t0: at, t1: width });
  }

  // ---- Build contigs ----
  // The file's contigs keep their ids, cleared of any earlier curation.
  const contigs: ContigInfo[] = files.map((c, i) => {
    const { pixelSegments: _p, sequenceSegments: _s, ...rest } = c;
    return { ...rest, originalIndex: i, inverted: false, scaffoldId: null };
  });
  const whole = (p: { source: number; t0: number; t1: number }) =>
    p.t0 === 0 && p.t1 === files[p.source].pixelEnd - files[p.source].pixelStart;
  const fileSpan = (p: { source: number; t0: number; t1: number }, reversed: boolean): PixelSegment => ({
    start: files[p.source].pixelStart + p.t0, end: files[p.source].pixelStart + p.t1, reversed,
  });
  const bp = (p: { t0: number; t1: number }) => ({
    start: texelBoundaryBp(p.t0, N, L), end: texelBoundaryBp(p.t1, N, L),
  });

  // Number the pieces of each cut sequence along it, for their names.
  const pieceNumber = new Map<Piece, number>();
  let cuts = 0;
  for (const [source, list] of bySource) {
    const all = [
      ...list.map((p) => ({ t0: p.t0, piece: p as Piece | null })),
      ...leftover.filter((l) => l.source === source).map((l) => ({ t0: l.t0, piece: null })),
    ].sort((x, y) => x.t0 - y.t0);
    if (all.length > 1) cuts += all.length - 1;
    all.forEach((x, k) => { if (x.piece) pieceNumber.set(x.piece, k + 1); });
  }

  /** A contig for one piece: the file's own contig if it is the whole sequence. */
  const contigFor = (p: Piece): number => {
    if (whole(p)) {
      contigs[p.source] = { ...contigs[p.source], inverted: p.row.reversed };
      return p.source;
    }
    const src = files[p.source];
    const span = bp(p);
    contigs.push({
      name: `${src.name}_${pieceNumber.get(p)}`,
      originalIndex: p.source,
      length: span.end - span.start,
      ...pixelFieldsFor([fileSpan(p, p.row.reversed)], p.row.reversed),
      scaffoldId: null,
      sequenceSegments: [{ sourceName: src.name, start: span.start, end: span.end, revComp: p.row.reversed }],
    });
    return contigs.length - 1;
  };

  // ---- Objects ----
  const order: number[] = [];
  const scaffolds: Array<{ name: string; contigIds: number[] }> = [];
  const tags = new Map<number, string[]>();
  const badTags = new Set<string>();
  const addTags = (id: number, rowTags: string[]) => {
    const good: string[] = [];
    for (const t of rowTags) { if (isValidTag(t)) good.push(t); else badTags.add(t); }
    if (good.length > 0) tags.set(id, sortTags([...(tags.get(id) ?? []), ...good]));
  };

  // Group the pieces into objects in file order. An object is every row
  // between two changes of column 1.
  const objects: Piece[][] = [];
  {
    const pieceOf = new Map(pieces.map((p) => [p.row, p]));
    let lastObject: string | null = null;
    for (const row of parsed.rows) {
      if (row.object !== lastObject) { objects.push([]); lastObject = row.object; }
      const p = pieceOf.get(row);
      if (p) objects[objects.length - 1].push(p);
    }
  }

  for (const members of objects) {
    if (members.length === 0) continue;
    // PretextView's layout says which objects are scaffolds with `Painted`.
    // It is recognised by its resolution header, or by any tenth column. Plain
    // AGP has no such column: there an object of several parts is a scaffold.
    const pretextViewLayout = parsed.resolution !== null || parsed.hasExtraColumns;
    const painted = pretextViewLayout ? members.some((p) => p.row.painted) : members.length > 1;

    if (painted || members.length === 1) {
      const ids = members.map((p) => {
        const id = contigFor(p);
        addTags(id, p.row.tags);
        return id;
      });
      order.push(...ids);
      if (painted) scaffolds.push({ name: members[0].row.object, contigIds: ids });
      continue;
    }

    // Several rows, not painted: one joined contig holding them in order.
    const segments = members.map((p) => fileSpan(p, p.row.reversed));
    const strand = members.every((p) => p.row.reversed);
    contigs.push({
      name: members.map((p) => (whole(p) ? files[p.source].name : `${files[p.source].name}_${pieceNumber.get(p)}`)).join('+'),
      originalIndex: members[0].source,
      length: members.reduce((n, p) => n + bp(p).end - bp(p).start, 0),
      ...pixelFieldsFor(segments, strand),
      scaffoldId: null,
      sequenceSegments: members.map((p) => ({
        sourceName: files[p.source].name, start: bp(p).start, end: bp(p).end, revComp: p.row.reversed,
      })),
    });
    const id = contigs.length - 1;
    for (const p of members) addTags(id, p.row.tags);
    order.push(id);
  }

  // ---- Whatever the AGP did not place stays, after everything it placed ----
  const usedSources = new Set(bySource.keys());
  let unplacedPieces = 0;
  for (const l of leftover.sort((x, y) => x.source - y.source || x.t0 - y.t0)) {
    const src = files[l.source];
    const span = bp(l);
    contigs.push({
      name: `${src.name}_unplaced_${l.t0}`,
      originalIndex: l.source,
      length: span.end - span.start,
      ...pixelFieldsFor([fileSpan(l, false)], false),
      scaffoldId: null,
      sequenceSegments: [{ sourceName: src.name, start: span.start, end: span.end, revComp: false }],
    });
    order.push(contigs.length - 1);
    unplacedPieces++;
  }
  let unplacedWhole = 0;
  files.forEach((c, i) => {
    if (usedSources.has(i)) return;
    order.push(i);
    if (c.pixelEnd > c.pixelStart) unplacedWhole++;
  });
  if (unplacedPieces > 0) {
    warnings.push(
      `${unplacedPieces} part${unplacedPieces === 1 ? '' : 's'} of sequences the AGP places only partly ` +
      `${unplacedPieces === 1 ? 'was' : 'were'} kept and put at the end.`);
  }
  if (unplacedWhole > 0) {
    warnings.push(
      `${unplacedWhole} sequence${unplacedWhole === 1 ? '' : 's'} on the map ${unplacedWhole === 1 ? 'is' : 'are'} ` +
      'not in the AGP and were put at the end.');
  }
  if (badTags.size > 0) {
    warnings.push(`These words in the tag columns are not usable as tags and were ignored: ${sample([...badTags])}.`);
  }
  if (noTexels.length > 0 && parsed.hasExtraColumns === false) {
    // Only worth saying for files that list them; PretextView's own leave them out.
    warnings.push(`${new Set(noTexels).size} sequence(s) in the AGP are too small to appear on this map.`);
  }

  return {
    contigs,
    contigOrder: order,
    scaffolds,
    tags: [...tags.entries()],
    warnings,
    stats: { rows: pieces.length, cuts, scaffolds: scaffolds.length, tagged: tags.size },
  };
}
