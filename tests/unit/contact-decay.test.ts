import { describe, it, expect } from 'vitest';
import {
  computeContactDecay,
  computeLocalSlope,
  formatDecayStats,
} from '../../src/analysis/ContactDecay';
import type { ContigRange } from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a contact map with power-law decay: value = 1 / (1 + d)^exponent. */
function makePowerLawMap(size: number, exponent: number): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = i; j < size; j++) {
      const d = j - i;
      const value = d === 0 ? 1.0 : Math.pow(1 + d, exponent);
      map[i * size + j] = value;
      map[j * size + i] = value;
    }
  }
  return map;
}

/** Create evenly spaced contig ranges. */
function makeContigRanges(size: number, numContigs: number): ContigRange[] {
  const ranges: ContigRange[] = [];
  const contigSize = Math.floor(size / numContigs);
  for (let i = 0; i < numContigs; i++) {
    ranges.push({
      start: i * contigSize,
      end: Math.min((i + 1) * contigSize, size),
      orderIndex: i,
    });
  }
  return ranges;
}

/** Create a single contig covering the whole map. */
function singleContigRange(size: number): ContigRange[] {
  return [{ start: 0, end: size, orderIndex: 0 }];
}

/** Uniform contact map. */
function makeUniformMap(size: number, value: number): Float32Array {
  const map = new Float32Array(size * size);
  map.fill(value);
  return map;
}

// ---------------------------------------------------------------------------
// computeContactDecay
// ---------------------------------------------------------------------------

describe('computeContactDecay', () => {
  it('returns correct number of distances', () => {
    const map = makePowerLawMap(64, -1.0);
    const result = computeContactDecay(map, 64, singleContigRange(64));
    expect(result.distances.length).toBeGreaterThan(0);
    expect(result.distances.length).toBe(result.meanContacts.length);
    expect(result.logDistances.length).toBe(result.logContacts.length);
  });

  it('distances start at 1 (not 0)', () => {
    const map = makePowerLawMap(32, -1.0);
    const result = computeContactDecay(map, 32, singleContigRange(32));
    expect(result.distances[0]).toBe(1);
  });

  it('mean contacts are non-negative', () => {
    const map = makePowerLawMap(32, -1.0);
    const result = computeContactDecay(map, 32, singleContigRange(32));
    for (let i = 0; i < result.meanContacts.length; i++) {
      expect(result.meanContacts[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('recovers decay exponent from power-law map (exponent = -1.0)', () => {
    const map = makePowerLawMap(128, -1.0);
    const result = computeContactDecay(map, 128, singleContigRange(128));
    // The synthetic map has value = (1+d)^-1, which in log-log is
    // log(v) = -1 * log(1+d). The fit should recover ~-1.0.
    expect(result.decayExponent).toBeCloseTo(-1.0, 0);
    expect(result.rSquared).toBeGreaterThan(0.9);
  });

  it('recovers steeper exponent from power-law map (exponent = -1.5)', () => {
    const map = makePowerLawMap(128, -1.5);
    const result = computeContactDecay(map, 128, singleContigRange(128));
    expect(result.decayExponent).toBeCloseTo(-1.5, 0);
    expect(result.rSquared).toBeGreaterThan(0.9);
  });

  it('returns exponent near 0 for uniform map', () => {
    const map = makeUniformMap(64, 0.5);
    const result = computeContactDecay(map, 64, singleContigRange(64));
    // Uniform: same mean at every distance → log-log slope near 0
    expect(Math.abs(result.decayExponent)).toBeLessThan(0.1);
  });

  it('respects maxDistance parameter', () => {
    const map = makePowerLawMap(64, -1.0);
    const result = computeContactDecay(map, 64, singleContigRange(64), { maxDistance: 10 });
    expect(result.maxDistance).toBe(10);
    for (let i = 0; i < result.distances.length; i++) {
      expect(result.distances[i]).toBeLessThanOrEqual(10);
    }
  });

  it('works with multiple contig ranges', () => {
    const map = makePowerLawMap(64, -1.0);
    const ranges = makeContigRanges(64, 4);
    const result = computeContactDecay(map, 64, ranges);
    expect(result.distances.length).toBeGreaterThan(0);
    expect(result.decayExponent).toBeLessThan(0);
  });

  it('handles zero-size map', () => {
    const map = new Float32Array(0);
    const result = computeContactDecay(map, 0, []);
    expect(result.distances.length).toBe(0);
    // No data to fit → not-fitted sentinel, distinguishable from a genuine 0.
    expect(Number.isNaN(result.decayExponent)).toBe(true);
    expect(Number.isNaN(result.rSquared)).toBe(true);
  });

  it('handles empty contig ranges', () => {
    const map = makePowerLawMap(32, -1.0);
    const result = computeContactDecay(map, 32, []);
    expect(result.distances.length).toBe(0);
    expect(Number.isNaN(result.decayExponent)).toBe(true);
  });

  it('handles zero contact map', () => {
    const map = new Float32Array(32 * 32);
    const result = computeContactDecay(map, 32, singleContigRange(32));
    // All zeros → no positive contacts → empty distances
    expect(result.distances.length).toBe(0);
    expect(Number.isNaN(result.decayExponent)).toBe(true);
  });

  it('does not report a spurious perfect fit when too few points support it', () => {
    // A 3-pixel contig yields only 2 non-zero distances (d=1, d=2). OLS through
    // 2 points has zero residual DOF and returns rSquared=1.0 by construction —
    // a fake "perfect" fit. The guard must reject it as not-fitted (NaN) so a
    // per-scaffold mean can exclude it rather than average in a spurious 1.0.
    const size = 8;
    const map = new Float32Array(size * size);
    const set = (i: number, j: number, v: number) => {
      map[i * size + j] = v;
      map[j * size + i] = v;
    };
    set(0, 1, 4);
    set(1, 2, 3);
    set(0, 2, 2);
    const result = computeContactDecay(map, size, [{ start: 0, end: 3, orderIndex: 0 }]);
    expect(result.distances.length).toBeLessThan(5);
    expect(Number.isNaN(result.rSquared)).toBe(true);
    expect(Number.isNaN(result.decayExponent)).toBe(true);
  });

  it('still fits a well-supported curve (dense map unaffected by the guard)', () => {
    const map = makePowerLawMap(128, -1.0);
    const result = computeContactDecay(map, 128, singleContigRange(128));
    expect(Number.isFinite(result.rSquared)).toBe(true);
    expect(result.rSquared).toBeGreaterThan(0.9);
  });

  it('marks a sparse fit not-fitted but keeps the exponent for a dense fit', () => {
    const minFitPoints = 5;
    // 4-point support (contig length 5 → distances 1..4) is below the guard.
    const size = 16;
    const map = makePowerLawMap(size, -1.0);
    const sparse = computeContactDecay(map, size, [{ start: 0, end: 5, orderIndex: 0 }], { minFitPoints });
    expect(sparse.distances.length).toBeLessThan(minFitPoints);
    expect(Number.isNaN(sparse.decayExponent)).toBe(true);
  });

  it('honors minCountForFit: filters low-support distances from the fit only', () => {
    // Single 64px contig → maxD=32, counts[d] = 64 - d. minCountForFit=60 keeps
    // only d=1..4 for the fit (4 points < minFitPoints=5) → not-fitted, but the
    // raw curve (all ~32 distances) is still returned for plotting.
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const result = computeContactDecay(map, size, singleContigRange(size), { minCountForFit: 60 });
    expect(result.distances.length).toBeGreaterThan(20);
    expect(Number.isNaN(result.decayExponent)).toBe(true);
  });

  it('default minCountForFit does not filter a well-supported dense map', () => {
    // counts[d] = 128 - d ≥ 64 for all computed d, so the default 10 excludes
    // nothing — the dense fit is unchanged.
    const map = makePowerLawMap(128, -1.0);
    const result = computeContactDecay(map, 128, singleContigRange(128));
    expect(result.decayExponent).toBeCloseTo(-1.0, 0);
    expect(result.rSquared).toBeGreaterThan(0.9);
  });

  it('logbin fit method recovers the exponent and is opt-in (default stays linear)', () => {
    const map = makePowerLawMap(128, -1.0);
    const linear = computeContactDecay(map, 128, singleContigRange(128));
    const logbin = computeContactDecay(map, 128, singleContigRange(128), { fitMethod: 'logbin' });
    expect(logbin.decayExponent).toBeCloseTo(-1.0, 0);
    expect(Number.isFinite(logbin.rSquared)).toBe(true);
    // Omitting fitMethod must equal explicit 'linear' (no silent redefinition).
    const explicitLinear = computeContactDecay(map, 128, singleContigRange(128), { fitMethod: 'linear' });
    expect(linear.decayExponent).toBe(explicitLinear.decayExponent);
    expect(linear.rSquared).toBe(explicitLinear.rSquared);
  });
});

// ---------------------------------------------------------------------------
// formatDecayStats
// ---------------------------------------------------------------------------

describe('formatDecayStats', () => {
  it('returns non-empty HTML for valid results', () => {
    const map = makePowerLawMap(64, -1.0);
    const result = computeContactDecay(map, 64, singleContigRange(64));
    const html = formatDecayStats(result);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('P(s) exponent');
  });

  it('contains the decay exponent value', () => {
    const map = makePowerLawMap(64, -1.0);
    const result = computeContactDecay(map, 64, singleContigRange(64));
    const html = formatDecayStats(result);
    expect(html).toContain(result.decayExponent.toFixed(2));
  });

  it('uses green color for typical Hi-C exponent range', () => {
    const map = makePowerLawMap(128, -1.2);
    const result = computeContactDecay(map, 128, singleContigRange(128));
    const html = formatDecayStats(result);
    expect(html).toContain('#4caf50');
  });

  it('handles empty result gracefully', () => {
    const result = computeContactDecay(new Float32Array(0), 0, []);
    const html = formatDecayStats(result);
    expect(html).toContain('—');
  });
});

describe('computeLocalSlope', () => {
  it('returns the exact slope everywhere for a perfect power law', () => {
    // log(contacts) = -1 * log(distance): slope -1 at every point.
    const logD = Float64Array.from([0, 1, 2, 3, 4, 5]);
    const logC = Float64Array.from([0, -1, -2, -3, -4, -5]);
    const slope = computeLocalSlope(logD, logC, 2);
    for (let i = 0; i < slope.length; i++) expect(slope[i]).toBeCloseTo(-1, 6);
  });

  it('recovers a -1.5 slope on non-uniform spacing', () => {
    const logD = Float64Array.from([0, 0.3, 0.7, 1.2, 2.0]);
    const logC = Float64Array.from([...logD].map((x) => -1.5 * x + 2));
    const slope = computeLocalSlope(logD, logC, 2);
    for (let i = 0; i < slope.length; i++) expect(slope[i]).toBeCloseTo(-1.5, 6);
  });

  it('tracks a change in slope between two regimes', () => {
    // Flat (slope 0) for the first half, steep (slope -2) for the second.
    const logD = Float64Array.from([0, 1, 2, 3, 4, 5, 6]);
    const logC = Float64Array.from([0, 0, 0, 0, -2, -4, -6]);
    const slope = computeLocalSlope(logD, logC, 1);
    expect(slope[1]).toBeCloseTo(0, 6); // inside the flat regime
    expect(slope[5]).toBeCloseTo(-2, 6); // inside the steep regime
  });

  it('is NaN where the window has fewer than two finite points', () => {
    const slope = computeLocalSlope(Float64Array.from([1]), Float64Array.from([1]), 2);
    expect(Number.isNaN(slope[0])).toBe(true);
  });
});
