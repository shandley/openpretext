/**
 * BED (Browser Extensible Data) file writer.
 *
 * Writes where each piece of the input assembly sits in the curated one, as
 * BED6. It is the same layout as the standard AGP export (same objects, same
 * coordinates, same gaps, excluded contigs left out), in a form genome
 * browsers and interval tools read. No curation pipeline consumes it; the AGP
 * is the file to hand on.
 *
 * Format (BED6, tab-separated):
 *   1. chrom      - object name, as in the AGP (`Scaffold_<n>`)
 *   2. chromStart - 0-based start in the object
 *   3. chromEnd   - end in the object (exclusive)
 *   4. name       - original sequence and the interval of it placed here,
 *                   `name:beg-end` (1-based, inclusive, as in the AGP)
 *   5. score      - 0
 *   6. strand     - '+' or '-'
 */

import type { AppState } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';
import { buildAGPObjects } from './AGPModel';
import { buildAGPRows } from './AGPWriter';

/** Configuration for BED export. */
export interface BEDExportOptions {
  /** Whether to include the header line. Defaults to true. */
  includeHeader?: boolean;
}

/**
 * Represents a single BED6 line.
 */
export interface BEDLine {
  chrom: string;
  chromStart: number;
  chromEnd: number;
  name: string;
  score: number;
  strand: '+' | '-';
}

/**
 * Formats a BEDLine into a tab-separated string.
 */
export function formatBEDLine(line: BEDLine): string {
  return [
    line.chrom,
    line.chromStart,
    line.chromEnd,
    line.name,
    line.score,
    line.strand,
  ].join('\t');
}

/** The BED lines for the current curation: one per sequence row of the standard AGP. */
export function buildBEDLines(appState: AppState): BEDLine[] {
  const map = appState.map!;
  const order = contigExclusion.getIncludedOrder(appState.contigOrder);
  const rows = buildAGPRows(buildAGPObjects(map, order), { tagsOf: () => [] }, 'standard');
  const lines: BEDLine[] = [];
  for (const row of rows) {
    if (row.type !== 'W') continue;
    lines.push({
      chrom: row.object,
      chromStart: row.objectBeg - 1,
      chromEnd: row.objectEnd,
      name: `${row.component}:${row.componentBeg}-${row.componentEnd}`,
      score: 0,
      strand: row.orientation!,
    });
  }
  return lines;
}

/**
 * Export the current assembly state as a BED format string.
 *
 * @param appState - The current application state
 * @param options  - Export configuration options
 * @returns The full BED file content as a string
 */
export function exportBED(
  appState: AppState,
  options: BEDExportOptions = {}
): string {
  const includeHeader = options.includeHeader ?? true;

  if (!appState.map || appState.map.contigs.length === 0) {
    throw new Error('Cannot export BED: no map data loaded');
  }
  if (contigExclusion.getIncludedOrder(appState.contigOrder).length === 0) {
    throw new Error('Cannot export BED: contig order is empty');
  }

  const parts: string[] = [];
  if (includeHeader) {
    parts.push('#chrom\tchromStart\tchromEnd\tname\tscore\tstrand');
  }
  for (const line of buildBEDLines(appState)) {
    parts.push(formatBEDLine(line));
  }
  return parts.join('\n') + '\n';
}

/**
 * Trigger a browser download of the BED file.
 */
export function downloadBED(
  appState: AppState,
  filename?: string,
  options?: BEDExportOptions
): void {
  const content = exportBED(appState, options);
  const defaultFilename = appState.map?.filename
    ? appState.map.filename.replace(/\.pretext$/i, '.bed')
    : 'assembly.bed';

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
