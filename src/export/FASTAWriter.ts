/**
 * FASTA file writer.
 *
 * Exports the curated assembly as a FASTA file. Requires the application
 * state (for contig order and orientation) plus a map of contig names
 * to their nucleotide sequences.
 *
 * Features:
 * - Iterates contigs in the curated order
 * - Cuts and reverse-complements the input sequences exactly as the AGP
 *   export describes them, so the two files agree
 * - Wraps sequence lines at a configurable width (default 80)
 * - Marks contigs whose input sequence is not in the provided map
 */

import type { AppState, ContigInfo, MapData } from '../core/State';
import { buildAGPObjects, fileContigsOf, type AGPFragment } from './AGPModel';
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
 * Which stretches of which input sequences make up each curated contig.
 *
 * These are the rows the AGP export writes (AGPModel.ts), so the FASTA and
 * the AGP always describe the same cuts: a cut is at a texel boundary, at the
 * base pair PretextView's arithmetic gives for it.
 */
function fragmentsByContig(map: MapData, order: number[]): Map<number, AGPFragment[]> {
  const out = new Map<number, AGPFragment[]>();
  for (const o of buildAGPObjects(map, order)) {
    for (const f of o.fragments) {
      if (!out.has(f.contigId)) out.set(f.contigId, []);
      out.get(f.contigId)!.push(f);
    }
  }
  return out;
}

/**
 * The nucleotide sequence of one curated contig.
 *
 * Each fragment is cut out of its input sequence at the AGP's coordinates,
 * with two corrections that need the real sequence. The coordinates come from
 * texels, so the last texel boundary of a sequence is only near its true end:
 * the fragment that reaches the sequence's last texel runs to the real end,
 * and no fragment runs past it. Nothing is lost or repeated: the fragments of
 * a sequence tile it exactly.
 *
 * A contig that owns no texel has no fragments. It is the whole of its input
 * sequence, turned round if the curator inverted it.
 *
 * @returns the sequence, or `undefined` if a needed input sequence is missing.
 */
export function resolveContigSequence(
  contig: ContigInfo,
  sequences: Map<string, string>,
  fragments: AGPFragment[] | undefined,
  map: MapData,
): string | undefined {
  if (!fragments || fragments.length === 0) {
    const raw = sequences.get(contig.name);
    if (raw === undefined) return undefined;
    return contig.inverted ? reverseComplement(raw) : raw;
  }
  const files = fileContigsOf(map);
  const parts: string[] = [];
  for (const f of fragments) {
    const src = sequences.get(f.component);
    if (src === undefined) return undefined;
    const source = files[f.sourceIndex];
    const reachesEnd = f.texelStart + f.texels === source.pixelEnd - source.pixelStart;
    const start = Math.min(src.length, f.beg - 1);
    const end = reachesEnd ? src.length : Math.min(src.length, f.end);
    const slice = src.substring(start, end);
    parts.push(f.reversed ? reverseComplement(slice) : slice);
  }
  return parts.join('');
}

/**
 * Export the curated assembly as a FASTA format string: one record per
 * curated contig, in curated order, excluded contigs left out.
 *
 * @param appState  - The current application state
 * @param sequences - Map of input sequence name to nucleotide sequence
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

  const map = appState.map;
  const contigs = map.contigs;
  const contigOrder = contigExclusion.getIncludedOrder(appState.contigOrder);

  if (contigOrder.length === 0) {
    throw new Error('Cannot export FASTA: contig order is empty');
  }

  // Fragments are worked out over the whole order, so that a piece next to an
  // excluded one is still cut where the map says.
  const fragments = fragmentsByContig(map, appState.contigOrder);
  const parts: string[] = [];

  for (const idx of contigOrder) {
    const contig = contigs[idx];
    if (!contig) continue;

    const sequence = resolveContigSequence(contig, sequences, fragments.get(idx), map);
    if (sequence === undefined) {
      // Emit a comment-style header indicating the missing sequence
      parts.push(`>${contig.name} WARNING:sequence_not_found`);
      continue;
    }

    const orientation = contig.inverted ? '-' : '+';
    parts.push(`>${contig.name} orientation=${orientation}`);
    parts.push(wrapSequence(sequence, opts.lineWidth));
  }

  // A sequence too small to own a texel has no place on the map. If it was
  // joined into another contig it is no longer in the order, and that contig's
  // record is built from texels, so it would be left out. It is written here,
  // whole, as the AGP pipeline also ends up with it (the AGP cannot mention
  // it, and the next tool adds back what the AGP does not mention). It is left
  // out only if the contig it was joined into is excluded.
  const placed = new Set(appState.contigOrder);
  const included = new Set(contigOrder);
  fileContigsOf(map).forEach((file, id) => {
    if (file.pixelEnd > file.pixelStart || placed.has(id)) return;
    const holder = appState.contigOrder.find(
      (c) => contigs[c]?.sequenceSegments?.some((q) => q.sourceName === file.name));
    if (holder !== undefined && !included.has(holder)) return;
    const raw = sequences.get(file.name);
    if (raw === undefined) {
      parts.push(`>${file.name} WARNING:sequence_not_found`);
      return;
    }
    parts.push(`>${file.name} orientation=+`);
    parts.push(wrapSequence(raw, opts.lineWidth));
  });

  return parts.join('\n') + '\n';
}

/** Names of curated contigs whose input sequence is not among `sequences`. */
export function contigsMissingSequence(appState: AppState, sequences: Map<string, string>): string[] {
  const map = appState.map;
  if (!map) return [];
  const fragments = fragmentsByContig(map, appState.contigOrder);
  return contigExclusion.getIncludedOrder(appState.contigOrder)
    .filter((id) => map.contigs[id] && resolveContigSequence(map.contigs[id], sequences, fragments.get(id), map) === undefined)
    .map((id) => map.contigs[id].name);
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
