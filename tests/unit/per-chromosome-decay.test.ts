import { describe, it, expect } from 'vitest';
import {
  computeContactDecay,
  computeDecayByScaffold,
  type ScaffoldGroup,
} from '../../src/analysis/ContactDecay';
import type { ContigRange } from '../../src/curation/AutoSort';
import type { SessionScaffoldDecay } from '../../src/io/SessionManager';
import { validateSession, SESSION_VERSION } from '../../src/io/SessionManager';

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

function makeMinimalSession(analysis?: Record<string, unknown>) {
  return {
    version: SESSION_VERSION,
    filename: 'test.pretext',
    timestamp: Date.now(),
    contigOrder: [0, 1],
    contigStates: {
      0: { inverted: false, scaffoldId: null },
      1: { inverted: false, scaffoldId: null },
    },
    scaffolds: [],
    waypoints: [],
    camera: { x: 0.5, y: 0.5, zoom: 1 },
    settings: { colorMapName: 'YlOrRd', gamma: 1, showGrid: true },
    operationLog: [],
    ...(analysis ? { analysis } : {}),
  };
}

// ---------------------------------------------------------------------------
// computeDecayByScaffold
// ---------------------------------------------------------------------------

describe('computeDecayByScaffold', () => {
  it('returns separate results for two scaffolds', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#e6194B', orderIndices: [0, 1] },
      { scaffoldId: 2, name: 'Chr2', color: '#3cb44b', orderIndices: [2, 3] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results.length).toBe(2);
    expect(results[0].scaffoldName).toBe('Chr1');
    expect(results[1].scaffoldName).toBe('Chr2');
  });

  it('preserves scaffold colors', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#ff0000', orderIndices: [0, 1] },
      { scaffoldId: 2, name: 'Chr2', color: '#00ff00', orderIndices: [2, 3] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results[0].color).toBe('#ff0000');
    expect(results[1].color).toBe('#00ff00');
  });

  it('reports correct contig count per scaffold', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#e6194B', orderIndices: [0] },
      { scaffoldId: 2, name: 'Chr2', color: '#3cb44b', orderIndices: [1, 2, 3] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results[0].contigCount).toBe(1);
    expect(results[1].contigCount).toBe(3);
  });

  it('each scaffold produces a valid decay exponent', () => {
    const size = 128;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#e6194B', orderIndices: [0, 1] },
      { scaffoldId: 2, name: 'Chr2', color: '#3cb44b', orderIndices: [2, 3] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    for (const sr of results) {
      expect(sr.decay.decayExponent).toBeLessThan(0);
      expect(sr.decay.rSquared).toBeGreaterThan(0);
      expect(sr.decay.distances.length).toBeGreaterThan(0);
    }
  });

  it('returns empty array for empty scaffold groups', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const results = computeDecayByScaffold(map, size, ranges, []);
    expect(results).toEqual([]);
  });

  it('skips scaffolds with no matching ranges', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#e6194B', orderIndices: [0, 1] },
      { scaffoldId: 2, name: 'Missing', color: '#3cb44b', orderIndices: [99] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results.length).toBe(1);
    expect(results[0].scaffoldName).toBe('Chr1');
  });

  it('handles scaffold with a single large contig', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges: ContigRange[] = [
      { start: 0, end: 60, orderIndex: 0 },
      { start: 60, end: 64, orderIndex: 1 },
    ];

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Large', color: '#e6194B', orderIndices: [0] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results.length).toBe(1);
    expect(results[0].decay.distances.length).toBeGreaterThan(0);
  });

  it('skips ranges that span 1 pixel or less', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges: ContigRange[] = [
      { start: 0, end: 1, orderIndex: 0 },  // 1 pixel, should be skipped
      { start: 1, end: 32, orderIndex: 1 },
      { start: 32, end: 64, orderIndex: 2 },
    ];

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Mixed', color: '#e6194B', orderIndices: [0, 1, 2] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results.length).toBe(1);
    // Only 2 ranges should pass the >1 pixel filter
    expect(results[0].contigCount).toBe(2);
  });

  it('scaffoldId is preserved in results', () => {
    const size = 64;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 42, name: 'Chr42', color: '#e6194B', orderIndices: [0, 1] },
    ];

    const results = computeDecayByScaffold(map, size, ranges, groups);
    expect(results[0].scaffoldId).toBe(42);
  });

  it('per-scaffold exponents are independent of genome-wide', () => {
    const size = 128;
    const map = makePowerLawMap(size, -1.0);
    const ranges = makeContigRanges(size, 4);

    const genomeWide = computeContactDecay(map, size, ranges);

    const groups: ScaffoldGroup[] = [
      { scaffoldId: 1, name: 'Chr1', color: '#e6194B', orderIndices: [0, 1] },
      { scaffoldId: 2, name: 'Chr2', color: '#3cb44b', orderIndices: [2, 3] },
    ];

    const perScaffold = computeDecayByScaffold(map, size, ranges, groups);

    // For a uniform power-law map, per-scaffold exponents should be similar
    // to genome-wide but not necessarily identical (different range of distances)
    for (const sr of perScaffold) {
      expect(sr.decay.decayExponent).toBeLessThan(0);
    }
    expect(genomeWide.decayExponent).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Session persistence round-trip
// ---------------------------------------------------------------------------

describe('scaffold decay session persistence', () => {
  it('validates session with scaffoldDecay field', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
      scaffoldDecay: [
        {
          scaffoldId: 1,
          scaffoldName: 'Chr1',
          color: '#e6194B',
          decay: {
            distances: [1, 2, 3],
            meanContacts: [0.5, 0.3, 0.2],
            logDistances: [0, 0.301, 0.477],
            logContacts: [-0.301, -0.523, -0.699],
            decayExponent: -1.1,
            rSquared: 0.98,
            maxDistance: 100,
          },
          contigCount: 5,
        },
      ],
    });
    expect(validateSession(session)).toBe(true);
  });

  it('validates session without scaffoldDecay (backward compatible)', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
    });
    expect(validateSession(session)).toBe(true);
  });

  it('rejects scaffoldDecay with missing scaffoldName', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
      scaffoldDecay: [
        {
          scaffoldId: 1,
          // scaffoldName missing
          color: '#e6194B',
          decay: {
            distances: [1],
            meanContacts: [0.5],
            logDistances: [0],
            logContacts: [-0.301],
            decayExponent: -1.1,
            rSquared: 0.98,
            maxDistance: 100,
          },
          contigCount: 5,
        },
      ],
    });
    expect(validateSession(session)).toBe(false);
  });

  it('rejects scaffoldDecay with invalid decay data', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
      scaffoldDecay: [
        {
          scaffoldId: 1,
          scaffoldName: 'Chr1',
          color: '#e6194B',
          decay: {
            distances: [1],
            meanContacts: [Infinity], // invalid
            logDistances: [0],
            logContacts: [-0.301],
            decayExponent: -1.1,
            rSquared: 0.98,
            maxDistance: 100,
          },
          contigCount: 5,
        },
      ],
    });
    expect(validateSession(session)).toBe(false);
  });

  it('rejects scaffoldDecay with negative contigCount', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
      scaffoldDecay: [
        {
          scaffoldId: 1,
          scaffoldName: 'Chr1',
          color: '#e6194B',
          decay: {
            distances: [1],
            meanContacts: [0.5],
            logDistances: [0],
            logContacts: [-0.301],
            decayExponent: -1.1,
            rSquared: 0.98,
            maxDistance: 100,
          },
          contigCount: -1,
        },
      ],
    });
    expect(validateSession(session)).toBe(false);
  });

  it('validates empty scaffoldDecay array', () => {
    const session = makeMinimalSession({
      insulationWindowSize: 10,
      scaffoldDecay: [],
    });
    expect(validateSession(session)).toBe(true);
  });
});
