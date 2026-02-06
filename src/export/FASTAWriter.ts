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

import type { AppState } from '../core/State';

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
  const contigOrder = appState.contigOrder;

  if (contigOrder.length === 0) {
    throw new Error('Cannot export FASTA: contig order is empty');
  }

  const parts: string[] = [];

  for (const idx of contigOrder) {
    const contig = contigs[idx];
    if (!contig) continue;

    const rawSequence = sequences.get(contig.name);
    if (rawSequence === undefined) {
      // Emit a comment-style header indicating the missing sequence
      parts.push(`>${contig.name} WARNING:sequence_not_found`);
      continue;
    }

    const orientation = contig.inverted ? '-' : '+';
    const sequence = contig.inverted
      ? reverseComplement(rawSequence)
      : rawSequence;

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
