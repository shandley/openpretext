/**
 * BED (Browser Extensible Data) file writer.
 *
 * Exports the current assembly state as a BED6 file showing contig
 * coordinates in the curated assembly. Each contig is represented as
 * an interval within its assigned scaffold, with strand reflecting
 * inversion state.
 *
 * Format (BED6 tab-separated):
 *   1. chrom      - scaffold name
 *   2. chromStart - 0-based start position in the scaffold
 *   3. chromEnd   - end position in the scaffold
 *   4. name       - contig name
 *   5. score      - 0
 *   6. strand     - '+' or '-' based on inversion
 */

import type { AppState, ContigInfo } from '../core/State';
import { groupContigsByScaffold } from './AGPWriter';

/** Configuration for BED export. */
export interface BEDExportOptions {
  /** Default gap size between contigs within a scaffold (bp). Defaults to 200. */
  gapSize?: number;
  /** Whether to include the header line. Defaults to true. */
  includeHeader?: boolean;
}

const DEFAULT_OPTIONS: Required<BEDExportOptions> = {
  gapSize: 200,
  includeHeader: true,
};

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
 * Builds BED lines for a single scaffold (a group of contigs).
 */
export function buildScaffoldBEDLines(
  scaffoldName: string,
  contigs: ContigInfo[],
  gapSize: number
): BEDLine[] {
  const lines: BEDLine[] = [];
  let position = 0; // 0-based coordinate within the scaffold

  for (let i = 0; i < contigs.length; i++) {
    const contig = contigs[i];

    // Insert gap before this contig (except before the first one)
    if (i > 0 && gapSize > 0) {
      position += gapSize;
    }

    const chromStart = position;
    const chromEnd = position + contig.length;

    lines.push({
      chrom: scaffoldName,
      chromStart,
      chromEnd,
      name: contig.name,
      score: 0,
      strand: contig.inverted ? '-' : '+',
    });

    position = chromEnd;
  }

  return lines;
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
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!appState.map || appState.map.contigs.length === 0) {
    throw new Error('Cannot export BED: no map data loaded');
  }

  const contigs = appState.map.contigs;
  const contigOrder = appState.contigOrder;

  if (contigOrder.length === 0) {
    throw new Error('Cannot export BED: contig order is empty');
  }

  // Group contigs into scaffolds (reuse AGPWriter logic)
  const scaffolds = groupContigsByScaffold(contigs, contigOrder);

  // Build all BED lines
  const allLines: BEDLine[] = [];
  for (const [scaffoldName, scaffoldContigs] of scaffolds) {
    const lines = buildScaffoldBEDLines(scaffoldName, scaffoldContigs, opts.gapSize);
    allLines.push(...lines);
  }

  // Assemble the output
  const parts: string[] = [];

  if (opts.includeHeader) {
    parts.push('#chrom\tchromStart\tchromEnd\tname\tscore\tstrand');
  }

  for (const line of allLines) {
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
