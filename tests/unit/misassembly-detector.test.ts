import { describe, it, expect, beforeEach } from 'vitest';
import type { InsulationResult } from '../../src/analysis/InsulationScore';
import type { CompartmentResult } from '../../src/analysis/CompartmentAnalysis';
import type { ContigRange } from '../../src/curation/AutoSort';
import {
  detectMisassemblies,
  misassemblyToTrack,
  buildCutSuggestions,
  scoreCutConfidence,
  type MisassemblyFlag,
  type CutSuggestion,
} from '../../src/analysis/MisassemblyDetector';
import { misassemblyFlags } from '../../src/curation/MisassemblyFlags';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInsulation(boundaries: number[], strengths: number[], size = 100): InsulationResult {
  return {
    rawScores: new Float64Array(size),
    normalizedScores: new Float32Array(size),
    boundaries,
    boundaryStrengths: strengths,
  };
}

function makeCompartments(eigenvector: number[], size?: number): CompartmentResult {
  const ev = new Float32Array(eigenvector);
  return {
    eigenvector: ev,
    normalizedEigenvector: new Float32Array(size ?? eigenvector.length),
    iterations: 50,
    eigenvalue: 3.0,
  };
}

function makeRanges(specs: [number, number][]): ContigRange[] {
  return specs.map(([start, end], i) => ({ start, end, orderIndex: i }));
}

// ---------------------------------------------------------------------------
// detectMisassemblies
// ---------------------------------------------------------------------------

describe('detectMisassemblies', () => {
  describe('TAD boundary detection', () => {
    it('flags internal TAD boundary', () => {
      // One contig spanning 0-20, boundary at pixel 10 (well inside)
      const insulation = makeInsulation([10], [0.5], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].reason).toBe('tad_boundary');
      expect(result.flags[0].orderIndex).toBe(0);
      expect(result.flags[0].overviewPixel).toBe(10);
      expect(result.flags[0].strength).toBe(0.5);
    });

    it('ignores TAD boundary at contig edge', () => {
      // Boundary at pixel 1, which is within edgeMargin (default 2) of start
      const insulation = makeInsulation([1], [0.5], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(0);
    });

    it('ignores TAD boundary near contig end', () => {
      // Boundary at pixel 19, within margin of end (20)
      const insulation = makeInsulation([19], [0.5], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(0);
    });

    it('flags boundary in the correct contig of multiple', () => {
      // Two contigs: [0,15) and [15,30). Boundary at pixel 22 is in second contig.
      const insulation = makeInsulation([22], [0.8], 30);
      const compartments = makeCompartments(new Array(30).fill(0.3));
      const ranges = makeRanges([[0, 15], [15, 30]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].orderIndex).toBe(1);
    });

    it('flags multiple boundaries in different contigs', () => {
      const insulation = makeInsulation([7, 22], [0.5, 0.6], 30);
      const compartments = makeCompartments(new Array(30).fill(0.3));
      const ranges = makeRanges([[0, 15], [15, 30]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(2);
      expect(result.flaggedContigs.size).toBe(2);
    });
  });

  describe('compartment switch detection', () => {
    it('flags internal compartment sign-change', () => {
      // One contig spanning 0-20. Sign change at index 10 (positive → negative)
      const ev = new Array(20).fill(0.5);
      ev[10] = -0.5; ev[11] = -0.5; ev[12] = -0.5;
      const insulation = makeInsulation([], [], 20);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags.length).toBeGreaterThanOrEqual(1);
      const switchFlag = result.flags.find(f => f.reason === 'compartment_switch');
      expect(switchFlag).toBeDefined();
      expect(switchFlag!.overviewPixel).toBe(10);
    });

    it('ignores compartment switch at contig edge', () => {
      // Sign change at index 1 (within margin of contig start at 0)
      const ev = new Array(20).fill(0.5);
      ev[0] = -0.5;
      const insulation = makeInsulation([], [], 20);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(0);
    });

    it('detects multiple sign changes in one contig', () => {
      // +, +, +, +, +, -, -, -, +, +, +, +, +, +, +, -, -, -, -, +
      const ev = [0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
                  0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5];
      const insulation = makeInsulation([], [], 20);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      // Sign changes at: 5 (+ to -), 8 (- to +), 15 (+ to -), 19 (- to +)
      // 19 is within margin of end (20), so skipped. 5, 8, 15 internal.
      const switchFlags = result.flags.filter(f => f.reason === 'compartment_switch');
      expect(switchFlags.length).toBe(3);
    });
  });

  describe('merge logic', () => {
    it('merges nearby TAD boundary and compartment switch', () => {
      // TAD boundary at pixel 10, compartment switch at pixel 11
      const ev = new Array(20).fill(0.5);
      ev[11] = -0.5; ev[12] = -0.5;
      const insulation = makeInsulation([10], [0.4], 20);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      const bothFlags = result.flags.filter(f => f.reason === 'both');
      expect(bothFlags).toHaveLength(1);
      expect(bothFlags[0].overviewPixel).toBe(11); // midpoint of 10 and 11, rounded
      expect(bothFlags[0].strength).toBeGreaterThan(0.4); // combined
    });

    it('does not merge signals from different contigs', () => {
      // TAD boundary at pixel 14, compartment switch at pixel 15 — different contigs
      const ev = new Array(30).fill(0.5);
      ev[15] = -0.5; ev[16] = -0.5;
      const insulation = makeInsulation([14], [0.3], 30);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 15], [15, 30]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      // pixel 14 is within margin of contig 0 end (15), so not flagged
      // pixel 15 is at the start of contig 1, within margin, so not flagged
      expect(result.flags.filter(f => f.reason === 'both')).toHaveLength(0);
    });

    it('does not merge distant signals in same contig', () => {
      // TAD boundary at pixel 5, compartment switch at pixel 14
      // Make negative region extend to end to avoid sign-change-back
      const ev = new Array(20).fill(0.5);
      for (let i = 14; i < 20; i++) ev[i] = -0.5;
      const insulation = makeInsulation([5], [0.3], 20);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      // Distance 14-5 = 9 > mergeRadius (3), so no merge
      expect(result.flags.filter(f => f.reason === 'both')).toHaveLength(0);
      expect(result.flags.length).toBe(2); // separate flags
    });
  });

  describe('edge cases', () => {
    it('returns empty result with no boundaries and uniform eigenvector', () => {
      const insulation = makeInsulation([], [], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(0);
      expect(result.flaggedContigs.size).toBe(0);
      expect(result.summary.total).toBe(0);
    });

    it('skips tiny contigs below minimum span', () => {
      // Contig spanning only 3 pixels, default margin=2, min span = 2*2+1 = 5
      const insulation = makeInsulation([1], [0.5], 10);
      const compartments = makeCompartments(new Array(10).fill(0.5));
      const ranges = makeRanges([[0, 3], [3, 10]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      // Boundary at pixel 1 is in tiny contig [0,3), skipped
      expect(result.flags).toHaveLength(0);
    });

    it('respects custom margin parameter', () => {
      // With margin=1, boundary at pixel 1 in contig [0,10) is internal
      const insulation = makeInsulation([1], [0.5], 10);
      const compartments = makeCompartments(new Array(10).fill(0.5));
      const ranges = makeRanges([[0, 10]]);

      const result = detectMisassemblies(insulation, compartments, ranges, { edgeMargin: 1 });
      expect(result.flags).toHaveLength(1);
    });

    it('handles empty contig ranges', () => {
      const insulation = makeInsulation([5], [0.5], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));

      const result = detectMisassemblies(insulation, compartments, []);
      expect(result.flags).toHaveLength(0);
    });
  });

  describe('summary', () => {
    it('correctly counts by reason', () => {
      // Contig [0,50). TAD at 15 (standalone), TAD at 35 (merges with switch at 32).
      // Eigenvector: +0.5 for [0..7], -0.5 for [8..31], +0.5 for [32..49]
      // → sign changes at 8 (compartment_only) and 32 (merges with TAD at 35)
      const ev = new Array(50).fill(0.5);
      for (let i = 8; i < 32; i++) ev[i] = -0.5;
      const insulation = makeInsulation([15, 35], [0.3, 0.4], 50);
      const compartments = makeCompartments(ev);
      const ranges = makeRanges([[0, 50]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.summary.total).toBe(3);
      expect(result.summary.tadOnly).toBe(1);      // TAD at 15
      expect(result.summary.compartmentOnly).toBe(1); // switch at 8
      expect(result.summary.both).toBe(1);           // TAD 35 + switch 32
    });

    it('flaggedContigs has unique contig count', () => {
      // Two boundaries in the same contig
      const insulation = makeInsulation([5, 10], [0.3, 0.4], 20);
      const compartments = makeCompartments(new Array(20).fill(0.5));
      const ranges = makeRanges([[0, 20]]);

      const result = detectMisassemblies(insulation, compartments, ranges);
      expect(result.flags).toHaveLength(2);
      expect(result.flaggedContigs.size).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// misassemblyToTrack
// ---------------------------------------------------------------------------

describe('misassemblyToTrack', () => {
  it('creates a marker track with correct positions', () => {
    const result: import('../../src/analysis/MisassemblyDetector').MisassemblyResult = {
      flags: [
        { orderIndex: 0, overviewPixel: 50, reason: 'tad_boundary', strength: 0.5 },
        { orderIndex: 1, overviewPixel: 75, reason: 'compartment_switch', strength: 0.3 },
      ],
      flaggedContigs: new Set([0, 1]),
      summary: { tadOnly: 1, compartmentOnly: 1, both: 0, total: 2 },
    };

    const track = misassemblyToTrack(result, 100, 1024);
    expect(track.name).toBe('Misassembly Flags');
    expect(track.type).toBe('marker');
    expect(track.data).toHaveLength(1024);
    // Pixel 50 in overview → 50/100 * 1024 = 512 in texture
    expect(track.data[512]).toBe(1);
    // Pixel 75 in overview → 75/100 * 1024 = 768 in texture
    expect(track.data[768]).toBe(1);
    expect(track.color).toBe('rgb(255, 165, 0)');
    expect(track.visible).toBe(true);
  });

  it('handles empty result', () => {
    const result: import('../../src/analysis/MisassemblyDetector').MisassemblyResult = {
      flags: [],
      flaggedContigs: new Set(),
      summary: { tadOnly: 0, compartmentOnly: 0, both: 0, total: 0 },
    };

    const track = misassemblyToTrack(result, 100, 1024);
    expect(track.data.every(v => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MisassemblyFlagManager
// ---------------------------------------------------------------------------

describe('MisassemblyFlagManager', () => {
  beforeEach(() => {
    misassemblyFlags.clearAll();
  });

  it('setFlags populates flagged state', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
      { orderIndex: 2, overviewPixel: 30, reason: 'compartment_switch', strength: 0.3 },
    ];
    misassemblyFlags.setFlags(flags);

    expect(misassemblyFlags.isFlagged(0)).toBe(true);
    expect(misassemblyFlags.isFlagged(1)).toBe(false);
    expect(misassemblyFlags.isFlagged(2)).toBe(true);
    expect(misassemblyFlags.getFlaggedCount()).toBe(2);
  });

  it('getFlagged returns a copy', () => {
    misassemblyFlags.setFlags([
      { orderIndex: 3, overviewPixel: 10, reason: 'both', strength: 1.0 },
    ]);
    const set = misassemblyFlags.getFlagged();
    set.delete(3);
    expect(misassemblyFlags.isFlagged(3)).toBe(true);
  });

  it('getFlagDetails returns per-contig flags', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
      { orderIndex: 0, overviewPixel: 15, reason: 'compartment_switch', strength: 0.3 },
      { orderIndex: 1, overviewPixel: 30, reason: 'both', strength: 0.8 },
    ];
    misassemblyFlags.setFlags(flags);

    expect(misassemblyFlags.getFlagDetails(0)).toHaveLength(2);
    expect(misassemblyFlags.getFlagDetails(1)).toHaveLength(1);
    expect(misassemblyFlags.getFlagDetails(5)).toHaveLength(0);
  });

  it('setFlags replaces previous state', () => {
    misassemblyFlags.setFlags([
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
    ]);
    expect(misassemblyFlags.isFlagged(0)).toBe(true);

    misassemblyFlags.setFlags([
      { orderIndex: 5, overviewPixel: 50, reason: 'both', strength: 1.0 },
    ]);
    expect(misassemblyFlags.isFlagged(0)).toBe(false);
    expect(misassemblyFlags.isFlagged(5)).toBe(true);
  });

  it('clearAll resets everything', () => {
    misassemblyFlags.setFlags([
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
    ]);
    misassemblyFlags.clearAll();
    expect(misassemblyFlags.isFlagged(0)).toBe(false);
    expect(misassemblyFlags.getFlaggedCount()).toBe(0);
    expect(misassemblyFlags.getFlagDetails(0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCutConfidence
// ---------------------------------------------------------------------------

describe('scoreCutConfidence', () => {
  function makeSuggestion(overrides: Partial<CutSuggestion> = {}): CutSuggestion {
    return {
      orderIndex: 0,
      contigId: 0,
      contigName: 'ctg1',
      pixelOffset: 50,
      reason: 'tad_boundary',
      strength: 0.5,
      ...overrides,
    };
  }

  it('assigns confidence to suggestions', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
    ];
    const suggestions = [makeSuggestion({ orderIndex: 0, strength: 0.5 })];
    const ranges = makeRanges([[0, 20]]);

    scoreCutConfidence(suggestions, flags, null, null, null, ranges);

    expect(suggestions[0].confidence).toBeDefined();
    expect(suggestions[0].confidence!.score).toBeGreaterThanOrEqual(0);
    expect(suggestions[0].confidence!.score).toBeLessThanOrEqual(1);
    expect(['high', 'medium', 'low']).toContain(suggestions[0].confidence!.level);
  });

  it('returns higher confidence for stronger TAD signals', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 1.0 },
      { orderIndex: 1, overviewPixel: 25, reason: 'tad_boundary', strength: 0.1 },
    ];
    const suggestions = [
      makeSuggestion({ orderIndex: 0, strength: 1.0 }),
      makeSuggestion({ orderIndex: 1, contigName: 'ctg2', strength: 0.1 }),
    ];
    const ranges = makeRanges([[0, 20], [20, 40]]);

    scoreCutConfidence(suggestions, flags, null, null, null, ranges);

    expect(suggestions[0].confidence!.score).toBeGreaterThan(suggestions[1].confidence!.score);
  });

  it('incorporates compartment eigenvector delta', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'both', strength: 0.5 },
    ];
    const suggestions = [makeSuggestion({ orderIndex: 0, strength: 0.5 })];
    const ranges = makeRanges([[0, 20]]);

    // Large eigenvector jump at pixel 10
    const eigenvector = new Float32Array(20);
    for (let i = 0; i < 10; i++) eigenvector[i] = 0.5;
    for (let i = 10; i < 20; i++) eigenvector[i] = -0.5;

    scoreCutConfidence(suggestions, flags, null, eigenvector, null, ranges);

    expect(suggestions[0].confidence!.components.compartment).toBeGreaterThan(0);
  });

  it('handles empty suggestions array', () => {
    scoreCutConfidence([], [], null, null, null, []);
    // Should not throw
  });

  it('assigns low confidence when no secondary signals', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.2 },
    ];
    const suggestions = [makeSuggestion({ orderIndex: 0, strength: 0.2 })];
    const ranges = makeRanges([[0, 20]]);

    scoreCutConfidence(suggestions, flags, null, null, null, ranges);

    // With only weak TAD signal and no compartment/decay, should be low-medium
    expect(suggestions[0].confidence!.score).toBeLessThan(0.7);
  });

  it('correctly classifies confidence levels', () => {
    // Create suggestions with varying strengths
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'both', strength: 1.0 },
    ];
    const suggestions = [makeSuggestion({ orderIndex: 0, strength: 1.0 })];
    const ranges = makeRanges([[0, 20]]);

    // With strong TAD + compartment signal
    const eigenvector = new Float32Array(20);
    for (let i = 0; i < 10; i++) eigenvector[i] = 1.0;
    for (let i = 10; i < 20; i++) eigenvector[i] = -1.0;

    scoreCutConfidence(suggestions, flags, null, eigenvector, null, ranges);

    // Strong TAD (1.0/1.0 = 1.0 * 0.5 = 0.5) + strong compartment (tanh(4) ~ 1.0 * 0.3 = 0.3)
    // Total should be >= 0.7 → 'high'
    expect(suggestions[0].confidence!.level).toBe('high');
  });

  it('components sum correctly into score', () => {
    const flags: MisassemblyFlag[] = [
      { orderIndex: 0, overviewPixel: 10, reason: 'tad_boundary', strength: 0.5 },
    ];
    const suggestions = [makeSuggestion({ orderIndex: 0, strength: 0.5 })];
    const ranges = makeRanges([[0, 20]]);

    scoreCutConfidence(suggestions, flags, null, null, null, ranges);

    const conf = suggestions[0].confidence!;
    const expected = 0.5 * conf.components.tad + 0.3 * conf.components.compartment + 0.2 * conf.components.decay;
    expect(conf.score).toBeCloseTo(expected, 5);
  });
});
