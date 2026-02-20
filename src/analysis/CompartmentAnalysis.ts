/**
 * CompartmentAnalysis — A/B compartment detection via eigenvector decomposition.
 *
 * Pipeline:
 * 1. Bin the contact map to reduce size
 * 2. Compute expected contacts at each diagonal distance
 * 3. Compute observed/expected (O/E) matrix
 * 4. Compute Pearson correlation matrix of O/E rows
 * 5. Extract first eigenvector via power iteration
 * 6. Expand and normalize for track display
 *
 * The first eigenvector of the O/E correlation matrix separates A (active)
 * and B (inactive) chromatin compartments, visible as a checkerboard pattern
 * in the Hi-C contact map.
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompartmentParams {
  /** Number of power iterations. Default: 100. */
  maxIterations: number;
  /** Convergence tolerance. Default: 1e-6. */
  tolerance: number;
  /** Bin size for coarsening. Default: 4. Auto-adjusts for small maps. */
  binSize: number;
}

export interface CompartmentResult {
  /** First eigenvector values (positive = A, negative = B). Length = overviewSize. */
  eigenvector: Float32Array;
  /** Normalized to [0, 1] for track display (0 = B, 1 = A). Length = overviewSize. */
  normalizedEigenvector: Float32Array;
  /** Number of power iterations used. */
  iterations: number;
  /** Dominant eigenvalue. */
  eigenvalue: number;
}

const DEFAULT_PARAMS: CompartmentParams = {
  maxIterations: 100,
  tolerance: 1e-6,
  binSize: 4,
};

// ---------------------------------------------------------------------------
// Step 1: Binning
// ---------------------------------------------------------------------------

/**
 * Bin a flattened row-major square matrix by averaging binSize x binSize blocks.
 */
export function binMatrix(
  matrix: Float32Array,
  size: number,
  binSize: number,
): { binnedMatrix: Float32Array; binnedSize: number } {
  if (binSize <= 1 || size <= binSize) {
    return { binnedMatrix: Float32Array.from(matrix), binnedSize: size };
  }

  const binnedSize = Math.ceil(size / binSize);
  const binnedMatrix = new Float32Array(binnedSize * binnedSize);

  for (let bi = 0; bi < binnedSize; bi++) {
    for (let bj = 0; bj < binnedSize; bj++) {
      let sum = 0;
      let count = 0;
      const iStart = bi * binSize;
      const iEnd = Math.min(iStart + binSize, size);
      const jStart = bj * binSize;
      const jEnd = Math.min(jStart + binSize, size);

      for (let i = iStart; i < iEnd; i++) {
        for (let j = jStart; j < jEnd; j++) {
          sum += matrix[i * size + j];
          count++;
        }
      }

      binnedMatrix[bi * binnedSize + bj] = count > 0 ? sum / count : 0;
    }
  }

  return { binnedMatrix, binnedSize };
}

// ---------------------------------------------------------------------------
// Step 2: Expected contacts
// ---------------------------------------------------------------------------

/**
 * Compute expected contact frequency at each diagonal distance.
 * expected[d] = mean of all contactMap[i, j] where |i - j| = d.
 */
export function computeExpectedContacts(
  contactMap: Float32Array,
  size: number,
): Float64Array {
  const sums = new Float64Array(size);
  const counts = new Float64Array(size);

  for (let i = 0; i < size; i++) {
    for (let j = i; j < size; j++) {
      const d = j - i;
      const val = contactMap[i * size + j];
      sums[d] += val;
      counts[d]++;
    }
  }

  const expected = new Float64Array(size);
  for (let d = 0; d < size; d++) {
    expected[d] = counts[d] > 0 ? sums[d] / counts[d] : 0;
  }

  return expected;
}

// ---------------------------------------------------------------------------
// Step 3: O/E matrix
// ---------------------------------------------------------------------------

/**
 * Compute observed/expected matrix.
 * oe[i][j] = contact[i][j] / expected[|i-j|], or 0 if expected is 0.
 */
export function computeOEMatrix(
  contactMap: Float32Array,
  size: number,
  expected: Float64Array,
): Float32Array {
  const oe = new Float32Array(size * size);

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const d = Math.abs(i - j);
      const exp = d < expected.length ? expected[d] : 0;
      oe[i * size + j] = exp > 0 ? contactMap[i * size + j] / exp : 0;
    }
  }

  return oe;
}

// ---------------------------------------------------------------------------
// Step 4: Correlation matrix
// ---------------------------------------------------------------------------

/**
 * Compute Pearson correlation matrix of the rows of the input matrix.
 * corr[i][j] = pearson(row_i, row_j).
 */
export function computeCorrelationMatrix(
  matrix: Float32Array,
  size: number,
): Float32Array {
  const corr = new Float32Array(size * size);

  // Precompute row means and standard deviations
  const means = new Float64Array(size);
  const stds = new Float64Array(size);

  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (let j = 0; j < size; j++) {
      sum += matrix[i * size + j];
    }
    means[i] = sum / size;

    let sumSq = 0;
    for (let j = 0; j < size; j++) {
      const d = matrix[i * size + j] - means[i];
      sumSq += d * d;
    }
    stds[i] = Math.sqrt(sumSq / size);
  }

  // Compute pairwise correlations
  for (let i = 0; i < size; i++) {
    corr[i * size + i] = 1.0;

    for (let j = i + 1; j < size; j++) {
      if (stds[i] === 0 || stds[j] === 0) {
        corr[i * size + j] = 0;
        corr[j * size + i] = 0;
        continue;
      }

      let sum = 0;
      for (let k = 0; k < size; k++) {
        sum += (matrix[i * size + k] - means[i]) *
               (matrix[j * size + k] - means[j]);
      }

      const r = sum / (size * stds[i] * stds[j]);
      corr[i * size + j] = r;
      corr[j * size + i] = r;
    }
  }

  return corr;
}

// ---------------------------------------------------------------------------
// Step 5: Power iteration
// ---------------------------------------------------------------------------

/**
 * Extract the first eigenvector via power iteration.
 *
 * Uses a deterministic initial vector (alternating +-1) rather than random
 * to ensure reproducible results.
 */
export function powerIteration(
  matrix: Float32Array,
  size: number,
  maxIterations: number,
  tolerance: number,
): { eigenvector: Float64Array; eigenvalue: number; iterations: number } {
  if (size === 0) {
    return { eigenvector: new Float64Array(0), eigenvalue: 0, iterations: 0 };
  }

  // Deterministic initial vector (alternating for compartment-like structure)
  const v = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    v[i] = i % 2 === 0 ? 1.0 : -1.0;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < size; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < size; i++) v[i] /= norm;
  }

  let eigenvalue = 0;
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // Matrix-vector multiply: w = matrix * v
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) {
        sum += matrix[i * size + j] * v[j];
      }
      w[i] = sum;
    }

    // Eigenvalue (Rayleigh quotient: v^T * w)
    eigenvalue = 0;
    for (let i = 0; i < size; i++) eigenvalue += v[i] * w[i];

    // Normalize w
    norm = 0;
    for (let i = 0; i < size; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm);
    if (norm === 0) break;
    for (let i = 0; i < size; i++) w[i] /= norm;

    // Check convergence
    let diff = 0;
    for (let i = 0; i < size; i++) {
      const d = w[i] - v[i];
      diff += d * d;
    }
    diff = Math.sqrt(diff);

    // Copy w to v
    for (let i = 0; i < size; i++) v[i] = w[i];

    if (diff < tolerance) break;
  }

  return { eigenvector: v, eigenvalue, iterations };
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

/**
 * Compute A/B compartment eigenvector from the contact map.
 */
export function computeCompartments(
  contactMap: Float32Array,
  size: number,
  params?: Partial<CompartmentParams>,
): CompartmentResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (size === 0) {
    return {
      eigenvector: new Float32Array(0),
      normalizedEigenvector: new Float32Array(0),
      iterations: 0,
      eigenvalue: 0,
    };
  }

  // Auto-adjust binSize for small maps
  let binSize = p.binSize;
  if (size / binSize < 16) {
    binSize = 1;
  }

  // Step 1: Bin
  const { binnedMatrix, binnedSize } = binMatrix(contactMap, size, binSize);

  // Step 2: Expected contacts
  const expected = computeExpectedContacts(binnedMatrix, binnedSize);

  // Step 3: O/E matrix
  const oeMatrix = computeOEMatrix(binnedMatrix, binnedSize, expected);

  // Step 4: Correlation matrix
  const corrMatrix = computeCorrelationMatrix(oeMatrix, binnedSize);

  // Step 5: Power iteration
  const { eigenvector: binnedEV, eigenvalue, iterations } = powerIteration(
    corrMatrix,
    binnedSize,
    p.maxIterations,
    p.tolerance,
  );

  // Step 6: Expand eigenvector back to original resolution
  const eigenvector = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const binIdx = Math.min(Math.floor(i / binSize), binnedSize - 1);
    eigenvector[i] = binnedEV[binIdx];
  }

  // Step 7: Normalize to [0, 1] — map [-maxAbs, +maxAbs] → [0, 1]
  let maxAbs = 0;
  for (let i = 0; i < size; i++) {
    const a = Math.abs(eigenvector[i]);
    if (a > maxAbs) maxAbs = a;
  }

  const normalizedEigenvector = new Float32Array(size);
  if (maxAbs > 0) {
    for (let i = 0; i < size; i++) {
      normalizedEigenvector[i] = (eigenvector[i] / maxAbs + 1) / 2;
    }
  } else {
    normalizedEigenvector.fill(0.5);
  }

  return { eigenvector, normalizedEigenvector, iterations, eigenvalue };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert CompartmentResult to a heatmap TrackConfig.
 *
 * Uses the existing blue-yellow-red heatmap palette in TrackRenderer:
 * 0 (B compartment) → blue, 1 (A compartment) → red.
 */
export function compartmentToTrack(
  result: CompartmentResult,
  overviewSize: number,
  textureSize: number,
): TrackConfig {
  const data = new Float32Array(textureSize);
  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    data[tp] = result.normalizedEigenvector[op];
  }

  return {
    name: 'A/B Compartments',
    type: 'heatmap',
    data,
    color: 'rgb(255, 100, 100)',
    height: 16,
    visible: true,
  };
}
