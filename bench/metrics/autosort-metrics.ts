/**
 * Ordering accuracy metrics for AutoSort evaluation.
 *
 * Compares predicted contig chain order to ground truth using
 * rank correlation, clustering agreement, and orientation accuracy.
 */

import type { ChainEntry } from '../../src/curation/AutoSort';

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
 * Compute Kendall's tau rank correlation between two orderings.
 *
 * Tau = (concordant - discordant) / (n * (n-1) / 2)
 *
 * @param predicted - Predicted ordering (array of contig indices).
 * @param groundTruth - Ground truth ordering (array of contig indices).
 * @returns Kendall's tau in [-1, 1].
 */
export function kendallTau(predicted: number[], groundTruth: number[]): number {
  if (predicted.length <= 1) return 1;

  // Build rank map from ground truth
  const rankMap = new Map<number, number>();
  for (let i = 0; i < groundTruth.length; i++) {
    rankMap.set(groundTruth[i], i);
  }

  // Map predicted to ranks in ground truth space
  const ranks: number[] = [];
  for (const p of predicted) {
    const rank = rankMap.get(p);
    if (rank !== undefined) ranks.push(rank);
  }

  const n = ranks.length;
  if (n <= 1) return 1;

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (ranks[i] < ranks[j]) concordant++;
      else if (ranks[i] > ranks[j]) discordant++;
    }
  }

  const totalPairs = (n * (n - 1)) / 2;
  return totalPairs > 0 ? (concordant - discordant) / totalPairs : 0;
}

/**
 * Compute the Adjusted Rand Index (ARI) between two clusterings.
 *
 * ARI measures the similarity between two partitions, adjusted for chance.
 * ARI = 1 for identical clusterings, ~0 for random, negative for worse than random.
 *
 * @param predicted - Predicted cluster assignments (array indexed by contig).
 * @param groundTruth - Ground truth cluster assignments.
 */
export function adjustedRandIndex(predicted: number[], groundTruth: number[]): number {
  const n = Math.min(predicted.length, groundTruth.length);
  if (n <= 1) return 1;

  // Build contingency table
  const predClusters = new Map<number, number[]>();
  const gtClusters = new Map<number, number[]>();

  for (let i = 0; i < n; i++) {
    if (!predClusters.has(predicted[i])) predClusters.set(predicted[i], []);
    predClusters.get(predicted[i])!.push(i);
    if (!gtClusters.has(groundTruth[i])) gtClusters.set(groundTruth[i], []);
    gtClusters.get(groundTruth[i])!.push(i);
  }

  const predLabels = [...predClusters.keys()];
  const gtLabels = [...gtClusters.keys()];

  // Build contingency matrix n_ij
  const contingency: number[][] = [];
  for (const pLabel of predLabels) {
    const row: number[] = [];
    const pSet = new Set(predClusters.get(pLabel)!);
    for (const gLabel of gtLabels) {
      const gMembers = gtClusters.get(gLabel)!;
      let overlap = 0;
      for (const m of gMembers) {
        if (pSet.has(m)) overlap++;
      }
      row.push(overlap);
    }
    contingency.push(row);
  }

  // Compute ARI using the formula
  const choose2 = (x: number) => (x * (x - 1)) / 2;

  let sumNij2 = 0;
  for (const row of contingency) {
    for (const nij of row) {
      sumNij2 += choose2(nij);
    }
  }

  const a = contingency.map(row => row.reduce((s, v) => s + v, 0)); // row sums
  const b: number[] = [];
  for (let j = 0; j < gtLabels.length; j++) {
    let sum = 0;
    for (let i = 0; i < predLabels.length; i++) {
      sum += contingency[i][j];
    }
    b.push(sum);
  }

  const sumA2 = a.reduce((s, v) => s + choose2(v), 0);
  const sumB2 = b.reduce((s, v) => s + choose2(v), 0);
  const n2 = choose2(n);

  const expected = n2 > 0 ? (sumA2 * sumB2) / n2 : 0;
  const maxIndex = (sumA2 + sumB2) / 2;
  const denominator = maxIndex - expected;

  if (denominator === 0) return 1;
  return (sumNij2 - expected) / denominator;
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
  // Group contigs by true chromosome
  const chromGroups = new Map<number, number[]>();
  for (let i = 0; i < trueChromAssignments.length; i++) {
    const chrom = trueChromAssignments[i];
    if (!chromGroups.has(chrom)) chromGroups.set(chrom, []);
    chromGroups.get(chrom)!.push(i);
  }

  if (chromGroups.size === 0) return 0;

  let totalCompleteness = 0;

  for (const [chrom, members] of chromGroups) {
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
 * Compute the longest contiguous run in the predicted order that
 * matches the ground truth order.
 */
export function longestCorrectRun(
  predictedOrder: number[],
  groundTruthOrder: number[],
): number {
  if (predictedOrder.length === 0 || groundTruthOrder.length === 0) return 0;

  // Build position map from ground truth
  const posMap = new Map<number, number>();
  for (let i = 0; i < groundTruthOrder.length; i++) {
    posMap.set(groundTruthOrder[i], i);
  }

  let longest = 0;
  let current = 0;

  for (let i = 0; i < predictedOrder.length; i++) {
    const predPos = posMap.get(predictedOrder[i]);
    const prevPredPos = i > 0 ? posMap.get(predictedOrder[i - 1]) : undefined;

    if (predPos !== undefined && prevPredPos !== undefined && predPos === prevPredPos + 1) {
      current++;
    } else {
      current = 1;
    }

    longest = Math.max(longest, current);
  }

  return longest;
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
    kendallTau: kendallTau(predictedOrder, groundTruthOrder),
    adjustedRandIndex: adjustedRandIndex(predictedChromAssignments, trueChromAssignments),
    orientationAccuracy: orientationAccuracy(predictedChains, groundTruthInversions),
    chainPurity: chainPurity(predictedChains, trueChromAssignments),
    chainCompleteness: chainCompleteness(predictedChains, trueChromAssignments),
    longestCorrectRun: longestCorrectRun(predictedOrder, groundTruthOrder),
  };
}
