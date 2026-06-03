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
  /**
   * When chromosomeRanges are provided: number of chromosomes with sufficient
   * data. Otherwise: number of entropy batches from whole-genome sampling.
   */
  numChromosomes: number;
}

/** Pixel range for one chromosome/scaffold in the overview contact map. */
export interface ChromosomeRange {
  start: number;
  end: number;
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
 * Compute cosine distance between two rows of the contact map using all columns.
 */
function cosineDistance(
  contactMap: Float32Array,
  size: number,
  row1: number,
  row2: number,
): number {
  return cosineDistanceSubset(contactMap, size, row1, row2, 0, size);
}

/**
 * Compute cosine distance between two rows restricted to columns [colStart, colEnd).
 * Used for per-chromosome checkerboard to exclude inter-chromosomal contacts.
 */
function cosineDistanceSubset(
  contactMap: Float32Array,
  size: number,
  row1: number,
  row2: number,
  colStart: number,
  colEnd: number,
): number {
  const len = colEnd - colStart;
  const off1 = row1 * size + colStart;
  const off2 = row2 * size + colStart;
  let dot = 0;
  for (let k = 0; k < len; k++) {
    dot += contactMap[off1 + k] * contactMap[off2 + k];
  }
  const norm1 = vectorNorm(contactMap, off1, len);
  const norm2 = vectorNorm(contactMap, off2, len);
  const denom = norm1 * norm2;
  if (denom === 0) return 1.0;
  return Math.max(0, Math.min(2, 1 - dot / denom));
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
 * When chromosomeRanges are provided (recommended), computes per-chromosome
 * by restricting both row and column sampling to within each chromosome's
 * pixel range, then averages the per-chromosome entropies. This matches the
 * HiArch algorithm (Che et al. 2026) and produces entropy values on the same
 * scale as the 1,025-species reference (2.3–3.0).
 *
 * Without chromosomeRanges, operates on the whole-genome overview. This mixes
 * intra- and inter-chromosomal contacts and produces artificially low entropy
 * for genomes with many small chromosomes, which is not comparable to HiArch.
 *
 * Algorithm (Che et al. 2026):
 * 1. For each chromosome, compute cosine distances between row pairs at
 *    diagonal offsets d within [5%, 15%] of chromosome size, restricted to
 *    intra-chromosomal columns
 * 2. Compute Shannon entropy of the cosine distance histogram per chromosome
 * 3. Average per-chromosome entropies
 * 4. Convert to 0-100 score (inverted: lower entropy = higher score)
 */
export function computeCheckerboardScore(
  contactMap: Float32Array,
  size: number,
  params?: Partial<CheckerboardParams>,
  chromosomeRanges?: ChromosomeRange[],
): CheckerboardResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (chromosomeRanges && chromosomeRanges.length >= 2) {
    return computeCheckerboardPerChromosome(contactMap, size, chromosomeRanges, p);
  }

  return computeCheckerboardWholeGenome(contactMap, size, p);
}

// ---------------------------------------------------------------------------
// Per-chromosome implementation (correct, matches HiArch scale)
// ---------------------------------------------------------------------------

function computeCheckerboardPerChromosome(
  contactMap: Float32Array,
  size: number,
  chromosomeRanges: ChromosomeRange[],
  p: CheckerboardParams,
): CheckerboardResult {
  const binWidth = p.maxDistance / p.numBins;
  const entropies: number[] = [];
  let lastHistogram = new Float32Array(p.numBins);

  for (const { start: cs, end: ce } of chromosomeRanges) {
    const chrSize = ce - cs;
    if (chrSize < 5) continue;

    const minDist = Math.max(1, Math.round(chrSize * p.minDistanceFraction));
    const maxDist = Math.max(minDist + 1, Math.round(chrSize * p.maxDistanceFraction));

    const samples: number[] = [];
    for (let d = minDist; d < maxDist && d < chrSize; d++) {
      for (let i = cs; i + d < ce; i++) {
        samples.push(cosineDistanceSubset(contactMap, size, i, i + d, cs, ce));
      }
    }

    if (samples.length < 10) continue;

    const histogram = new Float64Array(p.numBins);
    for (const s of samples) {
      histogram[Math.min(Math.floor(s / binWidth), p.numBins - 1)]++;
    }
    const total = samples.length;
    for (let b = 0; b < p.numBins; b++) histogram[b] /= total;

    entropies.push(shannonEntropy(histogram));
    for (let b = 0; b < p.numBins; b++) lastHistogram[b] = histogram[b];
  }

  // Fall back to whole-genome if no chromosomes had sufficient data
  if (entropies.length === 0) {
    return computeCheckerboardWholeGenome(contactMap, size, p);
  }

  const entropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
  const maxH = maxEntropy(p.numBins);
  // Higher entropy = more varied cosine distances = stronger A/B alternation = higher score.
  // This matches the HiArch reference scale where mammals (2.88) score above fungi (2.50).
  const score = Math.max(0, Math.min(100, (entropy / maxH) * 100));

  const binEdges = new Float32Array(p.numBins + 1);
  for (let i = 0; i <= p.numBins; i++) binEdges[i] = i * binWidth;

  return { entropy, score, distanceHistogram: lastHistogram, binEdges, numChromosomes: entropies.length };
}

// ---------------------------------------------------------------------------
// Whole-genome fallback (original behavior, not HiArch-comparable)
// ---------------------------------------------------------------------------

function computeCheckerboardWholeGenome(
  contactMap: Float32Array,
  size: number,
  p: CheckerboardParams,
): CheckerboardResult {
  const minDist = Math.max(1, Math.round(size * p.minDistanceFraction));
  const maxDist = Math.max(minDist + 1, Math.round(size * p.maxDistanceFraction));
  const binWidth = p.maxDistance / p.numBins;

  const entropies: number[] = [];
  let samples: number[] = [];
  let lastHistogram = new Float32Array(p.numBins);

  for (let d = minDist; d < maxDist && d < size; d++) {
    for (let i = 0; i + d < size; i++) {
      samples.push(cosineDistance(contactMap, size, i, i + d));
    }

    if (samples.length >= p.minSamples) {
      const histogram = new Float64Array(p.numBins);
      for (const s of samples) {
        histogram[Math.min(Math.floor(s / binWidth), p.numBins - 1)]++;
      }
      const total = samples.length;
      for (let b = 0; b < p.numBins; b++) histogram[b] /= total;
      entropies.push(shannonEntropy(histogram));
      for (let b = 0; b < p.numBins; b++) lastHistogram[b] = histogram[b];
      samples = [];
    }
  }

  if (entropies.length === 0 && samples.length > 0) {
    const histogram = new Float64Array(p.numBins);
    for (const s of samples) {
      histogram[Math.min(Math.floor(s / binWidth), p.numBins - 1)]++;
    }
    const total = samples.length;
    for (let b = 0; b < p.numBins; b++) histogram[b] /= total;
    entropies.push(shannonEntropy(histogram));
    for (let b = 0; b < p.numBins; b++) lastHistogram[b] = histogram[b];
  }

  const entropy =
    entropies.length > 0
      ? entropies.reduce((a, b) => a + b, 0) / entropies.length
      : 0;

  const maxH = maxEntropy(p.numBins);
  const score = Math.max(0, Math.min(100, (entropy / maxH) * 100));

  const binEdges = new Float32Array(p.numBins + 1);
  for (let i = 0; i <= p.numBins; i++) binEdges[i] = i * binWidth;

  return { entropy, score, distanceHistogram: lastHistogram, binEdges, numChromosomes: entropies.length };
}
