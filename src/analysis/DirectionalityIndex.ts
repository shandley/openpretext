/**
 * DirectionalityIndex — Directional contact bias analysis for TAD detection.
 *
 * Implements the Directionality Index (Dixon et al. 2012):
 * - A = sum of upstream contacts within window w
 * - B = sum of downstream contacts within window w
 * - E = (A + B) / 2
 * - DI = sign(B - A) * ((A - E)^2 / E + (B - E)^2 / E)
 *
 * TAD boundaries are detected at negative-to-positive zero-crossings of DI.
 *
 * Pure algorithm — no DOM dependencies.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DIParams {
  /** Window size for upstream/downstream contact sums. Default: 10. */
  windowSize: number;
  /** Minimum absolute DI for boundary detection. Default: 0. */
  significanceThreshold: number;
}

export interface DIResult {
  /** Raw DI scores. Length = size. */
  diScores: Float32Array;
  /** Normalized to [0,1] (0.5 = zero DI). Length = size. */
  normalizedScores: Float32Array;
  /** Boundary positions (negative-to-positive crossings). */
  boundaries: number[];
  /** Boundary strengths (DI jump magnitude). */
  strengths: number[];
}

const DEFAULT_PARAMS: DIParams = {
  windowSize: 10,
  significanceThreshold: 0,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute raw DI scores at each diagonal position.
 *
 * DI = sign(B - A) * ((A - E)^2/E + (B - E)^2/E)
 * where A = upstream contacts, B = downstream contacts, E = (A+B)/2
 */
export function computeDirectionalityScores(
  contactMap: Float32Array,
  size: number,
  windowSize: number,
): Float32Array {
  const scores = new Float32Array(size);
  const w = Math.max(1, Math.min(windowSize, Math.floor(size / 2)));

  for (let p = 0; p < size; p++) {
    // A = sum of contacts upstream: contactMap[p][p-d] for d in [1, w]
    let A = 0;
    for (let d = 1; d <= w; d++) {
      const j = p - d;
      if (j < 0) break;
      A += contactMap[p * size + j];
    }

    // B = sum of contacts downstream: contactMap[p][p+d] for d in [1, w]
    let B = 0;
    for (let d = 1; d <= w; d++) {
      const j = p + d;
      if (j >= size) break;
      B += contactMap[p * size + j];
    }

    const E = (A + B) / 2;
    if (E <= 0) {
      scores[p] = 0;
      continue;
    }

    const sign = B >= A ? 1 : -1;
    const chiSq = ((A - E) * (A - E)) / E + ((B - E) * (B - E)) / E;
    scores[p] = sign * chiSq;
  }

  return scores;
}

/**
 * Normalize DI scores to [0, 1] with 0.5 = zero DI.
 * Positive DI maps to (0.5, 1], negative maps to [0, 0.5).
 */
export function normalizeDIScores(diScores: Float32Array): Float32Array {
  const n = diScores.length;
  const result = new Float32Array(n);

  if (n === 0) return result;

  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(diScores[i]);
    if (a > maxAbs) maxAbs = a;
  }

  if (maxAbs === 0) {
    result.fill(0.5);
    return result;
  }

  for (let i = 0; i < n; i++) {
    result[i] = 0.5 + (diScores[i] / maxAbs) * 0.5;
  }

  return result;
}

/**
 * Detect TAD boundaries at negative-to-positive zero-crossings of DI.
 */
export function detectDIBoundaries(
  diScores: Float32Array,
  significanceThreshold: number,
): { positions: number[]; strengths: number[] } {
  const positions: number[] = [];
  const strengths: number[] = [];
  const n = diScores.length;

  if (n < 2) return { positions, strengths };

  for (let i = 1; i < n; i++) {
    // Negative-to-positive zero crossing
    if (diScores[i - 1] < -significanceThreshold && diScores[i] > significanceThreshold) {
      positions.push(i);
      strengths.push(Math.abs(diScores[i] - diScores[i - 1]));
    }
  }

  return { positions, strengths };
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Compute directionality index and detect TAD boundaries in one call.
 */
export function computeDirectionality(
  contactMap: Float32Array,
  size: number,
  params?: Partial<DIParams>,
): DIResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (size === 0) {
    return {
      diScores: new Float32Array(0),
      normalizedScores: new Float32Array(0),
      boundaries: [],
      strengths: [],
    };
  }

  const diScores = computeDirectionalityScores(contactMap, size, p.windowSize);
  const normalizedScores = normalizeDIScores(diScores);
  const { positions, strengths } = detectDIBoundaries(diScores, p.significanceThreshold);

  return { diScores, normalizedScores, boundaries: positions, strengths };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert DIResult to TrackConfig objects for display.
 *
 * Produces:
 * 1. "Directionality Index" — line track showing normalized DI scores
 * 2. "DI Boundaries" — marker track at detected crossings
 */
export function directionalityToTracks(
  result: DIResult,
  overviewSize: number,
  textureSize: number,
): { diTrack: TrackConfig; diBoundaryTrack: TrackConfig } {
  const diData = new Float32Array(textureSize);
  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    diData[tp] = result.normalizedScores[op];
  }

  const boundaryData = new Float32Array(textureSize);
  for (const bp of result.boundaries) {
    const tp = Math.round((bp / overviewSize) * textureSize);
    if (tp >= 0 && tp < textureSize) {
      boundaryData[tp] = 1;
    }
  }

  return {
    diTrack: {
      name: 'Directionality Index',
      type: 'line',
      data: diData,
      color: '#ffa500',
      height: 40,
      visible: true,
    },
    diBoundaryTrack: {
      name: 'DI Boundaries',
      type: 'marker',
      data: boundaryData,
      color: '#ffc832',
      height: 20,
      visible: true,
    },
  };
}
