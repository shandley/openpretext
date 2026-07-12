/**
 * AGP (A Golden Path) file parser.
 *
 * The inverse of `src/export/AGPWriter.ts`. Reads an AGP 2.1 file and recovers
 * the contig order, orientation, and scaffold grouping so a curator can resume
 * from a prior curation.
 *
 * This module is pure: it has no DOM or app-state dependencies. `parseAGP`
 * extracts the component (`W`) rows; `deriveAGPPlan` turns those rows plus the
 * currently-loaded assembly into a concrete apply plan (new order, inversions,
 * scaffold groups) without dropping any loaded contig.
 *
 * AGP component (W) columns, tab-separated:
 *   0 object      1 objectBeg  2 objectEnd  3 partNumber  4 componentType (W)
 *   5 componentId 6 componentBeg 7 componentEnd 8 orientation (+/-)
 *
 * Here `componentId` is the contig NAME (the join key) and `object` is the
 * scaffold name. Gap (`N`) lines are ignored: they only separate contigs
 * within a scaffold. AGPWriter names scaffolded objects `scaffold_<id>` and
 * each unscaffolded contig its own object `unplaced_<n>`.
 */

/** A single component (W) row recovered from an AGP file, in file order. */
export interface AGPImportRow {
  /** The contig name (AGP componentId), used to match loaded contigs. */
  contigName: string;
  /** True when the orientation column is '-'. */
  inverted: boolean;
  /** The AGP object name (scaffold name). */
  objectName: string;
  /** True when the object is an `unplaced_*` singleton (not a scaffold). */
  isUnplaced: boolean;
}

/** Parsed AGP content: component rows in file order. */
export interface ParsedAGP {
  rows: AGPImportRow[];
}

/**
 * Parse AGP text into component rows. Skips comment (`#`) and blank lines,
 * keeps only well-formed `W` lines, and tolerates malformed lines by skipping
 * them (never throws).
 */
export function parseAGP(text: string): ParsedAGP {
  const rows: AGPImportRow[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const cols = line.split('\t');
    // A W line needs all 9 columns (orientation is column index 8).
    if (cols.length < 9) continue;
    if (cols[4] !== 'W') continue;

    const objectName = cols[0];
    const contigName = cols[5];
    if (!objectName || !contigName) continue;

    rows.push({
      contigName,
      inverted: cols[8] === '-',
      objectName,
      isUnplaced: objectName.startsWith('unplaced_'),
    });
  }

  return { rows };
}

/** A scaffold group derived from an AGP plan, as positions in the new order. */
export interface AGPScaffoldGroup {
  /** Scaffold name (the AGP object name). */
  name: string;
  /** Order-indices (positions in the new contig order) of member contigs. */
  orderIndices: number[];
}

/** A concrete plan for applying an AGP import onto the loaded assembly. */
export interface AGPPlan {
  /** New contig order: matched contigs in AGP order, then loaded-but-unmatched. */
  newOrder: number[];
  /** Inversion state for each matched contig (by contig id). */
  inversions: Array<{ id: number; inverted: boolean }>;
  /** Scaffold groups for non-unplaced objects (unplaced singletons excluded). */
  scaffoldGroups: AGPScaffoldGroup[];
  /** AGP contig names that did not match any loaded contig. */
  unmatchedNames: string[];
  /** Number of AGP rows that matched a loaded contig. */
  matchedCount: number;
}

/**
 * Build a concrete apply plan from parsed AGP rows, a name -> contig id map,
 * and the current contig order.
 *
 * Invariants:
 * - `newOrder` never drops a loaded contig: matched contigs come first in AGP
 *   order, then any loaded contig not present in the AGP is appended at the tail.
 * - A contig name appearing twice in the AGP is matched only once (the first
 *   occurrence) so the order length and scaffold indices stay consistent.
 * - Scaffold groups reference positions in the FINAL `newOrder`.
 */
export function deriveAGPPlan(
  parsed: ParsedAGP,
  nameToId: Map<string, number>,
  currentOrder: number[],
): AGPPlan {
  const newOrder: number[] = [];
  const inversions: Array<{ id: number; inverted: boolean }> = [];
  const unmatchedNames: string[] = [];
  const seen = new Set<number>();
  let matchedCount = 0;

  // First pass: resolve rows, build the matched prefix of the new order.
  // Track, per row, the resolved contig id (or null) so grouping can reuse it.
  const rowIds: Array<number | null> = [];
  for (const row of parsed.rows) {
    const id = nameToId.get(row.contigName);
    if (id === undefined) {
      unmatchedNames.push(row.contigName);
      rowIds.push(null);
      continue;
    }
    matchedCount++;
    if (seen.has(id)) {
      // Duplicate componentId: keep the first, ignore the rest.
      rowIds.push(null);
      continue;
    }
    seen.add(id);
    newOrder.push(id);
    inversions.push({ id, inverted: row.inverted });
    rowIds.push(id);
  }

  // Append loaded contigs absent from the AGP at the tail (never drop them).
  for (const id of currentOrder) {
    if (!seen.has(id)) {
      seen.add(id);
      newOrder.push(id);
    }
  }

  // Map every contig id to its position in the FINAL new order.
  const idToOrderIndex = new Map<number, number>();
  for (let i = 0; i < newOrder.length; i++) {
    idToOrderIndex.set(newOrder[i], i);
  }

  // Group non-unplaced objects into scaffolds, preserving first-seen object
  // order and intra-object row order. Uses the resolved id from the first pass.
  const groupOrder: string[] = [];
  const groupIndices = new Map<string, number[]>();
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const id = rowIds[i];
    if (id === null || row.isUnplaced) continue;
    const orderIndex = idToOrderIndex.get(id);
    if (orderIndex === undefined) continue;
    if (!groupIndices.has(row.objectName)) {
      groupIndices.set(row.objectName, []);
      groupOrder.push(row.objectName);
    }
    groupIndices.get(row.objectName)!.push(orderIndex);
  }

  const scaffoldGroups: AGPScaffoldGroup[] = groupOrder.map((name) => ({
    name,
    orderIndices: groupIndices.get(name)!,
  }));

  return { newOrder, inversions, scaffoldGroups, unmatchedNames, matchedCount };
}
