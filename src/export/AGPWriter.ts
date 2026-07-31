/**
 * AGP (A Golden Path) file writer.
 *
 * Exports the current assembly state as an AGP 2.1 file.
 * The AGP format is a tab-separated specification defined by NCBI:
 *   https://www.ncbi.nlm.nih.gov/assembly/agp/AGP_Specification/
 *
 * Columns:
 *   1. object          - scaffold/chromosome name
 *   2. object_beg      - start position in the object (1-based)
 *   3. object_end      - end position in the object (1-based, inclusive)
 *   4. part_number     - sequential part number within the object
 *   5. component_type  - 'W' for WGS contig, 'N' for gap
 *   6. component_id (contigs) / gap_length (gaps)
 *   7. component_beg (contigs) / gap_type (gaps)
 *   8. component_end (contigs) / linkage (gaps)
 *   9. orientation (contigs) / linkage_evidence (gaps)
 *
 * Several columns carry defaults rather than measurements, object names are
 * positional, and the orientation column cannot be applied to cut/join-derived
 * components. `docs/AGP_EXPORT.md` states all of this for downstream users;
 * keep it in step with any change here.
 */

import type { AppState, ContigInfo } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';

/** Configuration for AGP export. */
export interface AGPExportOptions {
  /** Gap size written between contigs within a scaffold (bp). Defaults to 200.
   *  This is a placeholder, not an estimate: a contact map carries no evidence
   *  of the distance between two contigs. 0 suppresses gap rows entirely. */
  gapSize?: number;
  /** Gap type for intra-scaffold gaps. Defaults to 'scaffold' for every gap;
   *  meta-tags such as centromere/telomere do not influence it. */
  gapType?: string;
  /** Linkage evidence type. Defaults to 'proximity_ligation' (Hi-C). */
  linkageEvidence?: string;
  /** Whether to include the AGP version comment header. Defaults to true. */
  includeHeader?: boolean;
  /** Timestamp to stamp in the header, or null to omit it. Defaults to now.
   *  Omitting it makes the export a pure function of the curation, so the same
   *  script run twice produces byte-identical AGP. */
  timestamp?: string | null;
}

const DEFAULT_OPTIONS: Required<AGPExportOptions> = {
  gapSize: 200,
  gapType: 'scaffold',
  linkageEvidence: 'proximity_ligation',
  includeHeader: true,
  timestamp: null,
};

/**
 * Represents a single component line in the AGP file (either contig or gap).
 */
export interface AGPLine {
  object: string;
  objectBeg: number;
  objectEnd: number;
  partNumber: number;
  componentType: 'W' | 'N';
  // For W (contig) lines
  componentId?: string;
  componentBeg?: number;
  componentEnd?: number;
  orientation?: '+' | '-';
  // For N (gap) lines
  gapLength?: number;
  gapType?: string;
  linkage?: 'yes' | 'no';
  linkageEvidence?: string;
}

/**
 * Groups contigs by scaffold ID. Contigs without a scaffoldId are each
 * placed into their own single-contig scaffold group.
 *
 * Object names are NOT the names a curator sees:
 * - A scaffolded contig's object is `scaffold_<numeric ScaffoldManager id>`.
 *   The curator-facing name ("Chr1", or anything set via renameScaffold) is not
 *   used, and ids keep climbing across resetScaffolds, so re-running
 *   auto-assign renumbers every object.
 * - An unscaffolded contig's object is `unplaced_<n>`, a counter over the
 *   included order. It is positional: reordering or excluding a contig renames
 *   the unplaced objects after it. Column 6 (the contig name) is the only
 *   stable key.
 *
 * Grouping is by id, not adjacency: contigs sharing a scaffoldId but separated
 * in the display order still form one object with continuous coordinates.
 */
export function groupContigsByScaffold(
  contigs: ContigInfo[],
  contigOrder: number[]
): Map<string, ContigInfo[]> {
  const scaffolds = new Map<string, ContigInfo[]>();
  let unscaffoldedCounter = 0;

  for (const idx of contigOrder) {
    const contig = contigs[idx];
    if (!contig) continue;

    let scaffoldName: string;
    if (contig.scaffoldId !== null && contig.scaffoldId !== undefined) {
      scaffoldName = `scaffold_${contig.scaffoldId}`;
    } else {
      // Each unscaffolded contig becomes its own object
      scaffoldName = `unplaced_${unscaffoldedCounter++}`;
    }

    if (!scaffolds.has(scaffoldName)) {
      scaffolds.set(scaffoldName, []);
    }
    scaffolds.get(scaffoldName)!.push(contig);
  }

  return scaffolds;
}

/**
 * Builds AGP lines for a single scaffold (a group of contigs).
 */
export function buildScaffoldAGPLines(
  scaffoldName: string,
  contigs: ContigInfo[],
  options: Required<AGPExportOptions>
): AGPLine[] {
  const lines: AGPLine[] = [];
  let objectPos = 1; // 1-based position within the scaffold object
  let partNumber = 1;

  for (let i = 0; i < contigs.length; i++) {
    const contig = contigs[i];

    // Insert gap before this contig (except before the first one).
    // The gap length, type, and linkage flag are fixed defaults asserted about
    // the assembly, not anything derived from the contact map. Only the
    // linkage evidence (proximity_ligation) reflects the actual data.
    if (i > 0 && options.gapSize > 0) {
      const gapEnd = objectPos + options.gapSize - 1;
      lines.push({
        object: scaffoldName,
        objectBeg: objectPos,
        objectEnd: gapEnd,
        partNumber,
        componentType: 'N',
        gapLength: options.gapSize,
        gapType: options.gapType,
        linkage: 'yes',
        linkageEvidence: options.linkageEvidence,
      });
      objectPos = gapEnd + 1;
      partNumber++;
    }

    // Contig component line.
    // componentBeg/componentEnd are always 1..length: a fragment produced by a
    // cut is described as a whole component under a synthesized name
    // (`<name>_L`/`<name>_R`, or `<a>+<b>` for a join), not as an interval of
    // its parent, so the cut point is not recorded here. componentType is
    // always 'W', which asserts the component is gap-free even when the input
    // "contig" is really a scaffold with internal N-runs.
    //
    // The orientation column is relative to the INPUT contig sequence, so it
    // must not be re-applied on top of OpenPretext's own FASTA export, which
    // writes each record already reverse-complemented. Joins break it outright:
    // a join of contigs with DIFFERING orientation collapses to '+' here (see
    // CurationEngine.join), and a join of two INVERTED contigs writes '-', which
    // would reverse the order of the two halves, while the join does not. One
    // strand flag cannot describe a two-part component; the FASTA stays correct
    // via sequenceSegments.
    const contigLength = contig.length;
    const contigEnd = objectPos + contigLength - 1;

    lines.push({
      object: scaffoldName,
      objectBeg: objectPos,
      objectEnd: contigEnd,
      partNumber,
      componentType: 'W',
      componentId: contig.name,
      componentBeg: 1,
      componentEnd: contigLength,
      orientation: contig.inverted ? '-' : '+',
    });

    objectPos = contigEnd + 1;
    partNumber++;
  }

  return lines;
}

/**
 * Formats an AGPLine into a tab-separated string.
 */
export function formatAGPLine(line: AGPLine): string {
  if (line.componentType === 'W') {
    return [
      line.object,
      line.objectBeg,
      line.objectEnd,
      line.partNumber,
      line.componentType,
      line.componentId,
      line.componentBeg,
      line.componentEnd,
      line.orientation,
    ].join('\t');
  } else {
    // Gap line (N type)
    return [
      line.object,
      line.objectBeg,
      line.objectEnd,
      line.partNumber,
      line.componentType,
      line.gapLength,
      line.gapType,
      line.linkage,
      line.linkageEvidence,
    ].join('\t');
  }
}

/**
 * Generates the complete AGP header comment block.
 *
 * The version line separates `##agp-version` from `2.1` with a tab where NCBI's
 * specification writes a space. PretextView does the same (checked against
 * bCotChi1.combined.pretext.20240422.agp, a released Sanger curation), so this
 * matches what consumers of curation AGPs actually receive. Parsers that treat
 * `#` lines as comments are unaffected either way.
 *
 * @param timestamp - ISO string to stamp, or null to omit the line entirely.
 *   Defaults to now. Passing null makes the output a pure function of the
 *   curation, which is what lets two runs of the same script be compared
 *   byte for byte.
 */
export function generateAGPHeader(timestamp: string | null = new Date().toISOString()): string {
  const lines = ['##agp-version\t2.1'];
  if (timestamp !== null) {
    lines.push(`# Generated by OpenPretext on ${timestamp}`);
  }
  lines.push('# Curation performed using Hi-C contact map data');
  return lines.join('\n');
}

/**
 * Export the current assembly state as an AGP format string.
 *
 * Order, orientation, and scaffold grouping survive a round-trip through
 * `AGPParser`; scaffold object names, cuts, joins, and exclusions do not (see
 * `docs/AGP_EXPORT.md`). Use a session file to reproduce a full curation.
 *
 * @param appState - The current application state
 * @param options  - Export configuration options
 * @returns The full AGP file content as a string
 */
export function exportAGP(
  appState: AppState,
  options: AGPExportOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!appState.map || appState.map.contigs.length === 0) {
    throw new Error('Cannot export AGP: no map data loaded');
  }

  const contigs = appState.map.contigs;
  // Excluded contigs are dropped before grouping: they produce no row, and the
  // file carries no trace of them. Object coordinates close up around a removed
  // member (later parts renumber and shift down, one gap row disappears), so
  // coordinates are only comparable between exports with the same exclusion set.
  const contigOrder = contigExclusion.getIncludedOrder(appState.contigOrder);

  if (contigOrder.length === 0) {
    throw new Error('Cannot export AGP: contig order is empty');
  }

  // Group contigs into scaffolds
  const scaffolds = groupContigsByScaffold(contigs, contigOrder);

  // Build all AGP lines
  const allLines: AGPLine[] = [];
  for (const [scaffoldName, scaffoldContigs] of scaffolds) {
    const lines = buildScaffoldAGPLines(scaffoldName, scaffoldContigs, opts);
    allLines.push(...lines);
  }

  // Assemble the output
  const parts: string[] = [];

  if (opts.includeHeader) {
    parts.push(generateAGPHeader(opts.timestamp));
  }

  for (const line of allLines) {
    parts.push(formatAGPLine(line));
  }

  return parts.join('\n') + '\n';
}

/**
 * Trigger a browser download of the AGP file.
 */
export function downloadAGP(
  appState: AppState,
  filename?: string,
  options?: AGPExportOptions
): void {
  const content = exportAGP(appState, options);
  const defaultFilename = appState.map?.filename
    ? appState.map.filename.replace(/\.pretext$/i, '.agp')
    : 'assembly.agp';

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
