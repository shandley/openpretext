/**
 * InsulationScore — Insulation score computation and TAD boundary detection.
 *
 * Computes the insulation score at each diagonal position of a Hi-C contact
 * map using a sliding off-diagonal square window (Crane et al. 2015).
 * TAD boundaries are detected as local minima with sufficient prominence.
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';
import type { ContigRange } from '../curation/AutoSort';

/**
 * Per-pixel owning-contig bounds [lo, hi) for clamping analysis windows to a
 * single contig. Pixels not covered by any range default to the full map.
 */
export function contigBoundsPerPixel(
  size: number,
  contigRanges: ContigRange[],
): { lo: Int32Array; hi: Int32Array } {
  const lo = new Int32Array(size).fill(0);
  const hi = new Int32Array(size).fill(size);
  for (const r of contigRanges) {
    const start = Math.max(0, r.start);
    const end = Math.min(size, r.end);
    for (let p = start; p < end; p++) {
      lo[p] = start;
      hi[p] = end;
    }
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsulationParams {
  /** Half-window size in overview pixels. Default: 10. */
  windowSize: number;
  /** Minimum prominence for a boundary. Default: 0.1. */
  boundaryProminence: number;
}

export interface InsulationResult {
  /** Raw insulation scores, length = overviewSize. */
  rawScores: Float64Array;
  /** Log-transformed & normalized [0,1] scores, length = overviewSize. */
  normalizedScores: Float32Array;
  /** TAD boundary positions (overview pixel indices). */
  boundaries: number[];
  /** Boundary prominence values, same length as boundaries. */
  boundaryStrengths: number[];
}

const DEFAULT_PARAMS: InsulationParams = {
  windowSize: 10,
  // With the normalization fix above, real boundaries now use the full [0,1]
  // range, so the documented 0.1 minimum prominence separates true boundaries
  // from noise (verified in the unit tests). The previous 0.03 was a workaround
  // for the compressed range and now over-detects.
  boundaryProminence: 0.1,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute raw insulation score at each diagonal position.
 *
 * For position p, the score is the mean contact intensity in the
 * off-diagonal square [p-w, p) x [p, p+w), which captures contacts
 * between the upstream and downstream regions flanking position p.
 * High values = strong local contacts (within a TAD).
 * Low values = TAD boundaries where contacts drop off.
 */
export function computeInsulationScores(
  contactMap: Float32Array,
  size: number,
  windowSize: number,
  contigRanges?: ContigRange[],
): Float64Array {
  const scores = new Float64Array(size);
  const w = Math.max(1, Math.min(windowSize, Math.floor(size / 2)));

  // When contig ranges are given, the window must not reach across a contig
  // boundary (which would average unrelated inter-contig cells and manufacture a
  // false TAD boundary at every junction). A position needs a full half-window
  // on both sides within its own contig; otherwise it has no valid measurement
  // and is marked NaN (and excluded downstream). Contigs shorter than 2*w are
  // entirely NaN, which is correct — insulation is not measurable in them.
  const bounds =
    contigRanges && contigRanges.length > 0 ? contigBoundsPerPixel(size, contigRanges) : null;

  for (let p = 0; p < size; p++) {
    if (bounds) {
      const cs = bounds.lo[p];
      const ce = bounds.hi[p];
      if (p - cs < w || ce - p < w) {
        scores[p] = NaN;
        continue;
      }
    }

    let sum = 0;
    let count = 0;

    const iStart = Math.max(0, p - w);
    const iEnd = p;
    const jStart = p;
    const jEnd = Math.min(size, p + w);

    for (let i = iStart; i < iEnd; i++) {
      for (let j = jStart; j < jEnd; j++) {
        if (i !== j) {
          sum += contactMap[i * size + j];
          count++;
        }
      }
    }

    scores[p] = count > 0 ? sum / count : 0;
  }

  return scores;
}

/**
 * Log-transform and min-max normalize insulation scores to [0, 1].
 */
export function normalizeInsulationScores(
  rawScores: Float64Array,
): Float32Array {
  const n = rawScores.length;
  const result = new Float32Array(n);

  if (n === 0) return result;

  // Floor at the smallest positive raw score before the log. Empty windows
  // (position 0 always, plus any all-zero region in a sparse map) have a raw
  // score of 0; a fixed 1e-10 epsilon would send them to log2 ≈ -33, an outlier
  // that dominates the min-max range and compresses all real insulation
  // variation into a sliver near 1.0, silently hiding true TAD boundaries.
  // Flooring to the smallest real score keeps zeros on the data's own scale.
  let minPositive = Infinity;
  for (let i = 0; i < n; i++) {
    if (rawScores[i] > 0 && rawScores[i] < minPositive) minPositive = rawScores[i];
  }
  if (!Number.isFinite(minPositive)) {
    // No positive scores at all — nothing to normalize.
    result.fill(0);
    return result;
  }

  // NaN raw scores are near-contig-edge positions with no valid window; they
  // pass through as NaN (log2(max(NaN, x)) = NaN) and are excluded from the
  // min-max scan so one invalid position can't poison the range.
  const logScores = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    logScores[i] = Math.log2(Math.max(rawScores[i], minPositive));
  }

  // Min-max normalize over finite values only.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = logScores[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  if (!Number.isFinite(range) || range === 0) {
    for (let i = 0; i < n; i++) result[i] = Number.isFinite(logScores[i]) ? 0 : NaN;
    return result;
  }

  for (let i = 0; i < n; i++) {
    result[i] = Number.isFinite(logScores[i]) ? (logScores[i] - min) / range : NaN;
  }

  return result;
}

/**
 * Detect TAD boundaries as local minima with prominence above threshold.
 */
export function detectTADBoundaries(
  normalizedScores: Float32Array,
  boundaryProminence: number,
  windowSize: number,
): { positions: number[]; strengths: number[] } {
  const n = normalizedScores.length;
  const positions: number[] = [];
  const strengths: number[] = [];

  if (n < 3) return { positions, strengths };

  for (let p = 1; p < n - 1; p++) {
    // A NaN position (near a contig edge) has no valid measurement; it can be
    // neither a boundary nor a comparable neighbor. Skip if it or either
    // neighbor is NaN — a NaN neighbor makes the >= comparisons below silently
    // false, which would otherwise flag a false boundary.
    if (!Number.isFinite(normalizedScores[p]) ||
        !Number.isFinite(normalizedScores[p - 1]) ||
        !Number.isFinite(normalizedScores[p + 1])) {
      continue;
    }

    // Must be a local minimum (lower than both immediate neighbors)
    if (normalizedScores[p] >= normalizedScores[p - 1] ||
        normalizedScores[p] >= normalizedScores[p + 1]) {
      continue;
    }

    // Compute prominence: height above the minimum to the nearest higher
    // peak on each side, take the smaller of the two.
    const valley = normalizedScores[p];

    let leftPeak = valley;
    const leftBound = Math.max(0, p - windowSize);
    for (let i = leftBound; i < p; i++) {
      if (normalizedScores[i] > leftPeak) leftPeak = normalizedScores[i];
    }

    let rightPeak = valley;
    const rightBound = Math.min(n, p + windowSize + 1);
    for (let i = p + 1; i < rightBound; i++) {
      if (normalizedScores[i] > rightPeak) rightPeak = normalizedScores[i];
    }

    const prominence = Math.min(leftPeak - valley, rightPeak - valley);

    if (prominence >= boundaryProminence) {
      positions.push(p);
      strengths.push(prominence);
    }
  }

  return { positions, strengths };
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Compute insulation scores and detect TAD boundaries in one call.
 */
export function computeInsulation(
  contactMap: Float32Array,
  size: number,
  params?: Partial<InsulationParams>,
  contigRanges?: ContigRange[],
): InsulationResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const rawScores = computeInsulationScores(contactMap, size, p.windowSize, contigRanges);
  const normalizedScores = normalizeInsulationScores(rawScores);
  const { positions, strengths } = detectTADBoundaries(
    normalizedScores,
    p.boundaryProminence,
    p.windowSize,
  );

  return {
    rawScores,
    normalizedScores,
    boundaries: positions,
    boundaryStrengths: strengths,
  };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert InsulationResult to TrackConfig objects for TrackRenderer.
 *
 * Produces:
 * 1. "Insulation Score" — line track showing the normalized scores
 * 2. "TAD Boundaries" — marker track at detected boundary positions
 *
 * Maps overview-pixel coordinates to textureSize-length Float32Arrays.
 */
export function insulationToTracks(
  result: InsulationResult,
  overviewSize: number,
  textureSize: number,
): { insulationTrack: TrackConfig; boundaryTrack: TrackConfig } {
  // Build insulation data array mapped to textureSize
  const insulationData = new Float32Array(textureSize);
  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    const v = result.normalizedScores[op];
    insulationData[tp] = Number.isFinite(v) ? v : 0;
  }

  // Build boundary marker array
  const boundaryData = new Float32Array(textureSize);
  for (const bp of result.boundaries) {
    const tp = Math.round((bp / overviewSize) * textureSize);
    if (tp >= 0 && tp < textureSize) {
      boundaryData[tp] = 1;
    }
  }

  return {
    insulationTrack: {
      name: 'Insulation Score',
      type: 'line',
      data: insulationData,
      color: '#64c882',
      height: 40,
      visible: true,
    },
    boundaryTrack: {
      name: 'TAD Boundaries',
      type: 'marker',
      data: boundaryData,
      color: '#ff5050',
      height: 20,
      visible: true,
    },
  };
}
