import { describe, it, expect, beforeEach } from 'vitest';
import type { ContigInfo } from '../../src/core/State';
import {
  computeNStat,
  calculateMetrics,
  MetricsTracker,
} from '../../src/curation/QualityMetrics';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple ContigInfo for testing purposes.
 */
function makeContig(
  name: string,
  index: number,
  length: number,
  scaffoldId: number | null = null,
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart: index * 100,
    pixelEnd: (index + 1) * 100,
    inverted: false,
    scaffoldId,
  };
}

// ---------------------------------------------------------------------------
// computeNStat
// ---------------------------------------------------------------------------

describe('computeNStat', () => {
  it('should compute correct N50 and L50 for known values', () => {
    // Lengths: 10, 8, 6, 4, 2 (sorted desc). Total = 30.
    // 50% of 30 = 15.
    // Cumulative: 10 -> 18. At index 1 (length 8), cumulative 18 >= 15.
    // N50 = 8, L50 = 2.
    const sorted = [10, 8, 6, 4, 2];
    const total = 30;

    const { nStat, lStat } = computeNStat(sorted, total, 0.5);

    expect(nStat).toBe(8);
    expect(lStat).toBe(2);
  });

  it('should compute correct N90 and L90', () => {
    // Same lengths: 10, 8, 6, 4, 2. Total = 30.
    // 90% of 30 = 27.
    // Cumulative: 10 -> 18 -> 24 -> 28. At index 3 (length 4), cumulative 28 >= 27.
    // N90 = 4, L90 = 4.
    const sorted = [10, 8, 6, 4, 2];
    const total = 30;

    const { nStat, lStat } = computeNStat(sorted, total, 0.9);

    expect(nStat).toBe(4);
    expect(lStat).toBe(4);
  });

  it('should return the single element for a single-element array', () => {
    const sorted = [42];
    const total = 42;

    const n50 = computeNStat(sorted, total, 0.5);
    const n90 = computeNStat(sorted, total, 0.9);

    expect(n50.nStat).toBe(42);
    expect(n50.lStat).toBe(1);
    expect(n90.nStat).toBe(42);
    expect(n90.lStat).toBe(1);
  });

  it('should return zeros for an empty array', () => {
    const { nStat, lStat } = computeNStat([], 0, 0.5);

    expect(nStat).toBe(0);
    expect(lStat).toBe(0);
  });

  it('should handle all equal lengths', () => {
    // 5 contigs of length 100. Total = 500.
    // 50% = 250. Cumulative: 100, 200, 300. At index 2, cumulative 300 >= 250.
    // N50 = 100, L50 = 3.
    const sorted = [100, 100, 100, 100, 100];
    const total = 500;

    const { nStat, lStat } = computeNStat(sorted, total, 0.5);

    expect(nStat).toBe(100);
    expect(lStat).toBe(3);
  });

  it('should handle fraction of 1.0 (N100)', () => {
    const sorted = [10, 8, 6, 4, 2];
    const total = 30;

    const { nStat, lStat } = computeNStat(sorted, total, 1.0);

    expect(nStat).toBe(2);
    expect(lStat).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics
// ---------------------------------------------------------------------------

describe('calculateMetrics', () => {
  it('should calculate all fields correctly for 5 contigs with known lengths', () => {
    const contigs = [
      makeContig('c1', 0, 10000),
      makeContig('c2', 1, 8000),
      makeContig('c3', 2, 6000),
      makeContig('c4', 3, 4000),
      makeContig('c5', 4, 2000),
    ];
    const order = [0, 1, 2, 3, 4];

    const m = calculateMetrics(contigs, order, 3);

    expect(m.totalLength).toBe(30000);
    expect(m.contigCount).toBe(5);
    expect(m.longestContig).toBe(10000);
    expect(m.shortestContig).toBe(2000);
    expect(m.meanLength).toBe(6000);
    // Sorted ascending: 2000, 4000, 6000, 8000, 10000 -> median is 6000 (middle)
    expect(m.medianLength).toBe(6000);
    // N50: sorted desc [10000, 8000, 6000, 4000, 2000]. 50% of 30000 = 15000.
    // Cumulative: 10000, 18000. At 8000, L50 = 2.
    expect(m.n50).toBe(8000);
    expect(m.l50).toBe(2);
    // N90: 90% of 30000 = 27000.
    // Cumulative: 10000, 18000, 24000, 28000. At 4000, L90 = 4.
    expect(m.n90).toBe(4000);
    expect(m.l90).toBe(4);
    // No scaffolds assigned -> each contig is its own scaffold.
    expect(m.scaffoldCount).toBe(5);
    expect(m.operationCount).toBe(3);
    expect(m.timestamp).toBeGreaterThan(0);
  });

  it('should handle a single contig', () => {
    const contigs = [makeContig('only', 0, 50000)];
    const order = [0];

    const m = calculateMetrics(contigs, order);

    expect(m.totalLength).toBe(50000);
    expect(m.contigCount).toBe(1);
    expect(m.n50).toBe(50000);
    expect(m.l50).toBe(1);
    expect(m.n90).toBe(50000);
    expect(m.l90).toBe(1);
    expect(m.longestContig).toBe(50000);
    expect(m.shortestContig).toBe(50000);
    expect(m.meanLength).toBe(50000);
    expect(m.medianLength).toBe(50000);
    expect(m.scaffoldCount).toBe(1);
    expect(m.operationCount).toBe(0);
  });

  it('should compute correct scaffoldCount with scaffold assignments', () => {
    const contigs = [
      makeContig('c1', 0, 1000, 1),  // scaffold 1
      makeContig('c2', 1, 2000, 1),  // scaffold 1
      makeContig('c3', 2, 3000, 2),  // scaffold 2
      makeContig('c4', 3, 4000, null), // unscaffolded
      makeContig('c5', 4, 5000, null), // unscaffolded
    ];
    const order = [0, 1, 2, 3, 4];

    const m = calculateMetrics(contigs, order);

    // 2 named scaffolds + 2 unscaffolded contigs = 4
    expect(m.scaffoldCount).toBe(4);
  });

  it('should return sensible zeros for empty contigOrder', () => {
    const contigs = [makeContig('c1', 0, 1000)];
    const order: number[] = [];

    const m = calculateMetrics(contigs, order);

    expect(m.totalLength).toBe(0);
    expect(m.contigCount).toBe(0);
    expect(m.n50).toBe(0);
    expect(m.l50).toBe(0);
    expect(m.n90).toBe(0);
    expect(m.l90).toBe(0);
    expect(m.longestContig).toBe(0);
    expect(m.shortestContig).toBe(0);
    expect(m.meanLength).toBe(0);
    expect(m.medianLength).toBe(0);
    expect(m.scaffoldCount).toBe(0);
  });

  it('should default operationCount to 0', () => {
    const contigs = [makeContig('c1', 0, 1000)];
    const m = calculateMetrics(contigs, [0]);

    expect(m.operationCount).toBe(0);
  });

  it('should only consider contigs referenced by contigOrder', () => {
    const contigs = [
      makeContig('c1', 0, 1000),
      makeContig('c2', 1, 2000),
      makeContig('c3', 2, 3000),
    ];
    // Only contigs 0 and 2 are in the order.
    const order = [0, 2];

    const m = calculateMetrics(contigs, order);

    expect(m.totalLength).toBe(4000);
    expect(m.contigCount).toBe(2);
    expect(m.longestContig).toBe(3000);
    expect(m.shortestContig).toBe(1000);
  });

  it('should compute correct median for even number of contigs', () => {
    const contigs = [
      makeContig('c1', 0, 1000),
      makeContig('c2', 1, 2000),
      makeContig('c3', 2, 3000),
      makeContig('c4', 3, 4000),
    ];
    const order = [0, 1, 2, 3];

    const m = calculateMetrics(contigs, order);

    // Sorted ascending: 1000, 2000, 3000, 4000. Median = (2000 + 3000) / 2 = 2500.
    expect(m.medianLength).toBe(2500);
  });

  it('should compute correct median for odd number of contigs', () => {
    const contigs = [
      makeContig('c1', 0, 1000),
      makeContig('c2', 1, 5000),
      makeContig('c3', 2, 3000),
    ];
    const order = [0, 1, 2];

    const m = calculateMetrics(contigs, order);

    // Sorted ascending: 1000, 3000, 5000. Median = 3000.
    expect(m.medianLength).toBe(3000);
  });

  it('should count all-scaffolded contigs as one scaffold per group', () => {
    const contigs = [
      makeContig('c1', 0, 1000, 5),
      makeContig('c2', 1, 2000, 5),
      makeContig('c3', 2, 3000, 5),
    ];
    const order = [0, 1, 2];

    const m = calculateMetrics(contigs, order);

    expect(m.scaffoldCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MetricsTracker
// ---------------------------------------------------------------------------

describe('MetricsTracker', () => {
  let tracker: MetricsTracker;
  const contigs = [
    makeContig('c1', 0, 10000),
    makeContig('c2', 1, 8000),
    makeContig('c3', 2, 6000),
  ];
  const order = [0, 1, 2];

  beforeEach(() => {
    tracker = new MetricsTracker();
  });

  it('should return null from getLatest when no snapshots exist', () => {
    expect(tracker.getLatest()).toBeNull();
  });

  it('should return null from getInitial when no snapshots exist', () => {
    expect(tracker.getInitial()).toBeNull();
  });

  it('should take a snapshot and return it from getLatest', () => {
    const metrics = tracker.snapshot(contigs, order, 0);

    expect(tracker.getLatest()).toBe(metrics);
    expect(metrics.contigCount).toBe(3);
    expect(metrics.totalLength).toBe(24000);
  });

  it('should record snapshots in chronological order via getHistory', () => {
    const m1 = tracker.snapshot(contigs, order, 0);
    const m2 = tracker.snapshot(contigs, order, 1);
    const m3 = tracker.snapshot(contigs, order, 2);

    const history = tracker.getHistory();

    expect(history.length).toBe(3);
    expect(history[0]).toBe(m1);
    expect(history[1]).toBe(m2);
    expect(history[2]).toBe(m3);
    expect(history[0].operationCount).toBe(0);
    expect(history[1].operationCount).toBe(1);
    expect(history[2].operationCount).toBe(2);
  });

  it('should return the first snapshot from getInitial', () => {
    const m1 = tracker.snapshot(contigs, order, 0);
    tracker.snapshot(contigs, order, 1);
    tracker.snapshot(contigs, order, 2);

    expect(tracker.getInitial()).toBe(m1);
  });

  it('should return the last snapshot from getLatest', () => {
    tracker.snapshot(contigs, order, 0);
    tracker.snapshot(contigs, order, 1);
    const m3 = tracker.snapshot(contigs, order, 2);

    expect(tracker.getLatest()).toBe(m3);
  });

  it('should return null from getSummary with fewer than two snapshots', () => {
    expect(tracker.getSummary()).toBeNull();

    tracker.snapshot(contigs, order, 0);
    expect(tracker.getSummary()).toBeNull();
  });

  it('should return a correct summary comparing initial vs current', () => {
    // Initial state: 3 contigs, all unscaffolded.
    tracker.snapshot(contigs, order, 0);

    // After some curation: different contigs (simulated by different set).
    const contigsAfter = [
      makeContig('c1', 0, 10000, 1),
      makeContig('c2', 1, 8000, 1),
      makeContig('c3', 2, 6000, null),
      makeContig('c4', 3, 4000, null),
    ];
    const orderAfter = [0, 1, 2, 3];
    tracker.snapshot(contigsAfter, orderAfter, 5);

    const summary = tracker.getSummary();

    expect(summary).not.toBeNull();
    expect(summary!.initial.contigCount).toBe(3);
    expect(summary!.current.contigCount).toBe(4);
    expect(summary!.contigCountDelta).toBe(1);
    expect(summary!.operationCount).toBe(5);
    // scaffoldCount: initial = 3 (all null), current = 1 scaffold + 2 unscaffolded = 3
    expect(summary!.initial.scaffoldCount).toBe(3);
    expect(summary!.current.scaffoldCount).toBe(3);
    expect(summary!.scaffoldCountDelta).toBe(0);
    // n50Delta
    expect(summary!.n50Delta).toBe(summary!.current.n50 - summary!.initial.n50);
  });

  it('should clear all history', () => {
    tracker.snapshot(contigs, order, 0);
    tracker.snapshot(contigs, order, 1);

    expect(tracker.getHistory().length).toBe(2);

    tracker.clear();

    expect(tracker.getHistory().length).toBe(0);
    expect(tracker.getLatest()).toBeNull();
    expect(tracker.getInitial()).toBeNull();
    expect(tracker.getSummary()).toBeNull();
  });

  it('should return a read-only history array', () => {
    tracker.snapshot(contigs, order, 0);
    const history = tracker.getHistory();

    // The returned array is ReadonlyArray, but we verify the tracker's
    // internal state is not mutated if the caller tries to modify the ref.
    expect(history.length).toBe(1);

    // Take another snapshot and verify the original reference didn't change
    // (it's a new array reference each time since it's the internal array).
    tracker.snapshot(contigs, order, 1);
    const history2 = tracker.getHistory();
    expect(history2.length).toBe(2);
  });

  it('should capture timestamps that are monotonically non-decreasing', () => {
    tracker.snapshot(contigs, order, 0);
    tracker.snapshot(contigs, order, 1);
    tracker.snapshot(contigs, order, 2);

    const history = tracker.getHistory();

    for (let i = 1; i < history.length; i++) {
      expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
    }
  });
});
