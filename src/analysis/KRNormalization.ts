/**
 * KRNormalization — symmetric Sinkhorn-Knopp matrix balancing for Hi-C
 * contact maps.
 *
 * This is iterative matrix balancing (Sinkhorn-Knopp), NOT the Knight-Ruiz
 * (2013) Newton/conjugate-gradient algorithm despite the historical "KR"
 * naming. It was previously mislabeled as Knight-Ruiz; the exported symbol
 * names, the `kr` session key, and the `'kr'` analysis key keep the "KR"
 * abbreviation for backward compatibility only. Do not re-introduce a
 * Knight-Ruiz citation for this code.
 *
 * Algorithm:
 * 1. Compute row sums, mask bins below a low-coverage quantile
 * 2. Iteratively: x *= sqrt(rowSum), divide entries by the ratio outer product
 * 3. Converge when max |rowSum - 1| < epsilon
 *
 * This is the same family as the ICE module (`ICENormalization`, Imakaev et al.
 * 2012). The two differ only in the update form (this accumulates the bias
 * multiplicatively; ICE recomputes bias = sqrt(rowSum) each pass) and in the
 * default iteration/epsilon settings — not a fundamentally distinct algorithm.
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
// Sinkhorn-Knopp balancing iteration
// ---------------------------------------------------------------------------

/**
 * Perform symmetric Sinkhorn-Knopp iterative matrix balancing.
 *
 * Modifies matrix in place. Returns bias vector and convergence info.
 * Masked bins are excluded from balancing (their scaling stays at 1).
 */
export function sinkhornKnoppBalance(
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
 * Compute the Sinkhorn-Knopp-balanced contact matrix. (Kept the `KR` name for
 * backward compatibility; see the module header.)
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

  // Single working copy: sanitize NaN/Infinity in place (one full-matrix copy
  // instead of two — the result matrix is balanced in place below).
  const normalizedMatrix = Float32Array.from(contactMap);
  for (let i = 0; i < normalizedMatrix.length; i++) {
    if (!isFinite(normalizedMatrix[i])) normalizedMatrix[i] = 0;
  }

  // Step 1: Row sums (on sanitized values, before masking)
  const rowSums = computeRowSums(normalizedMatrix, size);

  // Step 2: Filter low-coverage bins
  const maskedBins = filterLowCoverageBins(rowSums, p.sparseFilterQuantile);
  const maskedSet = new Set(maskedBins);

  // Step 3: Zero out masked bins, then run Sinkhorn-Knopp balancing in place
  for (const bin of maskedBins) {
    for (let j = 0; j < size; j++) {
      normalizedMatrix[bin * size + j] = 0;
      normalizedMatrix[j * size + bin] = 0;
    }
  }

  const { biasVector, iterations, maxDeviation } = sinkhornKnoppBalance(
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
 * Convert the Sinkhorn-Knopp bias vector to a track for display.
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
    name: 'SK Bias',
    type: 'line',
    data,
    color: '#ff7675',
    height: 30,
    visible: true,
  };
}
