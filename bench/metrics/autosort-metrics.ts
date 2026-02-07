/**
 * Ordering accuracy metrics for AutoSort evaluation.
 *
 * Pure-math functions (kendallTau, adjustedRandIndex, longestCorrectRun)
 * are imported from the shared src/curation/OrderingMetrics module.
 * Chain-dependent functions remain here since they use AutoSort internals.
 */

import type { ChainEntry } from '../../src/curation/AutoSort';
import {
  kendallTau as _kendallTau,
  adjustedRandIndex as _adjustedRandIndex,
  longestCorrectRun as _longestCorrectRun,
} from '../../src/curation/OrderingMetrics';

// Re-export pure math metrics from the shared module
export { kendallTau, adjustedRandIndex, longestCorrectRun } from '../../src/curation/OrderingMetrics';

export interface SortMetrics {
  /** Kendall's tau rank correlation (-1 to 1). */
  kendallTau: number;
  /** Adjusted Rand Index for chromosome clustering (0 to 1). */
  adjustedRandIndex: number;
  /** Fraction of contigs with correct orientation. */
  orientationAccuracy: number;
  /** Average fraction of each chain from a single true chromosome. */
  chainPurity: number;
  /** Average fraction of each true chromosome in a single chain. */
  chainCompleteness: number;
  /** Longest contiguous subsequence matching ground truth order. */
  longestCorrectRun: number;
}

/**
 * Compute orientation accuracy: fraction of contigs with correct inversion state.
 *
 * @param predictedChains - Predicted chains from autoSort.
 * @param groundTruthInversions - Map from contigOrder index to expected inversion state.
 */
export function orientationAccuracy(
  predictedChains: ChainEntry[][],
  groundTruthInversions: Map<number, boolean>,
): number {
  let correct = 0;
  let total = 0;

  for (const chain of predictedChains) {
    for (const entry of chain) {
      const expected = groundTruthInversions.get(entry.orderIndex);
      if (expected !== undefined) {
        if (entry.inverted === expected) correct++;
        total++;
      }
    }
  }

  return total > 0 ? correct / total : 1;
}

/**
 * Compute chain purity: average fraction of each predicted chain
 * that comes from a single true chromosome.
 *
 * @param predictedChains - Predicted chains.
 * @param trueChromAssignments - Contig order index -> chromosome index.
 */
export function chainPurity(
  predictedChains: ChainEntry[][],
  trueChromAssignments: number[],
): number {
  if (predictedChains.length === 0) return 0;

  let totalPurity = 0;

  for (const chain of predictedChains) {
    if (chain.length === 0) continue;
    const chromCounts = new Map<number, number>();
    for (const entry of chain) {
      const chrom = trueChromAssignments[entry.orderIndex] ?? -1;
      chromCounts.set(chrom, (chromCounts.get(chrom) ?? 0) + 1);
    }
    const maxCount = Math.max(...chromCounts.values());
    totalPurity += maxCount / chain.length;
  }

  return totalPurity / predictedChains.length;
}

/**
 * Compute chain completeness: average fraction of each true chromosome
 * that is captured in a single predicted chain.
 *
 * @param predictedChains - Predicted chains.
 * @param trueChromAssignments - Contig order index -> chromosome index.
 */
export function chainCompleteness(
  predictedChains: ChainEntry[][],
  trueChromAssignments: number[],
): number {
  const chromGroups = new Map<number, number[]>();
  for (let i = 0; i < trueChromAssignments.length; i++) {
    const chrom = trueChromAssignments[i];
    if (!chromGroups.has(chrom)) chromGroups.set(chrom, []);
    chromGroups.get(chrom)!.push(i);
  }

  if (chromGroups.size === 0) return 0;

  let totalCompleteness = 0;

  for (const [, members] of chromGroups) {
    const memberSet = new Set(members);
    let bestFraction = 0;

    for (const chain of predictedChains) {
      let count = 0;
      for (const entry of chain) {
        if (memberSet.has(entry.orderIndex)) count++;
      }
      bestFraction = Math.max(bestFraction, count / members.length);
    }

    totalCompleteness += bestFraction;
  }

  return totalCompleteness / chromGroups.size;
}

/**
 * Compute all sort metrics at once.
 */
export function computeSortMetrics(
  predictedChains: ChainEntry[][],
  groundTruthOrder: number[],
  trueChromAssignments: number[],
  groundTruthInversions: Map<number, boolean>,
): SortMetrics {
  // Flatten predicted chains into a single ordering
  const predictedOrder = predictedChains.flatMap(chain =>
    chain.map(e => e.orderIndex),
  );

  // Build predicted chromosome assignments from chains
  const predictedChromAssignments = new Array<number>(
    Math.max(predictedOrder.length, trueChromAssignments.length),
  ).fill(0);
  for (let chainIdx = 0; chainIdx < predictedChains.length; chainIdx++) {
    for (const entry of predictedChains[chainIdx]) {
      if (entry.orderIndex < predictedChromAssignments.length) {
        predictedChromAssignments[entry.orderIndex] = chainIdx;
      }
    }
  }

  return {
    kendallTau: _kendallTau(predictedOrder, groundTruthOrder),
    adjustedRandIndex: _adjustedRandIndex(predictedChromAssignments, trueChromAssignments),
    orientationAccuracy: orientationAccuracy(predictedChains, groundTruthInversions),
    chainPurity: chainPurity(predictedChains, trueChromAssignments),
    chainCompleteness: chainCompleteness(predictedChains, trueChromAssignments),
    longestCorrectRun: _longestCorrectRun(predictedOrder, groundTruthOrder),
  };
}
