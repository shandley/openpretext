import { describe, it, expect } from 'vitest';
import { computeProgress, computeTrend, type ProgressScore } from '../../src/analysis/CurationProgress';

// ---------------------------------------------------------------------------
// computeProgress
// ---------------------------------------------------------------------------

describe('computeProgress', () => {
  it('returns perfect score for identical orders', () => {
    const order = [0, 1, 2, 3, 4];
    const score = computeProgress(order, order, 0);

    expect(score.kendallTau).toBe(1);
    expect(score.longestRun).toBe(5);
    expect(score.longestRunPct).toBe(100);
    expect(score.totalContigs).toBe(5);
    expect(score.operationCount).toBe(0);
  });

  it('returns negative tau for reversed order', () => {
    const reference = [0, 1, 2, 3, 4];
    const reversed = [4, 3, 2, 1, 0];
    const score = computeProgress(reversed, reference, 3);

    expect(score.kendallTau).toBe(-1);
    expect(score.longestRun).toBe(1);
    expect(score.operationCount).toBe(3);
  });

  it('handles partially matching orders', () => {
    const reference = [0, 1, 2, 3, 4, 5];
    const current = [0, 1, 2, 5, 4, 3]; // first 3 correct, last 3 reversed
    const score = computeProgress(current, reference, 2);

    expect(score.kendallTau).toBeGreaterThan(-1);
    expect(score.kendallTau).toBeLessThan(1);
    expect(score.longestRun).toBe(3); // [0,1,2]
    expect(score.longestRunPct).toBeCloseTo(50);
  });

  it('handles empty orders', () => {
    const score = computeProgress([], [], 0);
    expect(score.totalContigs).toBe(0);
    expect(score.longestRunPct).toBe(0);
  });

  it('handles single contig', () => {
    const score = computeProgress([0], [0], 0);
    expect(score.kendallTau).toBe(1);
    expect(score.longestRun).toBe(1);
    expect(score.longestRunPct).toBe(100);
  });

  it('records correct timestamp', () => {
    const before = Date.now();
    const score = computeProgress([0, 1], [0, 1], 0);
    const after = Date.now();

    expect(score.timestamp).toBeGreaterThanOrEqual(before);
    expect(score.timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// computeTrend
// ---------------------------------------------------------------------------

describe('computeTrend', () => {
  function makeScore(tau: number, ops = 0): ProgressScore {
    return {
      kendallTau: tau,
      longestRun: 5,
      longestRunPct: 50,
      totalContigs: 10,
      timestamp: Date.now(),
      operationCount: ops,
    };
  }

  it('reports improving when tau increases', () => {
    const prev = makeScore(0.5, 1);
    const curr = makeScore(0.7, 2);
    const trend = computeTrend(curr, prev);

    expect(trend.improving).toBe(true);
    expect(trend.tauDelta).toBeCloseTo(0.2);
  });

  it('reports not improving when tau decreases', () => {
    const prev = makeScore(0.7, 1);
    const curr = makeScore(0.5, 2);
    const trend = computeTrend(curr, prev);

    expect(trend.improving).toBe(false);
    expect(trend.tauDelta).toBeCloseTo(-0.2);
  });

  it('reports not improving for tiny positive change', () => {
    const prev = makeScore(0.5, 1);
    const curr = makeScore(0.5005, 2);
    const trend = computeTrend(curr, prev);

    expect(trend.improving).toBe(false);
  });

  it('handles null previous score', () => {
    const curr = makeScore(0.5, 1);
    const trend = computeTrend(curr, null);

    expect(trend.tauDelta).toBe(0);
    expect(trend.improving).toBe(false);
    expect(trend.previous).toBeNull();
  });

  it('preserves current and previous references', () => {
    const prev = makeScore(0.3, 1);
    const curr = makeScore(0.6, 3);
    const trend = computeTrend(curr, prev);

    expect(trend.current).toBe(curr);
    expect(trend.previous).toBe(prev);
  });
});
