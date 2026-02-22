/**
 * ICENormalization — Iterative Correction and Eigenvector decomposition (ICE)
 * matrix balancing for Hi-C contact maps.
 *
 * Implements Sinkhorn-Knopp iterative balancing (Imakaev et al. 2012):
 * 1. Compute row sums, mask bins below a low-coverage quantile
 * 2. Iteratively: bias[i] = sqrt(rowSum[i]), divide entries by bias[i]*bias[j]
 * 3. Converge when max |rowSum - 1| < epsilon
 *
 * Pure algorithm — no DOM dependencies.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ICEParams {
  /** Maximum iterations. Default: 50. */
  maxIterations: number;
  /** Convergence threshold. Default: 1e-4. */
  epsilon: number;
  /** Low-coverage filter quantile (0-1). Default: 0.02. */
  sparseFilterQuantile: number;
}

export interface ICEResult {
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

const DEFAULT_PARAMS: ICEParams = {
  maxIterations: 50,
  epsilon: 1e-4,
  sparseFilterQuantile: 0.02,
};

// ---------------------------------------------------------------------------
// Step 1: Row sums
// ---------------------------------------------------------------------------

/**
 * Compute row sums of a symmetric row-major contact matrix.
 */
export function computeRowSums(
  contactMap: Float32Array,
  size: number,
): Float64Array {
  const sums = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    let s = 0;
    for (let j = 0; j < size; j++) {
      s += contactMap[i * size + j];
    }
    sums[i] = s;
  }
  return sums;
}

// ---------------------------------------------------------------------------
// Step 2: Filter low-coverage bins
// ---------------------------------------------------------------------------

/**
 * Identify bins with row sums below a quantile threshold.
 * Returns array of bin indices to mask.
 */
export function filterLowCoverageBins(
  rowSums: Float64Array,
  quantile: number,
): number[] {
  if (quantile <= 0) return [];

  const n = rowSums.length;
  if (n === 0) return [];

  // Sort row sums to find the quantile threshold
  const sorted = Array.from(rowSums).sort((a, b) => a - b);
  const idx = Math.min(Math.floor(quantile * n), n - 1);
  const threshold = sorted[idx];

  const masked: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rowSums[i] <= threshold) {
      masked.push(i);
    }
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Step 3: Sinkhorn-Knopp iteration
// ---------------------------------------------------------------------------

/**
 * Perform Sinkhorn-Knopp iterative matrix balancing.
 *
 * Modifies matrix in place. Returns bias vector and convergence info.
 * Masked bins are excluded from balancing (their bias stays at 1).
 */
export function sinkhornKnopp(
  matrix: Float32Array,
  size: number,
  maskedBins: Set<number>,
  maxIterations: number,
  epsilon: number,
): { biasVector: Float64Array; iterations: number; maxDeviation: number } {
  const bias = new Float64Array(size);
  bias.fill(1.0);

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

    // Compute per-bin correction factor: sqrt(rowSum)
    const correction = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      if (maskedBins.has(i) || rowSums[i] <= 0) {
        correction[i] = 1.0;
      } else {
        correction[i] = Math.sqrt(rowSums[i]);
      }
    }

    // Fused pass: apply correction AND compute new row sums — single O(n²) pass
    const newRowSums = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      if (maskedBins.has(i)) continue;
      const ci = correction[i];
      let s = 0;
      for (let j = 0; j < size; j++) {
        if (maskedBins.has(j)) continue;
        const idx = i * size + j;
        matrix[idx] /= (ci * correction[j]);
        s += matrix[idx];
      }
      newRowSums[i] = s;
    }

    // Accumulate bias
    for (let i = 0; i < size; i++) {
      bias[i] *= correction[i];
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

  return { biasVector: bias, iterations, maxDeviation: maxDev };
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

/**
 * Compute ICE-normalized contact matrix.
 */
export function computeICENormalization(
  contactMap: Float32Array,
  size: number,
  params?: Partial<ICEParams>,
): ICEResult {
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

  // Step 3: Copy sanitized matrix and run Sinkhorn-Knopp
  const normalizedMatrix = Float32Array.from(sanitized);

  // Zero out masked bins in the copy
  for (const bin of maskedBins) {
    for (let j = 0; j < size; j++) {
      normalizedMatrix[bin * size + j] = 0;
      normalizedMatrix[j * size + bin] = 0;
    }
  }

  const { biasVector, iterations, maxDeviation } = sinkhornKnopp(
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
 * Convert ICE bias vector to a track for display.
 * Shows per-bin bias values as a line track.
 */
export function iceToTrack(
  result: ICEResult,
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
    name: 'ICE Bias',
    type: 'line',
    data,
    color: 'rgb(180, 130, 255)',
    height: 30,
    visible: true,
  };
}
