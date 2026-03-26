/**
 * CentromereDetector — Predict centromere positions from Hi-C contact maps.
 *
 * Implements the CenterFinder "Inter Row Sum" algorithm from Che et al. 2025
 * ("The evolution of high-order genome architecture revealed from 1,000 species").
 *
 * Centromeres create characteristic interaction hubs in Hi-C data: genomic
 * regions near the centromere tend to have elevated inter-chromosomal contacts
 * because centromeres cluster together at the nuclear periphery. This algorithm
 * detects these hubs by:
 *
 * 1. For each contig, compute the sum of contacts OUTSIDE the contig's own
 *    diagonal block (inter-contig contacts)
 * 2. Smooth the row sums with a Gaussian kernel
 * 3. Find the strongest local maximum — this is the predicted centromere
 *
 * The approach also detects intra-chromosomal "X-patterns" (anti-diagonal
 * signals) that indicate Rabl-like chromosome folding anchored at centromeres.
 *
 * Reference: https://github.com/xjtu-omics/HiArch
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';
import type { ContigRange } from '../curation/AutoSort';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CentromereParams {
  /** Smoothing kernel width as fraction of contig length. Default: 0.10. */
  kernelFraction: number;
  /** Minimum contig span (overview pixels) to attempt detection. Default: 8. */
  minContigSpan: number;
  /** Minimum peak prominence relative to contig mean. Default: 0.5. */
  minProminence: number;
  /** Weight for anti-diagonal signal (0 = inter-only, 1 = equal blend). Default: 0.3. */
  antiDiagonalWeight: number;
}

export interface CentromereResult {
  /** Predicted centromere positions (overview pixel indices). */
  positions: number[];
  /** Confidence score for each prediction (0-1). */
  confidences: number[];
  /** Contig orderIndex for each prediction. */
  contigIndices: number[];
  /** Per-bin centromere signal strength (overview size). */
  signalProfile: Float32Array;
}

const DEFAULT_PARAMS: CentromereParams = {
  kernelFraction: 0.10,
  minContigSpan: 8,
  minProminence: 0.5,
  antiDiagonalWeight: 0.3,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute inter-contig row sums for a single contig.
 * For each bin in the contig, sum contacts with bins OUTSIDE the contig block.
 */
function computeInterRowSums(
  contactMap: Float32Array,
  size: number,
  contigStart: number,
  contigEnd: number,
): Float64Array {
  const len = contigEnd - contigStart;
  const sums = new Float64Array(len);

  for (let i = 0; i < len; i++) {
    const row = contigStart + i;
    let sum = 0;
    // Sum contacts outside the contig's own block
    for (let j = 0; j < size; j++) {
      if (j < contigStart || j >= contigEnd) {
        sum += contactMap[row * size + j];
      }
    }
    sums[i] = sum;
  }

  return sums;
}

/**
 * Compute anti-diagonal signal strength within a contig block.
 * Anti-diagonal patterns indicate centromere-anchored Rabl folding.
 * For each bin, measure the ratio of anti-diagonal to diagonal contacts
 * in a local window.
 */
function computeAntiDiagonalSignal(
  contactMap: Float32Array,
  size: number,
  contigStart: number,
  contigEnd: number,
): Float64Array {
  const len = contigEnd - contigStart;
  const signal = new Float64Array(len);
  const windowSize = Math.max(2, Math.floor(len * 0.15));

  for (let i = 0; i < len; i++) {
    const row = contigStart + i;
    let antiDiagSum = 0;
    let diagSum = 0;
    let count = 0;

    for (let d = 1; d <= windowSize && d < len; d++) {
      // Diagonal: (row, row+d) — nearby contacts
      const diagCol = contigStart + i + d;
      if (diagCol < contigEnd) {
        diagSum += contactMap[row * size + diagCol];
      }
      // Anti-diagonal: contacts reflected across the contig midpoint
      const mid = (contigStart + contigEnd) / 2;
      const antiRow = Math.round(2 * mid - row);
      const antiCol = contigStart + i + d;
      if (antiRow >= contigStart && antiRow < contigEnd && antiCol < contigEnd) {
        antiDiagSum += contactMap[antiRow * size + antiCol];
      }
      count++;
    }

    // Anti-diagonal ratio: high where centromere creates X-pattern
    if (diagSum > 0 && count > 0) {
      signal[i] = antiDiagSum / diagSum;
    }
  }

  return signal;
}

/**
 * Apply Gaussian smoothing to an array.
 */
function gaussianSmooth(data: Float64Array, kernelRadius: number): Float64Array {
  const len = data.length;
  const result = new Float64Array(len);
  const sigma = kernelRadius / 3;
  const sigma2 = 2 * sigma * sigma;

  for (let i = 0; i < len; i++) {
    let sum = 0;
    let weightSum = 0;
    const start = Math.max(0, i - kernelRadius);
    const end = Math.min(len - 1, i + kernelRadius);

    for (let j = start; j <= end; j++) {
      const dist = i - j;
      const weight = Math.exp(-(dist * dist) / sigma2);
      sum += data[j] * weight;
      weightSum += weight;
    }

    result[i] = weightSum > 0 ? sum / weightSum : 0;
  }

  return result;
}

/**
 * Z-normalize an array (mean=0, std=1).
 */
function zNormalize(data: Float64Array): Float64Array {
  const len = data.length;
  if (len === 0) return data;

  let mean = 0;
  for (let i = 0; i < len; i++) mean += data[i];
  mean /= len;

  let variance = 0;
  for (let i = 0; i < len; i++) {
    const d = data[i] - mean;
    variance += d * d;
  }
  variance /= len;
  const std = Math.sqrt(variance);

  const result = new Float64Array(len);
  if (std > 0) {
    for (let i = 0; i < len; i++) {
      result[i] = (data[i] - mean) / std;
    }
  }
  return result;
}

/**
 * Find the strongest local maximum in a signal.
 * Returns the index and its prominence.
 */
function findStrongestPeak(
  data: Float64Array,
): { index: number; prominence: number } | null {
  const len = data.length;
  if (len < 3) return null;

  let bestIdx = -1;
  let bestValue = -Infinity;

  for (let i = 1; i < len - 1; i++) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
      if (data[i] > bestValue) {
        bestValue = data[i];
        bestIdx = i;
      }
    }
  }

  if (bestIdx < 0) {
    // No local max found; use global max
    for (let i = 0; i < len; i++) {
      if (data[i] > bestValue) {
        bestValue = data[i];
        bestIdx = i;
      }
    }
  }

  if (bestIdx < 0) return null;

  // Compute prominence: drop from peak to nearest valleys
  let leftMin = bestValue;
  for (let i = bestIdx - 1; i >= 0; i--) {
    if (data[i] < leftMin) leftMin = data[i];
  }
  let rightMin = bestValue;
  for (let i = bestIdx + 1; i < len; i++) {
    if (data[i] < rightMin) rightMin = data[i];
  }
  const prominence = bestValue - Math.max(leftMin, rightMin);

  return { index: bestIdx, prominence };
}

/**
 * Detect predicted centromere positions from a Hi-C contact map.
 */
export function detectCentromeres(
  contactMap: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  params?: Partial<CentromereParams>,
): CentromereResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  const positions: number[] = [];
  const confidences: number[] = [];
  const contigIndices: number[] = [];
  const signalProfile = new Float32Array(size);

  for (const range of contigRanges) {
    const len = range.end - range.start;
    if (len < p.minContigSpan) continue;

    const kernelRadius = Math.max(1, Math.round(len * p.kernelFraction));

    // Step 1: Inter-contig row sums
    const interSums = computeInterRowSums(contactMap, size, range.start, range.end);

    // Step 2: Anti-diagonal signal (optional blend)
    let combinedSignal: Float64Array;
    if (p.antiDiagonalWeight > 0) {
      const antiDiag = computeAntiDiagonalSignal(contactMap, size, range.start, range.end);
      const normInter = zNormalize(interSums);
      const normAnti = zNormalize(antiDiag);
      combinedSignal = new Float64Array(len);
      const w = p.antiDiagonalWeight;
      for (let i = 0; i < len; i++) {
        combinedSignal[i] = normInter[i] * (1 - w) + normAnti[i] * w;
      }
    } else {
      combinedSignal = interSums;
    }

    // Step 3: Smooth
    const smoothed = gaussianSmooth(combinedSignal, kernelRadius);

    // Step 4: Z-normalize
    const normalized = zNormalize(smoothed);

    // Step 5: Find strongest peak
    const peak = findStrongestPeak(normalized);
    if (!peak) continue;

    // Step 6: Filter by prominence
    if (peak.prominence < p.minProminence) continue;

    const globalPixel = range.start + peak.index;
    positions.push(globalPixel);

    // Confidence: prominence clamped to [0, 1], scaled by 1/(1+exp(-x))
    const rawConf = peak.prominence;
    const confidence = Math.min(1, rawConf / 3); // prominence of 3+ = max confidence
    confidences.push(confidence);
    contigIndices.push(range.orderIndex);

    // Write smoothed signal to global profile
    for (let i = 0; i < len; i++) {
      const val = normalized[i];
      signalProfile[range.start + i] = Math.max(0, val / 3); // scale to ~[0,1]
    }
  }

  return { positions, confidences, contigIndices, signalProfile };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert CentromereResult to TrackConfig objects for TrackRenderer.
 *
 * Produces:
 * 1. "Centromere Signal" — line track showing inter-contig contact hub strength
 * 2. "Centromeres" — marker track at predicted positions
 */
export function centromereToTracks(
  result: CentromereResult,
  overviewSize: number,
  textureSize: number,
): { signalTrack: TrackConfig; markerTrack: TrackConfig } {
  // Build signal data mapped to textureSize
  const signalData = new Float32Array(textureSize);
  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    signalData[tp] = result.signalProfile[op];
  }

  // Build centromere marker array
  const markerData = new Float32Array(textureSize);
  for (const pos of result.positions) {
    const tp = Math.round((pos / overviewSize) * textureSize);
    if (tp >= 0 && tp < textureSize) {
      markerData[tp] = 1;
    }
  }

  return {
    signalTrack: {
      name: 'Centromere Signal',
      data: signalData,
      color: '#e056a0',
      type: 'line',
      visible: true,
      height: 25,
    },
    markerTrack: {
      name: 'Centromeres',
      data: markerData,
      color: '#e056a0',
      type: 'marker',
      visible: true,
      height: 25,
    },
  };
}
