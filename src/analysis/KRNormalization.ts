/**
 * KRNormalization — Knight-Ruiz matrix balancing for Hi-C contact maps.
 *
 * Implements the Knight-Ruiz algorithm (Knight & Ruiz 2013):
 * 1. Compute row sums, mask bins below a low-coverage quantile
 * 2. Iteratively: x_new = x * sqrt(rowSum), apply correction ratio x_new/x
 * 3. Converge when max |rowSum - 1| < epsilon
 *
 * Key difference from ICE: KR uses x_new = x * sqrt(rowSum) and applies the
 * correction as a ratio x_new/x, converging faster than ICE's direct
 * bias = sqrt(rowSum) approach.
 *
 * Pure algorithm — no DOM dependencies.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';
import { computeRowSums, filterLowCoverageBins } from './ICENormalization';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KRParams {
  /** Maximum iterations. Default: 200. */
  maxIterations: number;
  /** Convergence threshold. Default: 1e-6. */
  epsilon: number;
  /** Low-coverage filter quantile (0-1). Default: 0.02. */
  sparseFilterQuantile: number;
}

export interface KRResult {
  /** Per-bin bias vector. Length = size. */
  biasVector: Float32Array;
  /** Normalized matrix (row-major). Length = size * size. */
  normalizedMatrix: Float32Array;
  /** Indices of masked (low-coverage) bins. */
  maskedBins: number[];
  /** Number of iterations performed. */
  iterations: number;
  /** Final max deviation from unit row sums. */
  maxDeviation: number;
}

const DEFAULT_PARAMS: KRParams = {
  maxIterations: 200,
  epsilon: 1e-6,
  sparseFilterQuantile: 0.02,
};

// ---------------------------------------------------------------------------
// Knight-Ruiz iteration
// ---------------------------------------------------------------------------

/**
 * Perform Knight-Ruiz iterative matrix balancing.
 *
 * Modifies matrix in place. Returns bias vector and convergence info.
 * Masked bins are excluded from balancing (their scaling stays at 1).
 */
export function knightRuiz(
  matrix: Float32Array,
  size: number,
  maskedBins: Set<number>,
  maxIterations: number,
  epsilon: number,
): { biasVector: Float64Array; iterations: number; maxDeviation: number } {
  const x = new Float64Array(size);
  x.fill(1.0);

  let iterations = 0;
  let maxDev = Infinity;

  // Compute initial row sums once before the loop — O(n²)
  let rowSums = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    if (maskedBins.has(i)) continue;
    let s = 0;
    for (let j = 0; j < size; j++) {
      if (!maskedBins.has(j)) {
        s += matrix[i * size + j];
      }
    }
    rowSums[i] = s;
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // Compute new scaling vector: x_new[i] = x[i] * sqrt(rowSum[i])
    // and the correction ratio: ratio[i] = x_new[i] / x[i] = sqrt(rowSum[i])
    const ratio = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      if (maskedBins.has(i) || rowSums[i] <= 0) {
        ratio[i] = 1.0;
      } else {
        ratio[i] = Math.sqrt(rowSums[i]);
      }
    }

    // Fused pass: apply correction AND compute new row sums — single O(n²) pass
    const newRowSums = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      if (maskedBins.has(i)) continue;
      const ri = ratio[i];
      let s = 0;
      for (let j = 0; j < size; j++) {
        if (maskedBins.has(j)) continue;
        const idx = i * size + j;
        matrix[idx] /= (ri * ratio[j]);
        s += matrix[idx];
      }
      newRowSums[i] = s;
    }

    // Accumulate scaling vector: x[i] *= ratio[i]
    for (let i = 0; i < size; i++) {
      x[i] *= ratio[i];
    }

    // Check convergence from new row sums — O(n)
    maxDev = 0;
    for (let i = 0; i < size; i++) {
      if (maskedBins.has(i)) continue;
      const dev = Math.abs(newRowSums[i] - 1.0);
      if (dev > maxDev) maxDev = dev;
    }

    rowSums = newRowSums;
    if (maxDev < epsilon) break;
  }

  return { biasVector: x, iterations, maxDeviation: maxDev };
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

/**
 * Compute KR-normalized contact matrix.
 */
export function computeKRNormalization(
  contactMap: Float32Array,
  size: number,
  params?: Partial<KRParams>,
): KRResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (size === 0) {
    return {
      biasVector: new Float32Array(0),
      normalizedMatrix: new Float32Array(0),
      maskedBins: [],
      iterations: 0,
      maxDeviation: 0,
    };
  }

  // Sanitize NaN/Infinity values in input
  const sanitized = Float32Array.from(contactMap);
  for (let i = 0; i < sanitized.length; i++) {
    if (!isFinite(sanitized[i])) sanitized[i] = 0;
  }

  // Step 1: Row sums
  const rowSums = computeRowSums(sanitized, size);

  // Step 2: Filter low-coverage bins
  const maskedBins = filterLowCoverageBins(rowSums, p.sparseFilterQuantile);
  const maskedSet = new Set(maskedBins);

  // Step 3: Copy sanitized matrix and run Knight-Ruiz
  const normalizedMatrix = Float32Array.from(sanitized);

  // Zero out masked bins in the copy
  for (const bin of maskedBins) {
    for (let j = 0; j < size; j++) {
      normalizedMatrix[bin * size + j] = 0;
      normalizedMatrix[j * size + bin] = 0;
    }
  }

  const { biasVector, iterations, maxDeviation } = knightRuiz(
    normalizedMatrix,
    size,
    maskedSet,
    p.maxIterations,
    p.epsilon,
  );

  // Convert bias from Float64Array to Float32Array
  const biasF32 = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    biasF32[i] = biasVector[i];
  }

  return {
    biasVector: biasF32,
    normalizedMatrix,
    maskedBins,
    iterations,
    maxDeviation,
  };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert KR bias vector to a track for display.
 * Shows per-bin bias values as a line track.
 */
export function krToTrack(
  result: KRResult,
  overviewSize: number,
  textureSize: number,
): TrackConfig {
  const data = new Float32Array(textureSize);

  // Normalize bias to [0, 1] for display
  let maxBias = 0;
  for (let i = 0; i < overviewSize; i++) {
    if (result.biasVector[i] > maxBias) maxBias = result.biasVector[i];
  }

  if (maxBias > 0) {
    for (let tp = 0; tp < textureSize; tp++) {
      const op = Math.min(
        Math.floor((tp / textureSize) * overviewSize),
        overviewSize - 1,
      );
      data[tp] = result.biasVector[op] / maxBias;
    }
  }

  return {
    name: 'KR Bias',
    type: 'line',
    data,
    color: '#ff7675',
    height: 30,
    visible: true,
  };
}
