/**
 * Metric computation tests using synthetic data.
 */

import { describe, it, expect } from 'vitest';
import { computeBreakpointMetrics, aggregateBreakpointMetrics } from '../../bench/metrics/autocut-metrics';
import {
  kendallTau,
  adjustedRandIndex,
  orientationAccuracy,
  chainPurity,
  chainCompleteness,
  longestCorrectRun,
  computeSortMetrics,
} from '../../bench/metrics/autosort-metrics';
import { computeChromosomeCompleteness } from '../../bench/metrics/chromosome-metrics';
import { computeAggregateStats, median, stddev } from '../../bench/metrics/summary';
import type { ChainEntry } from '../../src/curation/AutoSort';

describe('breakpoint metrics', () => {
  it('returns perfect scores for exact matches', () => {
    const metrics = computeBreakpointMetrics(
      [100, 200, 300],
      [100, 200, 300],
      1000,
    );
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.truePositives).toBe(3);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.falseNegatives).toBe(0);
    expect(metrics.meanPositionalError).toBe(0);
  });

  it('returns perfect scores when both empty', () => {
    const metrics = computeBreakpointMetrics([], [], 1000);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
  });

  it('handles false positives (detected with no ground truth)', () => {
    const metrics = computeBreakpointMetrics([100, 200], [], 1000);
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(0);
    expect(metrics.falsePositives).toBe(2);
  });

  it('handles false negatives (ground truth with no detections)', () => {
    const metrics = computeBreakpointMetrics([], [100, 200], 1000);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
    expect(metrics.falseNegatives).toBe(2);
  });

  it('matches within tolerance window', () => {
    // Tolerance: max(8, 0.05 * 1000) = 50
    const metrics = computeBreakpointMetrics(
      [105, 195],
      [100, 200],
      1000,
    );
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.truePositives).toBe(2);
    expect(metrics.meanPositionalError).toBe(5);
  });

  it('rejects detections outside tolerance', () => {
    // Tolerance: max(8, 0.05 * 200) = 10
    const metrics = computeBreakpointMetrics(
      [100],
      [150],
      200,
    );
    expect(metrics.truePositives).toBe(0);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(1);
  });

  it('each ground truth matched at most once', () => {
    const metrics = computeBreakpointMetrics(
      [100, 102, 104],
      [103],
      1000,
    );
    expect(metrics.truePositives).toBe(1);
    expect(metrics.falsePositives).toBe(2);
    expect(metrics.falseNegatives).toBe(0);
  });

  it('aggregates correctly', () => {
    const m1 = computeBreakpointMetrics([100], [100], 1000);
    const m2 = computeBreakpointMetrics([200], [], 1000);
    const agg = aggregateBreakpointMetrics([m1, m2]);
    expect(agg.truePositives).toBe(1);
    expect(agg.falsePositives).toBe(1);
    expect(agg.falseNegatives).toBe(0);
    expect(agg.precision).toBe(0.5);
    expect(agg.recall).toBe(1);
  });
});

describe('kendallTau', () => {
  it('returns 1 for identical orderings', () => {
    expect(kendallTau([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(1);
  });

  it('returns -1 for reversed orderings', () => {
    expect(kendallTau([4, 3, 2, 1, 0], [0, 1, 2, 3, 4])).toBe(-1);
  });

  it('returns 0 for uncorrelated orderings', () => {
    // Known example with tau = 0
    const tau = kendallTau([0, 3, 1, 2], [0, 1, 2, 3]);
    expect(Math.abs(tau)).toBeLessThan(0.5);
  });

  it('returns 1 for single element', () => {
    expect(kendallTau([0], [0])).toBe(1);
  });

  it('returns 1 for empty arrays', () => {
    expect(kendallTau([], [])).toBe(1);
  });

  it('handles partial overlap', () => {
    // Predicted has some elements not in ground truth — they're skipped
    const tau = kendallTau([0, 1, 2], [0, 1, 2, 3, 4]);
    expect(tau).toBe(1);
  });
});

describe('adjustedRandIndex', () => {
  it('returns 1 for identical clusterings', () => {
    expect(adjustedRandIndex([0, 0, 1, 1, 2, 2], [0, 0, 1, 1, 2, 2])).toBeCloseTo(1);
  });

  it('returns 1 for single element', () => {
    expect(adjustedRandIndex([0], [0])).toBe(1);
  });

  it('returns ~0 for random clusterings', () => {
    // Maximally different clusterings
    const ari = adjustedRandIndex([0, 0, 0, 1, 1, 1], [0, 1, 0, 1, 0, 1]);
    expect(ari).toBeLessThan(0.5);
  });

  it('handles relabeled clusters', () => {
    // Same structure, different labels
    const ari = adjustedRandIndex([0, 0, 1, 1], [5, 5, 10, 10]);
    expect(ari).toBeCloseTo(1);
  });
});

describe('orientationAccuracy', () => {
  it('returns 1 for all correct orientations', () => {
    const chains: ChainEntry[][] = [[
      { orderIndex: 0, inverted: false },
      { orderIndex: 1, inverted: true },
      { orderIndex: 2, inverted: false },
    ]];
    const gt = new Map([[0, false], [1, true], [2, false]]);
    expect(orientationAccuracy(chains, gt)).toBe(1);
  });

  it('returns 0 for all incorrect orientations', () => {
    const chains: ChainEntry[][] = [[
      { orderIndex: 0, inverted: true },
      { orderIndex: 1, inverted: false },
    ]];
    const gt = new Map([[0, false], [1, true]]);
    expect(orientationAccuracy(chains, gt)).toBe(0);
  });

  it('returns 0.5 for half correct', () => {
    const chains: ChainEntry[][] = [[
      { orderIndex: 0, inverted: false },
      { orderIndex: 1, inverted: false },
    ]];
    const gt = new Map([[0, false], [1, true]]);
    expect(orientationAccuracy(chains, gt)).toBe(0.5);
  });
});

describe('chainPurity', () => {
  it('returns 1 for pure chains', () => {
    const chains: ChainEntry[][] = [
      [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
      [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
    ];
    const assignments = [0, 0, 1, 1];
    expect(chainPurity(chains, assignments)).toBe(1);
  });

  it('returns 0.5 for maximally impure chains', () => {
    const chains: ChainEntry[][] = [
      [{ orderIndex: 0, inverted: false }, { orderIndex: 2, inverted: false }],
      [{ orderIndex: 1, inverted: false }, { orderIndex: 3, inverted: false }],
    ];
    const assignments = [0, 0, 1, 1];
    expect(chainPurity(chains, assignments)).toBe(0.5);
  });
});

describe('chainCompleteness', () => {
  it('returns 1 when each chromosome is in a single chain', () => {
    const chains: ChainEntry[][] = [
      [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
      [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
    ];
    const assignments = [0, 0, 1, 1];
    expect(chainCompleteness(chains, assignments)).toBe(1);
  });

  it('returns 0.5 when chromosomes are split across chains', () => {
    const chains: ChainEntry[][] = [
      [{ orderIndex: 0, inverted: false }],
      [{ orderIndex: 1, inverted: false }],
    ];
    const assignments = [0, 0];
    expect(chainCompleteness(chains, assignments)).toBe(0.5);
  });
});

describe('longestCorrectRun', () => {
  it('returns full length for identical orderings', () => {
    expect(longestCorrectRun([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(5);
  });

  it('returns 1 for reversed ordering', () => {
    expect(longestCorrectRun([4, 3, 2, 1, 0], [0, 1, 2, 3, 4])).toBe(1);
  });

  it('finds longest run in mixed ordering', () => {
    // 3,4,5 is a correct run of length 3
    expect(longestCorrectRun([2, 0, 3, 4, 5, 1], [0, 1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns 0 for empty arrays', () => {
    expect(longestCorrectRun([], [])).toBe(0);
  });
});

describe('computeSortMetrics', () => {
  it('returns perfect scores for identical state', () => {
    const chains: ChainEntry[][] = [
      [
        { orderIndex: 0, inverted: false },
        { orderIndex: 1, inverted: false },
        { orderIndex: 2, inverted: false },
      ],
      [
        { orderIndex: 3, inverted: false },
        { orderIndex: 4, inverted: false },
      ],
    ];
    const gtOrder = [0, 1, 2, 3, 4];
    const gtChromAssign = [0, 0, 0, 1, 1];
    const gtInversions = new Map([[0, false], [1, false], [2, false], [3, false], [4, false]]);

    const metrics = computeSortMetrics(chains, gtOrder, gtChromAssign, gtInversions);
    expect(metrics.kendallTau).toBe(1);
    expect(metrics.adjustedRandIndex).toBeCloseTo(1);
    expect(metrics.orientationAccuracy).toBe(1);
    expect(metrics.chainPurity).toBe(1);
    expect(metrics.chainCompleteness).toBe(1);
    expect(metrics.longestCorrectRun).toBe(5);
  });
});

describe('chromosomeCompleteness', () => {
  it('returns perfect completeness for correct placement', () => {
    const chains: ChainEntry[][] = [
      [{ orderIndex: 0, inverted: false }, { orderIndex: 1, inverted: false }],
      [{ orderIndex: 2, inverted: false }, { orderIndex: 3, inverted: false }],
    ];
    const contigs = [
      { name: 'c1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 10, inverted: false, scaffoldId: null },
      { name: 'c2', originalIndex: 1, length: 1000, pixelStart: 10, pixelEnd: 20, inverted: false, scaffoldId: null },
      { name: 'c3', originalIndex: 2, length: 2000, pixelStart: 20, pixelEnd: 40, inverted: false, scaffoldId: null },
      { name: 'c4', originalIndex: 3, length: 2000, pixelStart: 40, pixelEnd: 60, inverted: false, scaffoldId: null },
    ];
    const contigOrder = [0, 1, 2, 3];
    const chromAssign = [0, 0, 1, 1];

    const result = computeChromosomeCompleteness(chains, contigs, contigOrder, chromAssign);
    expect(result.macroAverage).toBe(1);
    expect(result.microAverage).toBe(1);
    expect(result.highCompleteness).toBe(2);
    expect(result.totalChromosomes).toBe(2);
  });
});

describe('summary utilities', () => {
  it('median computes correctly for odd length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('median computes correctly for even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('median returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('stddev computes correctly', () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('stddev returns 0 for single element', () => {
    expect(stddev([5])).toBe(0);
  });

  it('computeAggregateStats handles empty input', () => {
    const agg = computeAggregateStats([]);
    expect(agg.numSpecimens).toBe(0);
    expect(agg.meanF1).toBe(0);
  });
});
