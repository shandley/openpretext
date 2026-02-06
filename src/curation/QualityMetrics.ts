/**
 * QualityMetrics - Assembly quality metrics calculator and session tracker.
 *
 * Computes standard assembly statistics (N50, L50, N90, L90, etc.) from
 * the current contig state. The MetricsTracker class maintains a history
 * of snapshots taken after each curation operation, enabling before/after
 * comparison of assembly quality throughout a curation session.
 */

import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of assembly metrics at a point in time. */
export interface AssemblyMetrics {
  /** Total assembly length in base pairs. */
  totalLength: number;
  /** Number of contigs/scaffolds. */
  contigCount: number;
  /** N50: length such that 50% of assembly is in contigs >= this length. */
  n50: number;
  /** L50: minimum number of contigs covering 50% of assembly. */
  l50: number;
  /** N90: length such that 90% of assembly is in contigs >= this length. */
  n90: number;
  /** L90: minimum number of contigs covering 90% of assembly. */
  l90: number;
  /** Longest contig length. */
  longestContig: number;
  /** Shortest contig length. */
  shortestContig: number;
  /** Mean contig length. */
  meanLength: number;
  /** Median contig length. */
  medianLength: number;
  /** Number of distinct scaffolds (contigs with same scaffoldId grouped). */
  scaffoldCount: number;
  /** Number of operations performed so far. */
  operationCount: number;
  /** Timestamp of this snapshot. */
  timestamp: number;
}

/** Summary comparing initial vs latest metrics. */
export interface MetricsSummary {
  initial: AssemblyMetrics;
  current: AssemblyMetrics;
  contigCountDelta: number;
  n50Delta: number;
  scaffoldCountDelta: number;
  operationCount: number;
}

// ---------------------------------------------------------------------------
// N-statistic computation
// ---------------------------------------------------------------------------

/**
 * Compute an N-statistic (like N50, N90) from sorted-descending lengths.
 *
 * Walks the sorted lengths from largest to smallest, accumulating total
 * length until the running sum reaches `fraction * totalLength`. At that
 * point the current length is the N-stat, and the count of contigs
 * visited is the L-stat.
 *
 * @param sortedLengths - Contig lengths sorted in descending order.
 * @param totalLength   - The total assembly length in base pairs.
 * @param fraction      - The target fraction (e.g. 0.5 for N50, 0.9 for N90).
 * @returns An object with `nStat` (the length threshold) and `lStat` (the count).
 */
export function computeNStat(
  sortedLengths: number[],
  totalLength: number,
  fraction: number,
): { nStat: number; lStat: number } {
  if (sortedLengths.length === 0) {
    return { nStat: 0, lStat: 0 };
  }

  const threshold = fraction * totalLength;
  let cumulative = 0;

  for (let i = 0; i < sortedLengths.length; i++) {
    cumulative += sortedLengths[i];
    if (cumulative >= threshold) {
      return { nStat: sortedLengths[i], lStat: i + 1 };
    }
  }

  // Should not reach here if sortedLengths sum equals totalLength,
  // but handle gracefully for floating-point edge cases.
  return {
    nStat: sortedLengths[sortedLengths.length - 1],
    lStat: sortedLengths.length,
  };
}

// ---------------------------------------------------------------------------
// Full metrics calculation
// ---------------------------------------------------------------------------

/**
 * Calculate full assembly metrics from the current contig state.
 *
 * @param contigs        - The full contigs array (indexed by original index).
 * @param contigOrder    - The current ordering (indices into `contigs`).
 * @param operationCount - Number of curation operations performed so far.
 * @returns A complete AssemblyMetrics snapshot.
 */
export function calculateMetrics(
  contigs: ContigInfo[],
  contigOrder: number[],
  operationCount: number = 0,
): AssemblyMetrics {
  if (contigOrder.length === 0) {
    return {
      totalLength: 0,
      contigCount: 0,
      n50: 0,
      l50: 0,
      n90: 0,
      l90: 0,
      longestContig: 0,
      shortestContig: 0,
      meanLength: 0,
      medianLength: 0,
      scaffoldCount: 0,
      operationCount,
      timestamp: Date.now(),
    };
  }

  // Extract lengths in contig-order.
  const lengths: number[] = contigOrder.map(i => contigs[i].length);

  // Basic aggregates.
  const totalLength = lengths.reduce((sum, l) => sum + l, 0);
  const contigCount = lengths.length;
  const meanLength = totalLength / contigCount;

  // Sort descending for N-stat computation and min/max.
  const sortedDesc = [...lengths].sort((a, b) => b - a);
  const longestContig = sortedDesc[0];
  const shortestContig = sortedDesc[sortedDesc.length - 1];

  // Median: for even count, average the two middle values.
  const sortedAsc = [...lengths].sort((a, b) => a - b);
  let medianLength: number;
  const mid = Math.floor(sortedAsc.length / 2);
  if (sortedAsc.length % 2 === 0) {
    medianLength = (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
  } else {
    medianLength = sortedAsc[mid];
  }

  // N50 / L50
  const { nStat: n50, lStat: l50 } = computeNStat(sortedDesc, totalLength, 0.5);

  // N90 / L90
  const { nStat: n90, lStat: l90 } = computeNStat(sortedDesc, totalLength, 0.9);

  // Scaffold count: group contigs by scaffoldId.
  // Non-null scaffoldIds that are the same count as one scaffold.
  // Null scaffoldIds each count as their own scaffold.
  const scaffoldIds = new Set<number>();
  let unscaffoldedCount = 0;
  for (const idx of contigOrder) {
    const sid = contigs[idx].scaffoldId;
    if (sid !== null) {
      scaffoldIds.add(sid);
    } else {
      unscaffoldedCount++;
    }
  }
  const scaffoldCount = scaffoldIds.size + unscaffoldedCount;

  return {
    totalLength,
    contigCount,
    n50,
    l50,
    n90,
    l90,
    longestContig,
    shortestContig,
    meanLength,
    medianLength,
    scaffoldCount,
    operationCount,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// MetricsTracker
// ---------------------------------------------------------------------------

/**
 * MetricsTracker records a history of AssemblyMetrics snapshots.
 *
 * Call `snapshot()` after each curation operation to build a timeline
 * of how the assembly quality evolves during a curation session.
 */
export class MetricsTracker {
  private history: AssemblyMetrics[] = [];

  /**
   * Take a snapshot of current metrics and append it to the history.
   *
   * @returns The newly created AssemblyMetrics snapshot.
   */
  snapshot(
    contigs: ContigInfo[],
    contigOrder: number[],
    operationCount?: number,
  ): AssemblyMetrics {
    const metrics = calculateMetrics(contigs, contigOrder, operationCount);
    this.history.push(metrics);
    return metrics;
  }

  /** Get the full history of snapshots (read-only). */
  getHistory(): ReadonlyArray<AssemblyMetrics> {
    return this.history;
  }

  /** Get the latest snapshot, or null if no snapshots have been taken. */
  getLatest(): AssemblyMetrics | null {
    if (this.history.length === 0) {
      return null;
    }
    return this.history[this.history.length - 1];
  }

  /** Get the initial snapshot (before any curation), or null if empty. */
  getInitial(): AssemblyMetrics | null {
    if (this.history.length === 0) {
      return null;
    }
    return this.history[0];
  }

  /** Clear all history. */
  clear(): void {
    this.history = [];
  }

  /**
   * Get a summary comparing initial vs latest metrics.
   *
   * Returns null if fewer than two snapshots exist (need at least
   * an initial and a current snapshot to compute deltas).
   */
  getSummary(): MetricsSummary | null {
    if (this.history.length < 2) {
      return null;
    }

    const initial = this.history[0];
    const current = this.history[this.history.length - 1];

    return {
      initial,
      current,
      contigCountDelta: current.contigCount - initial.contigCount,
      n50Delta: current.n50 - initial.n50,
      scaffoldCountDelta: current.scaffoldCount - initial.scaffoldCount,
      operationCount: current.operationCount,
    };
  }
}
