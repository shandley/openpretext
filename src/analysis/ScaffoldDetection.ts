/**
 * ScaffoldDetection — Auto-detect chromosome blocks from block-diagonal structure.
 *
 * In a well-ordered Hi-C contact map, chromosomes appear as bright squares
 * along the diagonal. Adjacent contigs within a chromosome have high mutual
 * contact; at chromosome boundaries contact drops sharply. We detect those
 * drops to find chromosome boundaries and group contigs into blocks.
 */

import type { ContigInfo } from '../core/State';
import type { ContigRange } from '../curation/AutoSort';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChromosomeBlock {
  /** First order-index in this block. */
  startIndex: number;
  /** Last order-index (inclusive). */
  endIndex: number;
  /** Number of contigs in this block. */
  contigCount: number;
}

export interface ScaffoldDetectionResult {
  /** Detected chromosome blocks. */
  blocks: ChromosomeBlock[];
  /** Normalized inter-contig contact score for each adjacent pair (length = n-1). */
  interContigScores: Float64Array;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build overview pixel ranges for each contig (same pattern as AutoSort). */
function buildRanges(
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  overviewSize: number,
): ContigRange[] {
  const ranges: ContigRange[] = [];
  let accumulated = 0;
  for (let i = 0; i < contigOrder.length; i++) {
    const contigId = contigOrder[i];
    const contig = contigs[contigId];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;
    const start = Math.round((accumulated / textureSize) * overviewSize);
    accumulated += contigPixelLength;
    const end = Math.round((accumulated / textureSize) * overviewSize);
    ranges.push({ start, end, orderIndex: i });
  }
  return ranges;
}

/** Mean contact in the off-diagonal rectangle between two contig ranges. */
function meanContact(
  contactMap: Float32Array,
  size: number,
  a: ContigRange,
  b: ContigRange,
): number {
  // Ensure a is above b (row < col) for upper-triangular access
  const rowRange = a.start < b.start ? a : b;
  const colRange = a.start < b.start ? b : a;

  let sum = 0;
  let count = 0;
  for (let r = rowRange.start; r < rowRange.end; r++) {
    for (let c = colRange.start; c < colRange.end; c++) {
      sum += contactMap[r * size + c];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Compute median of an array of numbers. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

/**
 * Detect chromosome-scale blocks from the contact map's block-diagonal structure.
 *
 * Algorithm:
 * 1. Build overview pixel ranges for each contig
 * 2. Compute mean contact in the off-diagonal rectangle for each adjacent pair
 * 3. Normalize scores to [0, 1]
 * 4. Find boundaries where score drops below adaptive threshold
 * 5. Group contigs between boundaries into ChromosomeBlocks
 */
export function detectChromosomeBlocks(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
): ScaffoldDetectionResult {
  const n = contigOrder.length;

  if (n <= 1) {
    // Single contig or empty — one block
    return {
      blocks: n === 1 ? [{ startIndex: 0, endIndex: 0, contigCount: 1 }] : [],
      interContigScores: new Float64Array(0),
    };
  }

  const ranges = buildRanges(contigs, contigOrder, textureSize, size);

  // Compute inter-contig contact scores for each adjacent pair
  const rawScores = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = ranges[i];
    const b = ranges[i + 1];
    // Skip pairs where either range spans ≤1 pixel
    if (a.end - a.start <= 1 || b.end - b.start <= 1) {
      rawScores[i] = 0;
      continue;
    }
    rawScores[i] = meanContact(contactMap, size, a, b);
  }

  // Normalize by max score
  let maxScore = 0;
  for (let i = 0; i < rawScores.length; i++) {
    if (rawScores[i] > maxScore) maxScore = rawScores[i];
  }

  const normalizedScores = new Float64Array(n - 1);
  if (maxScore > 0) {
    for (let i = 0; i < rawScores.length; i++) {
      normalizedScores[i] = rawScores[i] / maxScore;
    }
  }

  // Find boundaries using adaptive threshold
  const scoreValues: number[] = [];
  for (let i = 0; i < normalizedScores.length; i++) {
    scoreValues.push(normalizedScores[i]);
  }
  const threshold = median(scoreValues) * 0.3;

  // A boundary is between contig i and i+1 when score[i] < threshold
  const boundaryIndices: number[] = [];
  for (let i = 0; i < normalizedScores.length; i++) {
    if (normalizedScores[i] < threshold) {
      boundaryIndices.push(i);
    }
  }

  // Build blocks from boundary positions
  const blocks: ChromosomeBlock[] = [];
  let blockStart = 0;
  for (const bi of boundaryIndices) {
    // Block from blockStart to bi (inclusive)
    const contigCount = bi - blockStart + 1;
    if (contigCount >= 1) {
      blocks.push({ startIndex: blockStart, endIndex: bi, contigCount });
    }
    blockStart = bi + 1;
  }
  // Final block
  if (blockStart < n) {
    const contigCount = n - blockStart;
    blocks.push({ startIndex: blockStart, endIndex: n - 1, contigCount });
  }

  return { blocks, interContigScores: normalizedScores };
}
