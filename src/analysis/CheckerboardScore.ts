/**
 * CheckerboardScore — Information-entropy-based compartment regularity metric.
 *
 * Implements the checkerboard ("accordance") score from Che et al., Cell (2026),
 * "The evolution of high-order genome architecture revealed from 1,000 species"
 * (preprint: bioRxiv 2025.07.05.663309). Quantifies how strongly a contact map
 * exhibits the alternating A/B compartment "checkerboard" pattern.
 *
 * Score direction: the entropy of the pairwise cosine-distance histogram is used
 * directly, with NO inversion — higher entropy = stronger checkerboard. This is
 * verified against the HiArch reference implementation (`S2_get_entro.py`
 * returns `scipy.stats.entropy(histogram)` directly) and the paper, which states
 * "higher entropy reflects stronger segregation of active and inactive
 * compartments". Here it is rescaled to [0, 100] via `(entropy / ln(numBins)) *
 * 100`; HiArch reports the raw entropy (~2.3-3.0 range).
 *
 * Faithful to HiArch: cosine distance between rows (their `pdist(metric='cosine')`),
 * histogram bins over [0, 1.6] with 30 bins, short-distance band at 15% of
 * chromosome size. One difference: HiArch trims the distances at the 2nd/98th
 * percentile before histogramming; this port does not, which shifts the absolute
 * value slightly but not the direction.
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
  /** Minimum samples before computing entropy on the WHOLE-GENOME fallback path.
   *  Does not govern the per-chromosome path (see minSamplesPerChromosome).
   *  Default: 200. */
  minSamples: number;
  /** Minimum valid samples for a chromosome to contribute on the per-chromosome
   *  path. Kept at the historical value so the entropy scale is unchanged; note
   *  that 10 is arguably low for a numBins-wide histogram, and raising it would
   *  move the reported numbers, so tune deliberately. Default: 10. */
  minSamplesPerChromosome: number;
}

export interface CheckerboardResult {
  /** Raw Shannon entropy of the cosine-distance histogram. Mapped directly to
   *  `score` (higher entropy -> higher score); see the module header. */
  entropy: number;
  /** Normalized score 0-100 = (entropy / maxEntropy) * 100. Higher entropy is
   *  treated as a stronger checkerboard pattern (no inversion). */
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
  minSamplesPerChromosome: 10,
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
  // An all-zero row (empty scaffold / microchromosome) has no defined cosine
  // distance. Return NaN so callers skip it, rather than a fixed 1.0 that would
  // flood the histogram with "no data" values indistinguishable from real ones
  // and bias the entropy toward whatever the empty fraction is.
  if (denom === 0) return NaN;
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
 * HiArch algorithm (Che et al., Cell 2026) and produces entropy values on the same
 * scale as the 1,025-species reference (2.3–3.0).
 *
 * Without chromosomeRanges, operates on the whole-genome overview. This mixes
 * intra- and inter-chromosomal contacts and produces artificially low entropy
 * for genomes with many small chromosomes, which is not comparable to HiArch.
 *
 * Algorithm (Che et al., Cell 2026):
 * 1. For each chromosome, compute cosine distances between row pairs at
 *    diagonal offsets d within [5%, 15%] of chromosome size, restricted to
 *    intra-chromosomal columns
 * 2. Compute Shannon entropy of the cosine distance histogram per chromosome
 * 3. Average per-chromosome entropies
 * 4. Map entropy directly to a 0-100 score (higher entropy -> higher score)
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
        const cd = cosineDistanceSubset(contactMap, size, i, i + d, cs, ce);
        if (Number.isFinite(cd)) samples.push(cd);
      }
    }

    if (samples.length < p.minSamplesPerChromosome) continue;

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
      const cd = cosineDistance(contactMap, size, i, i + d);
      if (Number.isFinite(cd)) samples.push(cd);
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
