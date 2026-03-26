/**
 * CheckerboardScore — Information-entropy-based compartment regularity metric.
 *
 * Implements the checkerboard score from Che et al. 2025 ("The evolution of
 * high-order genome architecture revealed from 1,000 species"). Quantifies
 * how strongly a contact map exhibits the alternating A/B compartment
 * "checkerboard" pattern using cosine distance + Shannon entropy.
 *
 * Lower entropy = stronger, more regular compartment pattern.
 * Higher entropy = more random/disordered contacts.
 *
 * The score is inverted and normalized to [0, 100] for display:
 * 0 = no compartmentalization, 100 = perfectly regular checkerboard.
 *
 * Reference: https://github.com/xjtu-omics/HiArch
 *
 * Pure algorithm — no side effects or state mutations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckerboardParams {
  /** Minimum diagonal distance as fraction of map size. Default: 0.05. */
  minDistanceFraction: number;
  /** Maximum diagonal distance as fraction of map size. Default: 0.15. */
  maxDistanceFraction: number;
  /** Number of histogram bins. Default: 30. */
  numBins: number;
  /** Maximum cosine distance for histogram range. Default: 1.6. */
  maxDistance: number;
  /** Minimum number of samples before computing entropy. Default: 200. */
  minSamples: number;
}

export interface CheckerboardResult {
  /** Raw Shannon entropy of cosine distance distribution. Lower = stronger pattern. */
  entropy: number;
  /** Normalized score 0-100. Higher = stronger checkerboard pattern. */
  score: number;
  /** Per-bin cosine distance adjacency values (for the last computed batch). */
  distanceHistogram: Float32Array;
  /** Histogram bin edges. */
  binEdges: Float32Array;
  /** Number of chromosome-level entries analyzed. */
  numChromosomes: number;
}

const DEFAULT_PARAMS: CheckerboardParams = {
  minDistanceFraction: 0.05,
  maxDistanceFraction: 0.15,
  numBins: 30,
  maxDistance: 1.6,
  minSamples: 200,
};

// Theoretical max entropy for a uniform distribution over numBins bins
function maxEntropy(numBins: number): number {
  return Math.log(numBins);
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute the L2 norm of a Float32Array slice viewed as a vector.
 */
function vectorNorm(arr: Float32Array, offset: number, length: number): number {
  let sum = 0;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    sum += arr[i] * arr[i];
  }
  return Math.sqrt(sum);
}

/**
 * Compute cosine distance between two rows of the contact map.
 * cosine_distance = 1 - (a · b) / (|a| * |b|)
 */
function cosineDistance(
  contactMap: Float32Array,
  size: number,
  row1: number,
  row2: number,
): number {
  let dot = 0;
  const offset1 = row1 * size;
  const offset2 = row2 * size;
  for (let j = 0; j < size; j++) {
    dot += contactMap[offset1 + j] * contactMap[offset2 + j];
  }
  const norm1 = vectorNorm(contactMap, offset1, size);
  const norm2 = vectorNorm(contactMap, offset2, size);
  const denom = norm1 * norm2;
  if (denom === 0) return 1.0; // orthogonal if either is zero
  const similarity = dot / denom;
  // Clamp to [0, 2] range for cosine distance
  return Math.max(0, Math.min(2, 1 - similarity));
}

/**
 * Compute Shannon entropy of a probability distribution.
 */
function shannonEntropy(probabilities: Float64Array): number {
  let h = 0;
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i];
    if (p > 0) {
      h -= p * Math.log(p);
    }
  }
  return h;
}

/**
 * Compute the checkerboard score for a contact map.
 *
 * Algorithm (Che et al. 2025):
 * 1. For each pair of rows at diagonal offset d (within min/max range),
 *    compute cosine distance
 * 2. Accumulate distances; when batch reaches minSamples, compute entropy
 * 3. Average entropies across all batches
 * 4. Convert to a 0-100 score (inverted: low entropy = high score)
 */
export function computeCheckerboardScore(
  contactMap: Float32Array,
  size: number,
  params?: Partial<CheckerboardParams>,
): CheckerboardResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  const minDist = Math.max(1, Math.round(size * p.minDistanceFraction));
  const maxDist = Math.max(minDist + 1, Math.round(size * p.maxDistanceFraction));
  const binWidth = p.maxDistance / p.numBins;

  // Collect entropies per batch of diagonal distances
  const entropies: number[] = [];
  let samples: number[] = [];
  let lastHistogram = new Float32Array(p.numBins);

  for (let d = minDist; d < maxDist && d < size; d++) {
    // Extract cosine distances at this diagonal offset
    for (let i = 0; i + d < size; i++) {
      const dist = cosineDistance(contactMap, size, i, i + d);
      samples.push(dist);
    }

    // When we have enough samples, compute entropy for this batch
    if (samples.length >= p.minSamples) {
      const histogram = new Float64Array(p.numBins);
      for (const s of samples) {
        const bin = Math.min(Math.floor(s / binWidth), p.numBins - 1);
        histogram[bin]++;
      }
      // Normalize to probabilities
      const total = samples.length;
      for (let b = 0; b < p.numBins; b++) {
        histogram[b] /= total;
      }
      entropies.push(shannonEntropy(histogram));

      // Save last histogram for visualization
      for (let b = 0; b < p.numBins; b++) {
        lastHistogram[b] = histogram[b];
      }

      samples = [];
    }
  }

  // Handle remaining samples if we never reached minSamples
  if (entropies.length === 0 && samples.length > 0) {
    const histogram = new Float64Array(p.numBins);
    for (const s of samples) {
      const bin = Math.min(Math.floor(s / binWidth), p.numBins - 1);
      histogram[bin]++;
    }
    const total = samples.length;
    for (let b = 0; b < p.numBins; b++) {
      histogram[b] /= total;
    }
    entropies.push(shannonEntropy(histogram));
    for (let b = 0; b < p.numBins; b++) {
      lastHistogram[b] = histogram[b];
    }
  }

  // Average entropy across batches
  const entropy =
    entropies.length > 0
      ? entropies.reduce((a, b) => a + b, 0) / entropies.length
      : maxEntropy(p.numBins); // maximum entropy if no data

  // Convert to 0-100 score: low entropy = high score
  const maxH = maxEntropy(p.numBins);
  const score = Math.max(0, Math.min(100, ((maxH - entropy) / maxH) * 100));

  // Build bin edges array
  const binEdges = new Float32Array(p.numBins + 1);
  for (let i = 0; i <= p.numBins; i++) {
    binEdges[i] = i * binWidth;
  }

  return {
    entropy,
    score,
    distanceHistogram: lastHistogram,
    binEdges,
    numChromosomes: entropies.length,
  };
}
