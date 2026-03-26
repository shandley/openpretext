import { describe, it, expect } from 'vitest';
import {
  computeHiCQuality,
  qualityToTrack,
} from '../../src/analysis/HiCQualityMetrics';
import type { ContigRange } from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRanges(specs: [number, number][]): ContigRange[] {
  return specs.map(([start, end], i) => ({ start, end, orderIndex: i }));
}

function buildMap(size: number, fill = 0): Float32Array {
  return new Float32Array(size * size).fill(fill);
}

function setContact(m: Float32Array, size: number, i: number, j: number, v: number): void {
  m[i * size + j] = v;
  m[j * size + i] = v;
}

// ---------------------------------------------------------------------------
// computeHiCQuality
// ---------------------------------------------------------------------------

describe('computeHiCQuality', () => {
  it('handles empty input', () => {
    const result = computeHiCQuality(new Float32Array(0), 0, [], [], new Map());
    expect(result.cisTransRatio).toBe(0);
    expect(result.cisPercentage).toBe(0);
    expect(result.perContigCisRatio.length).toBe(0);
  });

  it('computes 100% cis when all contacts within one scaffold', () => {
    const size = 10;
    const m = buildMap(size, 1);
    const ranges = makeRanges([[0, 10]]);
    const scaffoldIds = [0]; // All in scaffold 0
    const names = new Map([[0, 'chr1']]);
    const result = computeHiCQuality(m, size, ranges, scaffoldIds, names);
    expect(result.cisPercentage).toBe(100);
    expect(result.cisTransRatio).toBe(1);
  });

  it('computes 0% cis when no scaffolds assigned', () => {
    const size = 10;
    const m = buildMap(size, 1);
    const ranges = makeRanges([[0, 5], [5, 10]]);
    const scaffoldIds = [-1, -1]; // No scaffolds
    const result = computeHiCQuality(m, size, ranges, scaffoldIds, new Map());
    expect(result.cisPercentage).toBe(0);
    expect(result.cisTransRatio).toBe(0);
  });

  it('correctly separates cis and trans contacts', () => {
    const size = 20;
    const m = buildMap(size);
    const ranges = makeRanges([[0, 10], [10, 20]]);
    const scaffoldIds = [0, 1]; // Different scaffolds
    const names = new Map([[0, 'chr1'], [1, 'chr2']]);

    // Add cis contacts (within scaffold)
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        setContact(m, size, i, j, 1.0);
      }
    }
    for (let i = 10; i < 20; i++) {
      for (let j = i + 1; j < 20; j++) {
        setContact(m, size, i, j, 1.0);
      }
    }

    // Add trans contacts (between scaffolds)
    for (let i = 0; i < 10; i++) {
      for (let j = 10; j < 20; j++) {
        setContact(m, size, i, j, 0.1);
      }
    }

    const result = computeHiCQuality(m, size, ranges, scaffoldIds, names);
    expect(result.cisPercentage).toBeGreaterThan(50);
    expect(result.cisTransRatio).toBeGreaterThan(0.5);
    expect(result.cisTransRatio).toBeLessThan(1);
  });

  it('computes contact density', () => {
    const size = 10;
    const m = buildMap(size, 2);
    const ranges = makeRanges([[0, 10]]);
    const result = computeHiCQuality(m, size, ranges, [0], new Map([[0, 'chr1']]));
    expect(result.contactDensity).toBeCloseTo(2, 1);
  });

  it('computes long/short ratio', () => {
    const size = 40;
    const m = buildMap(size);
    const ranges = makeRanges([[0, 40]]);
    const scaffoldIds = [0];

    // Short range (d <= 20): strong
    for (let i = 0; i < size; i++) {
      for (let d = 1; d <= 20; d++) {
        const j = i + d;
        if (j < size) setContact(m, size, i, j, 2.0);
      }
    }
    // Long range (d > 20): weak
    for (let i = 0; i < size; i++) {
      for (let d = 21; d < size; d++) {
        const j = i + d;
        if (j < size) setContact(m, size, i, j, 0.5);
      }
    }

    const result = computeHiCQuality(m, size, ranges, scaffoldIds, new Map([[0, 'chr1']]));
    expect(result.longShortRatio).toBeGreaterThan(0);
    expect(result.longShortRatio).toBeLessThan(1);
  });

  it('computes per-contig cis ratio', () => {
    const size = 20;
    const m = buildMap(size, 0.1);
    const ranges = makeRanges([[0, 10], [10, 20]]);
    const scaffoldIds = [0, 0]; // Same scaffold
    const result = computeHiCQuality(m, size, ranges, scaffoldIds, new Map([[0, 'chr1']]));
    expect(result.perContigCisRatio.length).toBe(2);
    // All in same scaffold → cis ratio = 1
    expect(result.perContigCisRatio[0]).toBeCloseTo(1, 1);
    expect(result.perContigCisRatio[1]).toBeCloseTo(1, 1);
  });

  it('flags contigs with low cis ratio', () => {
    const size = 30;
    const m = buildMap(size);
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const scaffoldIds = [0, 1, 0]; // Contig 1 is alone in scaffold 1

    // Strong contacts between contigs 0 and 2 (same scaffold, but not adjacent)
    for (let i = 0; i < 10; i++) {
      for (let j = 20; j < 30; j++) {
        setContact(m, size, i, j, 1.0);
      }
    }

    // Contig 1 has mostly trans contacts (with 0 and 2)
    for (let i = 10; i < 20; i++) {
      for (let j = 0; j < 10; j++) {
        setContact(m, size, i, j, 1.0);
      }
    }

    const result = computeHiCQuality(m, size, ranges, scaffoldIds, new Map([[0, 'chr1'], [1, 'chr2']]));
    // Contig 1 should have low cis ratio (it's alone in its scaffold, most contacts are trans)
    expect(result.flaggedContigs).toContain(1);
  });

  it('computes per-scaffold cis results', () => {
    const size = 20;
    const m = buildMap(size, 1);
    const ranges = makeRanges([[0, 10], [10, 20]]);
    const scaffoldIds = [0, 1];
    const names = new Map([[0, 'chr1'], [1, 'chr2']]);
    const result = computeHiCQuality(m, size, ranges, scaffoldIds, names);
    expect(result.perScaffoldCis.length).toBe(2);
    expect(result.perScaffoldCis[0].name).toBeDefined();
  });

  it('handles zero-contact map', () => {
    const size = 10;
    const m = buildMap(size, 0);
    const ranges = makeRanges([[0, 5], [5, 10]]);
    const result = computeHiCQuality(m, size, ranges, [0, 1], new Map([[0, 'a'], [1, 'b']]));
    expect(result.cisTransRatio).toBe(0);
    expect(result.contactDensity).toBe(0);
    expect(result.longShortRatio).toBe(0);
  });

  it('handles missing scaffold IDs', () => {
    const size = 10;
    const m = buildMap(size, 1);
    const ranges = makeRanges([[0, 5], [5, 10]]);
    // Only one scaffold ID (missing second)
    const result = computeHiCQuality(m, size, ranges, [0], new Map([[0, 'chr1']]));
    expect(result.perContigCisRatio.length).toBe(2);
  });

  it('sorts per-scaffold results by contact count', () => {
    const size = 30;
    const m = buildMap(size);
    const ranges = makeRanges([[0, 10], [10, 20], [20, 30]]);
    const scaffoldIds = [0, 1, 2];
    const names = new Map([[0, 'small'], [1, 'big'], [2, 'med']]);

    // Make scaffold 1 have the most contacts
    for (let i = 10; i < 20; i++) {
      for (let j = i + 1; j < 20; j++) {
        setContact(m, size, i, j, 10.0);
      }
    }
    // Some contacts for others
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        setContact(m, size, i, j, 1.0);
      }
    }

    const result = computeHiCQuality(m, size, ranges, scaffoldIds, names);
    if (result.perScaffoldCis.length >= 2) {
      expect(result.perScaffoldCis[0].contactCount).toBeGreaterThanOrEqual(
        result.perScaffoldCis[1].contactCount,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// qualityToTrack
// ---------------------------------------------------------------------------

describe('qualityToTrack', () => {
  it('returns a line track', () => {
    const ranges = makeRanges([[0, 5], [5, 10]]);
    const result = computeHiCQuality(
      buildMap(10, 1), 10, ranges, [0, 0],
      new Map([[0, 'chr1']]),
    );
    const track = qualityToTrack(result, ranges, 10, 20);
    expect(track.name).toBe('Per-Contig Cis Ratio');
    expect(track.type).toBe('line');
    expect(track.data.length).toBe(20);
  });

  it('track data is in [0, 1]', () => {
    const ranges = makeRanges([[0, 5], [5, 10]]);
    const result = computeHiCQuality(
      buildMap(10, 1), 10, ranges, [0, 1],
      new Map([[0, 'a'], [1, 'b']]),
    );
    const track = qualityToTrack(result, ranges, 10, 20);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// HealthScore integration
// ---------------------------------------------------------------------------

describe('HealthScore with libraryQuality', () => {
  it('includes libraryQuality component', async () => {
    const { computeHealthScore } = await import('../../src/analysis/HealthScore');
    const result = computeHealthScore({
      n50: 100,
      totalLength: 1000,
      contigCount: 10,
      decayExponent: -1.15,
      decayRSquared: 0.95,
      misassemblyCount: 0,
      eigenvalue: 0.5,
      cisTransRatio: 0.7,
      checkerboardScore: null,
    });
    expect(result.components.libraryQuality).toBeDefined();
    expect(result.components.libraryQuality).toBeGreaterThan(0);
  });

  it('libraryQuality = 100 at cisTransRatio >= 0.7', async () => {
    const { computeHealthScore } = await import('../../src/analysis/HealthScore');
    const result = computeHealthScore({
      n50: 100,
      totalLength: 100,
      contigCount: 1,
      decayExponent: -1.15,
      decayRSquared: 0.95,
      misassemblyCount: 0,
      eigenvalue: 0.5,
      cisTransRatio: 0.7,
      checkerboardScore: null,
    });
    expect(result.components.libraryQuality).toBe(100);
  });

  it('libraryQuality = 50 when cisTransRatio is null', async () => {
    const { computeHealthScore } = await import('../../src/analysis/HealthScore');
    const result = computeHealthScore({
      n50: 100,
      totalLength: 100,
      contigCount: 1,
      decayExponent: null,
      decayRSquared: null,
      misassemblyCount: 0,
      eigenvalue: null,
      cisTransRatio: null,
      checkerboardScore: null,
    });
    expect(result.components.libraryQuality).toBe(50);
  });

  it('libraryQuality scales with cisTransRatio', async () => {
    const { computeHealthScore } = await import('../../src/analysis/HealthScore');
    const low = computeHealthScore({
      n50: 100, totalLength: 100, contigCount: 1,
      decayExponent: null, decayRSquared: null,
      misassemblyCount: 0, eigenvalue: null,
      cisTransRatio: 0.2, checkerboardScore: null,
    });
    const high = computeHealthScore({
      n50: 100, totalLength: 100, contigCount: 1,
      decayExponent: null, decayRSquared: null,
      misassemblyCount: 0, eigenvalue: null,
      cisTransRatio: 0.6, checkerboardScore: null,
    });
    expect(high.components.libraryQuality).toBeGreaterThan(low.components.libraryQuality);
  });
});
