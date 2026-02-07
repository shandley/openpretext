/**
 * OrderingMetrics — pure-math ordering comparison functions.
 *
 * These are shared between the browser (self-assessment in tutorials)
 * and the benchmark runner (CI regression tests). They have zero
 * Node.js or DOM dependencies.
 */

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

  const rankMap = new Map<number, number>();
  for (let i = 0; i < groundTruth.length; i++) {
    rankMap.set(groundTruth[i], i);
  }

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
 * @param predicted - Predicted cluster assignments (array indexed by item).
 * @param groundTruth - Ground truth cluster assignments.
 */
export function adjustedRandIndex(predicted: number[], groundTruth: number[]): number {
  const n = Math.min(predicted.length, groundTruth.length);
  if (n <= 1) return 1;

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

  const choose2 = (x: number) => (x * (x - 1)) / 2;

  let sumNij2 = 0;
  for (const row of contingency) {
    for (const nij of row) {
      sumNij2 += choose2(nij);
    }
  }

  const a = contingency.map(row => row.reduce((s, v) => s + v, 0));
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
 * Compute the longest contiguous run in the predicted order that
 * matches the ground truth order.
 */
export function longestCorrectRun(
  predictedOrder: number[],
  groundTruthOrder: number[],
): number {
  if (predictedOrder.length === 0 || groundTruthOrder.length === 0) return 0;

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
