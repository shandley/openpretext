/**
 * CurationProgress — real-time ordering metrics for tracking assembly improvement.
 *
 * Computes Kendall's tau and longest correct run against a reference order,
 * providing quantitative feedback on whether curation edits are improving
 * the assembly.
 */

import { kendallTau, longestCorrectRun } from '../curation/OrderingMetrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressScore {
  /** Kendall's tau rank correlation vs reference (-1 to 1). */
  kendallTau: number;
  /** Longest contiguous run matching reference order. */
  longestRun: number;
  /** Longest run as percentage of total contigs. */
  longestRunPct: number;
  /** Total contigs in current order. */
  totalContigs: number;
  /** Timestamp when computed. */
  timestamp: number;
  /** Number of operations (undo stack length). */
  operationCount: number;
}

export interface ProgressTrend {
  /** Current score. */
  current: ProgressScore;
  /** Previous score (null if first computation). */
  previous: ProgressScore | null;
  /** Change in tau since previous. */
  tauDelta: number;
  /** Whether the assembly ordering is improving. */
  improving: boolean;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute progress metrics for the current contig order vs a reference.
 */
export function computeProgress(
  currentOrder: number[],
  referenceOrder: number[],
  undoStackLength: number,
): ProgressScore {
  const tau = kendallTau(currentOrder, referenceOrder);
  const run = longestCorrectRun(currentOrder, referenceOrder);
  const total = currentOrder.length;

  return {
    kendallTau: tau,
    longestRun: run,
    longestRunPct: total > 0 ? (run / total) * 100 : 0,
    totalContigs: total,
    timestamp: Date.now(),
    operationCount: undoStackLength,
  };
}

/**
 * Compute the trend between current and previous scores.
 */
export function computeTrend(
  current: ProgressScore,
  previous: ProgressScore | null,
): ProgressTrend {
  const tauDelta = previous ? current.kendallTau - previous.kendallTau : 0;
  return {
    current,
    previous,
    tauDelta,
    improving: tauDelta > 0.001,
  };
}
