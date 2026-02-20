import { describe, it, expect } from 'vitest';
import {
  computeContactDecay,
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
    expect(result.decayExponent).toBe(0);
    expect(result.rSquared).toBe(0);
  });

  it('handles empty contig ranges', () => {
    const map = makePowerLawMap(32, -1.0);
    const result = computeContactDecay(map, 32, []);
    expect(result.distances.length).toBe(0);
    expect(result.decayExponent).toBe(0);
  });

  it('handles zero contact map', () => {
    const map = new Float32Array(32 * 32);
    const result = computeContactDecay(map, 32, singleContigRange(32));
    // All zeros → no positive contacts → empty distances
    expect(result.distances.length).toBe(0);
    expect(result.decayExponent).toBe(0);
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
