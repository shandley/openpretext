/**
 * BedGraph format parser and TrackConfig converter.
 *
 * Parses standard bedGraph text files (tab-separated with optional header
 * lines) and converts the resulting entries into a TrackConfig suitable
 * for the TrackRenderer overlay.
 *
 * BedGraph format reference:
 *   - Header lines start with "track", "browser", or "#"
 *   - Data lines: chrom  chromStart  chromEnd  value
 *   - Coordinates are 0-based, half-open (start inclusive, end exclusive)
 */

import type { TrackConfig, TrackType } from '../renderer/TrackRenderer';
import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BedGraphEntry {
  chrom: string;
  start: number;   // 0-based
  end: number;      // exclusive
  value: number;
}

export interface BedGraphParseResult {
  entries: BedGraphEntry[];
  trackName: string | null;   // extracted from the "track" header line
  chroms: string[];           // unique chromosome names in encounter order
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse bedGraph text into structured entries.
 *
 * Skips blank lines, comment lines (#), browser lines, and the track
 * definition line. If a track line is present, the `name=` attribute is
 * extracted as `trackName`.
 */
export function parseBedGraph(text: string): BedGraphParseResult {
  const entries: BedGraphEntry[] = [];
  let trackName: string | null = null;
  const chromSet = new Set<string>();
  const chroms: string[] = [];

  // Normalise line endings and split
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines
    if (line.length === 0) continue;

    // Skip comment lines
    if (line.startsWith('#')) continue;

    // Skip browser lines
    if (line.startsWith('browser')) continue;

    // Handle track definition line
    if (line.startsWith('track')) {
      trackName = extractTrackName(line);
      continue;
    }

    // Parse data line
    const fields = line.split('\t');
    if (fields.length < 4) continue;

    const chrom = fields[0];
    const start = parseInt(fields[1], 10);
    const end = parseInt(fields[2], 10);
    const value = parseFloat(fields[3]);

    if (isNaN(start) || isNaN(end) || isNaN(value)) continue;

    entries.push({ chrom, start, end, value });

    if (!chromSet.has(chrom)) {
      chromSet.add(chrom);
      chroms.push(chrom);
    }
  }

  return { entries, trackName, chroms };
}

// ---------------------------------------------------------------------------
// Conversion to TrackConfig
// ---------------------------------------------------------------------------

/**
 * Convert a parsed bedGraph result into a TrackConfig compatible with
 * the TrackRenderer.
 *
 * For each entry the genomic coordinate range is mapped to pixel positions
 * using the contig metadata. Values are min-max normalised to [0, 1].
 *
 * @param result      - Output of {@link parseBedGraph}
 * @param contigs     - ContigInfo array from the loaded map state
 * @param contigOrder - Current display ordering (indices into `contigs`)
 * @param textureSize - Total 1D pixel dimension of the contact map
 * @param options     - Optional overrides for track appearance
 */
export function bedGraphToTrack(
  result: BedGraphParseResult,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  options?: {
    name?: string;
    type?: TrackType;
    color?: string;
    height?: number;
  },
): TrackConfig {
  const data = new Float32Array(textureSize);

  // Build a lookup from contig name to its current pixel span.
  // We honour contigOrder so that positions reflect the curated arrangement.
  const contigLookup = new Map<
    string,
    { pixelStart: number; pixelEnd: number; length: number }
  >();

  for (const idx of contigOrder) {
    const c = contigs[idx];
    if (!c) continue;
    contigLookup.set(c.name, {
      pixelStart: c.pixelStart,
      pixelEnd: c.pixelEnd,
      length: c.length,
    });
  }

  // Determine the global value range for normalisation.
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const entry of result.entries) {
    if (entry.value < minVal) minVal = entry.value;
    if (entry.value > maxVal) maxVal = entry.value;
  }
  const range = maxVal - minVal;

  // Map each entry onto the pixel array.
  for (const entry of result.entries) {
    const info = contigLookup.get(entry.chrom);
    if (!info) continue; // unknown chromosome — silently skip

    const contigPixelSpan = info.pixelEnd - info.pixelStart;
    const bpPerPixel = info.length / contigPixelSpan;

    // Convert genomic coordinates to pixel offsets within the contig.
    const pxStart = Math.floor(entry.start / bpPerPixel) + info.pixelStart;
    const pxEnd = Math.ceil(entry.end / bpPerPixel) + info.pixelStart;

    const normValue = range === 0 ? 0.5 : (entry.value - minVal) / range;

    // Fill the corresponding pixel range, clamping to valid bounds.
    const lo = Math.max(0, pxStart);
    const hi = Math.min(textureSize, pxEnd);
    for (let p = lo; p < hi; p++) {
      data[p] = normValue;
    }
  }

  return {
    name: options?.name ?? result.trackName ?? 'BedGraph',
    type: options?.type ?? 'line',
    data,
    color: options?.color ?? 'rgb(100, 200, 255)',
    height: options?.height ?? 40,
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the `name` attribute from a bedGraph track definition line.
 *
 * Handles both quoted and unquoted values:
 *   track type=bedGraph name="My Track" ...
 *   track type=bedGraph name=MyTrack ...
 */
function extractTrackName(trackLine: string): string | null {
  // Try quoted value first
  const quotedMatch = trackLine.match(/name="([^"]+)"/);
  if (quotedMatch) return quotedMatch[1];

  // Try single-quoted value
  const singleQuotedMatch = trackLine.match(/name='([^']+)'/);
  if (singleQuotedMatch) return singleQuotedMatch[1];

  // Unquoted value (terminated by whitespace or end of string)
  const unquotedMatch = trackLine.match(/name=(\S+)/);
  if (unquotedMatch) return unquotedMatch[1];

  return null;
}
