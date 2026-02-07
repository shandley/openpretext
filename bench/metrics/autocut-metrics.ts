/**
 * Breakpoint precision/recall/F1 metrics for AutoCut evaluation.
 *
 * Compares detected breakpoints against ground truth split points
 * using a tolerance window.
 */

import type { Breakpoint } from '../../src/curation/AutoCut';

export interface BreakpointMetrics {
  /** Fraction of detected breakpoints that are true positives. */
  precision: number;
  /** Fraction of ground truth breakpoints that were detected. */
  recall: number;
  /** Harmonic mean of precision and recall. */
  f1: number;
  /** Number of true positives. */
  truePositives: number;
  /** Number of false positives. */
  falsePositives: number;
  /** Number of false negatives (missed breakpoints). */
  falseNegatives: number;
  /** Mean positional error (pixels) for true positives. */
  meanPositionalError: number;
  /** Median positional error (pixels) for true positives. */
  medianPositionalError: number;
}

/**
 * Compute breakpoint precision, recall, and F1.
 *
 * A detected breakpoint is a true positive if it falls within `tolerance`
 * pixels of a ground truth breakpoint (default: 5% of contig length, min 8px).
 * Each ground truth breakpoint can only be matched once.
 *
 * @param detected - Detected breakpoint pixel offsets.
 * @param groundTruth - Ground truth breakpoint pixel offsets.
 * @param contigLength - Length of the contig in pixels (for relative tolerance).
 * @param toleranceFraction - Tolerance as fraction of contig length (default 0.05).
 * @param minTolerance - Minimum tolerance in pixels (default 8).
 */
export function computeBreakpointMetrics(
  detected: number[],
  groundTruth: number[],
  contigLength: number,
  toleranceFraction: number = 0.05,
  minTolerance: number = 8,
): BreakpointMetrics {
  if (detected.length === 0 && groundTruth.length === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      meanPositionalError: 0,
      medianPositionalError: 0,
    };
  }

  if (detected.length === 0) {
    return {
      precision: 1,
      recall: 0,
      f1: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: groundTruth.length,
      meanPositionalError: 0,
      medianPositionalError: 0,
    };
  }

  if (groundTruth.length === 0) {
    return {
      precision: 0,
      recall: 1,
      f1: 0,
      truePositives: 0,
      falsePositives: detected.length,
      falseNegatives: 0,
      meanPositionalError: 0,
      medianPositionalError: 0,
    };
  }

  const tolerance = Math.max(minTolerance, Math.round(contigLength * toleranceFraction));
  const matchedGT = new Set<number>();
  const positionalErrors: number[] = [];
  let truePositives = 0;

  // Sort detected by position for deterministic matching
  const sortedDetected = [...detected].sort((a, b) => a - b);

  for (const det of sortedDetected) {
    let bestDist = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < groundTruth.length; i++) {
      if (matchedGT.has(i)) continue;
      const dist = Math.abs(det - groundTruth[i]);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      truePositives++;
      matchedGT.add(bestIdx);
      positionalErrors.push(bestDist);
    }
  }

  const falsePositives = detected.length - truePositives;
  const falseNegatives = groundTruth.length - truePositives;
  const precision = detected.length > 0 ? truePositives / detected.length : 0;
  const recall = groundTruth.length > 0 ? truePositives / groundTruth.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const meanPositionalError =
    positionalErrors.length > 0
      ? positionalErrors.reduce((a, b) => a + b, 0) / positionalErrors.length
      : 0;

  const sortedErrors = [...positionalErrors].sort((a, b) => a - b);
  const medianPositionalError =
    sortedErrors.length > 0
      ? sortedErrors[Math.floor(sortedErrors.length / 2)]
      : 0;

  return {
    precision,
    recall,
    f1,
    truePositives,
    falsePositives,
    falseNegatives,
    meanPositionalError,
    medianPositionalError,
  };
}

/**
 * Aggregate breakpoint metrics across multiple contigs.
 */
export function aggregateBreakpointMetrics(metrics: BreakpointMetrics[]): BreakpointMetrics {
  if (metrics.length === 0) {
    return {
      precision: 0, recall: 0, f1: 0,
      truePositives: 0, falsePositives: 0, falseNegatives: 0,
      meanPositionalError: 0, medianPositionalError: 0,
    };
  }

  const totalTP = metrics.reduce((s, m) => s + m.truePositives, 0);
  const totalFP = metrics.reduce((s, m) => s + m.falsePositives, 0);
  const totalFN = metrics.reduce((s, m) => s + m.falseNegatives, 0);

  const precision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
  const recall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const allErrors = metrics.flatMap(m =>
    m.meanPositionalError > 0 ? [m.meanPositionalError] : [],
  );
  const meanPositionalError =
    allErrors.length > 0 ? allErrors.reduce((a, b) => a + b, 0) / allErrors.length : 0;

  const sortedErrors = [...allErrors].sort((a, b) => a - b);
  const medianPositionalError =
    sortedErrors.length > 0 ? sortedErrors[Math.floor(sortedErrors.length / 2)] : 0;

  return {
    precision,
    recall,
    f1,
    truePositives: totalTP,
    falsePositives: totalFP,
    falseNegatives: totalFN,
    meanPositionalError,
    medianPositionalError,
  };
}
