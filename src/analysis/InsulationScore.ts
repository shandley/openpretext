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
): Float64Array {
  const scores = new Float64Array(size);
  const w = Math.max(1, Math.min(windowSize, Math.floor(size / 2)));

  for (let p = 0; p < size; p++) {
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

  // Log2 transform (add epsilon to avoid log(0))
  const logScores = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    logScores[i] = Math.log2(rawScores[i] + 1e-10);
  }

  // Min-max normalize
  let min = logScores[0];
  let max = logScores[0];
  for (let i = 1; i < n; i++) {
    if (logScores[i] < min) min = logScores[i];
    if (logScores[i] > max) max = logScores[i];
  }

  const range = max - min;
  if (range === 0) {
    result.fill(0);
    return result;
  }

  for (let i = 0; i < n; i++) {
    result[i] = (logScores[i] - min) / range;
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
): InsulationResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const rawScores = computeInsulationScores(contactMap, size, p.windowSize);
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
    insulationData[tp] = result.normalizedScores[op];
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
      color: 'rgb(100, 200, 130)',
      height: 40,
      visible: true,
    },
    boundaryTrack: {
      name: 'TAD Boundaries',
      type: 'marker',
      data: boundaryData,
      color: 'rgb(255, 80, 80)',
      height: 20,
      visible: true,
    },
  };
}
