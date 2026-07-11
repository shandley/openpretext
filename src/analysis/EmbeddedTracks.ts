/**
 * EmbeddedTracks - Surface the curator overlay tracks that curationpretext
 * embeds in a .pretext file (coverage, gaps, telomeres, repeat density) as
 * renderable overlay tracks.
 *
 * The tracks live in the file's graph extensions (magic 'psgh'), which the
 * parser reads into `map.extensions` as one signed value per full-resolution
 * 1-D pixel, in original (file) contig order. This module normalizes each by
 * kind and permutes it into the current display order so it stays aligned with
 * the reordered contact map after curation.
 */

import type { MapData, ContigInfo } from '../core/State';
import type { TrackConfig, TrackType } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Track classification
// ---------------------------------------------------------------------------

type TrackKind = 'coverage' | 'line' | 'marker';

interface TrackSpec {
  kind: TrackKind;
  label: string;
  color: string;
  height: number;
}

/**
 * Map an extension name to a display spec. Order matters: telomere data can be
 * named "telomeres_gap_format", so telomere must be matched before gap.
 */
function classify(name: string): TrackSpec {
  const n = name.toLowerCase();
  if (n.includes('telomere') || n.includes('telo')) {
    return { kind: 'marker', label: 'Telomeres', color: '#00e676', height: 14 };
  }
  if (n.includes('gap')) {
    return { kind: 'marker', label: 'Gaps', color: '#8895a6', height: 14 };
  }
  if (n.includes('cov')) {
    return { kind: 'coverage', label: 'Coverage', color: '#e6a817', height: 34 };
  }
  if (n.includes('repeat')) {
    return { kind: 'line', label: 'Repeat density', color: '#b07be6', height: 30 };
  }
  return { kind: 'line', label: name, color: '#9aa7b4', height: 30 };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Clip to a robust percentile window and scale to [0, 1]. Optionally log-scale
 * first (for coverage, which spans orders of magnitude). Order-preserving, so a
 * flat input returns all-zero.
 */
function percentileClipToUnit(src: Int32Array, log: boolean): Float32Array {
  const n = src.length;
  const vals = new Float64Array(n);
  for (let i = 0; i < n; i++) vals[i] = log ? Math.log1p(Math.max(0, src[i])) : src[i];

  const sorted = Float64Array.from(vals).sort();
  const lo = sorted[Math.floor(0.01 * (n - 1))];
  const hi = sorted[Math.floor(0.99 * (n - 1))];
  const range = hi - lo;

  const out = new Float32Array(n);
  if (range <= 0) return out; // flat track
  for (let i = 0; i < n; i++) {
    let t = (vals[i] - lo) / range;
    out[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return out;
}

/** Binarize to 0 / 1 for marker tracks (draw a tick wherever the value is set). */
function binarize(src: Int32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] > 0 ? 1 : 0;
  return out;
}

// ---------------------------------------------------------------------------
// Display-order permutation
// ---------------------------------------------------------------------------

/**
 * Permute per-pixel track data from file order into the current display order,
 * by laying each contig's native pixel span end to end in `contigOrder`,
 * reversed for inverted contigs. Works directly in the file's full-resolution
 * 1-D coordinates (no overview scale factor), so it aligns by construction.
 *
 * Exported for testing.
 */
export function reorderTrackData(
  src: Float32Array,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
): Float32Array {
  const out = new Float32Array(textureSize);
  let dest = 0;
  for (const id of contigOrder) {
    const c = contigs[id];
    if (!c) continue;
    const start = Math.max(0, Math.round(c.pixelStart));
    const end = Math.min(textureSize, Math.round(c.pixelEnd));
    const len = end - start;
    for (let j = 0; j < len && dest < textureSize; j++) {
      const srcIdx = c.inverted ? end - 1 - j : start + j;
      out[dest++] = src[srcIdx];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The display label a given extension name maps to. */
export function labelForExtension(name: string): string {
  return classify(name).label;
}

/**
 * Build one overlay track from a per-pixel extension array (file order),
 * classifying and normalizing it by name and permuting it into display order.
 * Returns null when the array length does not match the 1-D pixel count (it
 * cannot be aligned to the map). Shared by embedded (file) and computed
 * (FASTA-derived) tracks so both normalize and reorder identically.
 */
export function buildTrackFromExtension(
  name: string,
  data: Int32Array,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
): TrackConfig | null {
  if (data.length !== textureSize) {
    console.warn(`Track "${name}" skipped: length ${data.length} != textureSize ${textureSize}`);
    return null;
  }
  const spec = classify(name);
  const normFile =
    spec.kind === 'marker' ? binarize(data) : percentileClipToUnit(data, spec.kind === 'coverage');
  const display = reorderTrackData(normFile, contigs, contigOrder, textureSize);
  const type: TrackType = spec.kind === 'marker' ? 'marker' : 'line';
  return { name: spec.label, type, data: display, color: spec.color, height: spec.height, visible: true };
}

/**
 * Build renderable overlay tracks from a map's embedded graph extensions, in
 * the given display order. Returns an empty array when the file carries no
 * extensions.
 */
export function buildEmbeddedTracks(map: MapData, contigOrder: number[]): TrackConfig[] {
  const tracks: TrackConfig[] = [];
  if (!map.extensions) return tracks;
  for (const [name, data] of map.extensions) {
    const track = buildTrackFromExtension(name, data, map.contigs, contigOrder, map.textureSize);
    if (track) tracks.push(track);
  }
  return tracks;
}

/** The track labels this module would produce for a map, for idempotent refresh. */
export function embeddedTrackLabels(map: MapData): string[] {
  if (!map.extensions) return [];
  const labels: string[] = [];
  for (const [name, data] of map.extensions) {
    if (data.length === map.textureSize) labels.push(classify(name).label);
  }
  return labels;
}
