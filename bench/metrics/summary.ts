/**
 * Aggregate statistics across multiple benchmark specimens.
 */

import type { BreakpointMetrics } from './autocut-metrics';
import type { SortMetrics } from './autosort-metrics';
import type { ChromosomeCompletenessResult } from './chromosome-metrics';

export interface SpecimenResult {
  species: string;
  numContigs: number;
  breakpointMetrics: BreakpointMetrics;
  sortMetrics: SortMetrics;
  chromosomeCompleteness: ChromosomeCompletenessResult;
  timingMs: {
    load: number;
    autoCut: number;
    autoSort: number;
    total: number;
  };
}

export interface AggregateStats {
  numSpecimens: number;
  meanPrecision: number;
  meanRecall: number;
  meanF1: number;
  meanKendallTau: number;
  meanARI: number;
  meanOrientationAccuracy: number;
  meanChainPurity: number;
  meanChainCompleteness: number;
  meanMacroCompleteness: number;
  meanMicroCompleteness: number;
  meanTotalTimeMs: number;
}

/**
 * Compute aggregate statistics across multiple specimen results.
 */
export function computeAggregateStats(results: SpecimenResult[]): AggregateStats {
  const n = results.length;
  if (n === 0) {
    return {
      numSpecimens: 0,
      meanPrecision: 0, meanRecall: 0, meanF1: 0,
      meanKendallTau: 0, meanARI: 0, meanOrientationAccuracy: 0,
      meanChainPurity: 0, meanChainCompleteness: 0,
      meanMacroCompleteness: 0, meanMicroCompleteness: 0,
      meanTotalTimeMs: 0,
    };
  }

  const avg = (fn: (r: SpecimenResult) => number) =>
    results.reduce((s, r) => s + fn(r), 0) / n;

  return {
    numSpecimens: n,
    meanPrecision: avg(r => r.breakpointMetrics.precision),
    meanRecall: avg(r => r.breakpointMetrics.recall),
    meanF1: avg(r => r.breakpointMetrics.f1),
    meanKendallTau: avg(r => r.sortMetrics.kendallTau),
    meanARI: avg(r => r.sortMetrics.adjustedRandIndex),
    meanOrientationAccuracy: avg(r => r.sortMetrics.orientationAccuracy),
    meanChainPurity: avg(r => r.sortMetrics.chainPurity),
    meanChainCompleteness: avg(r => r.sortMetrics.chainCompleteness),
    meanMacroCompleteness: avg(r => r.chromosomeCompleteness.macroAverage),
    meanMicroCompleteness: avg(r => r.chromosomeCompleteness.microAverage),
    meanTotalTimeMs: avg(r => r.timingMs.total),
  };
}

/**
 * Compute median of an array.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute standard deviation.
 */
export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
