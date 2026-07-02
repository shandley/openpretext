/**
 * FASTA file writer.
 *
 * Exports the curated assembly as a FASTA file. Requires the application
 * state (for contig order and orientation) plus a map of contig names
 * to their nucleotide sequences.
 *
 * Features:
 * - Iterates contigs in the curated order
 * - Reverse-complements sequences for inverted contigs
 * - Wraps sequence lines at a configurable width (default 80)
 * - Skips contigs whose sequence is not in the provided map
 */

import type { AppState, ContigInfo } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';

/** Configuration for FASTA export. */
export interface FASTAExportOptions {
  /** Characters per sequence line. Defaults to 80. */
  lineWidth?: number;
}

const DEFAULT_OPTIONS: Required<FASTAExportOptions> = {
  lineWidth: 80,
};

/** Complement mapping for nucleotide bases. */
const COMPLEMENT: Record<string, string> = {
  A: 'T',
  T: 'A',
  C: 'G',
  G: 'C',
  a: 't',
  t: 'a',
  c: 'g',
  g: 'c',
  // IUPAC ambiguity codes
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
  r: 'y',
  y: 'r',
  s: 's',
  w: 'w',
  k: 'm',
  m: 'k',
  b: 'v',
  v: 'b',
  d: 'h',
  h: 'd',
  n: 'n',
};

/**
 * Reverse-complement a nucleotide sequence.
 */
export function reverseComplement(sequence: string): string {
  const result: string[] = new Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) {
    const base = sequence[sequence.length - 1 - i];
    result[i] = COMPLEMENT[base] ?? base;
  }
  return result.join('');
}

/**
 * Wrap a sequence string into lines of the given width.
 */
export function wrapSequence(sequence: string, lineWidth: number): string {
  const lines: string[] = [];
  for (let i = 0; i < sequence.length; i += lineWidth) {
    lines.push(sequence.substring(i, i + lineWidth));
  }
  return lines.join('\n');
}

/**
 * Resolve the exported nucleotide sequence for a single contig.
 *
 * Contigs produced by cut/join carry `sequenceSegments` describing how to
 * rebuild their sequence from the originally-loaded (source) contigs; those
 * segments are self-contained (each encodes its own orientation), so the
 * contig-level `inverted` flag is not re-applied on top of them. Contigs
 * loaded directly from a .pretext file have no segments and are looked up by
 * name, then reverse-complemented if `inverted`.
 *
 * @returns the sequence string, or `undefined` if any required source
 *   sequence is missing from the map.
 */
export function resolveContigSequence(
  contig: ContigInfo,
  sequences: Map<string, string>
): string | undefined {
  const segments = contig.sequenceSegments;
  if (segments && segments.length > 0) {
    const parts: string[] = [];
    for (const seg of segments) {
      const src = sequences.get(seg.sourceName);
      if (src === undefined) return undefined;
      const slice = src.substring(seg.start, seg.end);
      parts.push(seg.revComp ? reverseComplement(slice) : slice);
    }
    return parts.join('');
  }

  const raw = sequences.get(contig.name);
  if (raw === undefined) return undefined;
  return contig.inverted ? reverseComplement(raw) : raw;
}

/**
 * Export the curated assembly as a FASTA format string.
 *
 * @param appState  - The current application state
 * @param sequences - Map of contig name to nucleotide sequence
 * @param options   - Export configuration options
 * @returns The full FASTA file content as a string
 */
export function exportFASTA(
  appState: AppState,
  sequences: Map<string, string>,
  options: FASTAExportOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!appState.map || appState.map.contigs.length === 0) {
    throw new Error('Cannot export FASTA: no map data loaded');
  }

  const contigs = appState.map.contigs;
  const contigOrder = contigExclusion.getIncludedOrder(appState.contigOrder);

  if (contigOrder.length === 0) {
    throw new Error('Cannot export FASTA: contig order is empty');
  }

  const parts: string[] = [];

  for (const idx of contigOrder) {
    const contig = contigs[idx];
    if (!contig) continue;

    const sequence = resolveContigSequence(contig, sequences);
    if (sequence === undefined) {
      // Emit a comment-style header indicating the missing sequence
      parts.push(`>${contig.name} WARNING:sequence_not_found`);
      continue;
    }

    const orientation = contig.inverted ? '-' : '+';
    parts.push(`>${contig.name} orientation=${orientation}`);
    parts.push(wrapSequence(sequence, opts.lineWidth));
  }

  return parts.join('\n') + '\n';
}

/**
 * Trigger a browser download of the FASTA file.
 */
export function downloadFASTA(
  appState: AppState,
  sequences: Map<string, string>,
  filename?: string,
  options?: FASTAExportOptions
): void {
  const content = exportFASTA(appState, sequences, options);
  const defaultFilename = appState.map?.filename
    ? appState.map.filename.replace(/\.pretext$/i, '.fasta')
    : 'assembly.fasta';

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
