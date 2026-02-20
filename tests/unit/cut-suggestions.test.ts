/**
 * Tests for buildCutSuggestions — converting misassembly flags to
 * actionable cut operations with overview → texture pixel conversion.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCutSuggestions,
  detectMisassemblies,
  type MisassemblyFlag,
  type CutSuggestion,
} from '../../src/analysis/MisassemblyDetector';
import type { ContigRange } from '../../src/curation/AutoSort';
import type { ContigInfo } from '../../src/core/State';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContig(name: string, pixelStart: number, pixelEnd: number): ContigInfo {
  return {
    name,
    originalIndex: 0,
    length: (pixelEnd - pixelStart) * 100,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

function makeFlag(
  orderIndex: number,
  overviewPixel: number,
  reason: 'tad_boundary' | 'compartment_switch' | 'both' = 'tad_boundary',
  strength = 1.0,
): MisassemblyFlag {
  return { orderIndex, overviewPixel, reason, strength };
}

// ---------------------------------------------------------------------------
// buildCutSuggestions
// ---------------------------------------------------------------------------

describe('buildCutSuggestions', () => {
  it('converts a single flag to a cut suggestion with correct pixelOffset', () => {
    // Contig 0: texture pixels [0, 100), overview pixels [0, 10)
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];
    const flags = [makeFlag(0, 5)]; // midpoint of overview range

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result).toHaveLength(1);
    expect(result[0].contigName).toBe('ctg1');
    expect(result[0].contigId).toBe(0);
    expect(result[0].orderIndex).toBe(0);
    // overviewPixel 5 / 10 overview span = 0.5 fraction → 50 texture pixels
    expect(result[0].pixelOffset).toBe(50);
  });

  it('places pixelOffset at half for midpoint flag', () => {
    const contigs = [makeContig('ctg1', 0, 200)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 20, orderIndex: 0 }];
    const flags = [makeFlag(0, 10)]; // exactly midpoint

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].pixelOffset).toBe(100);
  });

  it('clamps pixelOffset to >= 1 for flag near contig start', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 100, orderIndex: 0 }];
    // overviewPixel 0 → fraction 0 → pixelOffset 0 → clamped to 1
    const flags = [makeFlag(0, 0)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].pixelOffset).toBe(1);
  });

  it('clamps pixelOffset to <= pixelLength - 1 for flag near contig end', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];
    // overviewPixel 10 → fraction 1.0 → pixelOffset 100 → clamped to 99
    const flags = [makeFlag(0, 10)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].pixelOffset).toBe(99);
  });

  it('produces multiple suggestions for multiple flags in same contig', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];
    const flags = [makeFlag(0, 3), makeFlag(0, 7)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result).toHaveLength(2);
    // Both have orderIndex 0, so stable order from input: pixel 3 first, pixel 7 second
    const offsets = result.map(s => s.pixelOffset).sort((a, b) => a - b);
    expect(offsets).toEqual([30, 70]);
  });

  it('sorts suggestions by orderIndex descending', () => {
    const contigs = [makeContig('ctg1', 0, 100), makeContig('ctg2', 100, 200)];
    const contigOrder = [0, 1];
    const ranges: ContigRange[] = [
      { start: 0, end: 10, orderIndex: 0 },
      { start: 10, end: 20, orderIndex: 1 },
    ];
    const flags = [makeFlag(0, 5), makeFlag(1, 15)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result).toHaveLength(2);
    expect(result[0].orderIndex).toBe(1); // higher index first
    expect(result[1].orderIndex).toBe(0);
  });

  it('returns empty array for empty flags', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];

    const result = buildCutSuggestions([], ranges, contigs, contigOrder);

    expect(result).toHaveLength(0);
  });

  it('preserves reason in output', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];

    const tadResult = buildCutSuggestions(
      [makeFlag(0, 5, 'tad_boundary')],
      ranges, contigs, contigOrder,
    );
    expect(tadResult[0].reason).toBe('tad_boundary');

    const compResult = buildCutSuggestions(
      [makeFlag(0, 5, 'compartment_switch')],
      ranges, contigs, contigOrder,
    );
    expect(compResult[0].reason).toBe('compartment_switch');

    const bothResult = buildCutSuggestions(
      [makeFlag(0, 5, 'both')],
      ranges, contigs, contigOrder,
    );
    expect(bothResult[0].reason).toBe('both');
  });

  it('preserves strength in output', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];
    const flags = [makeFlag(0, 5, 'tad_boundary', 0.85)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].strength).toBe(0.85);
  });

  it('matches contig name from the referenced contig', () => {
    const contigs = [makeContig('alpha', 0, 50), makeContig('beta', 50, 150)];
    const contigOrder = [0, 1];
    const ranges: ContigRange[] = [
      { start: 0, end: 5, orderIndex: 0 },
      { start: 5, end: 15, orderIndex: 1 },
    ];
    const flags = [makeFlag(1, 10)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].contigName).toBe('beta');
    expect(result[0].contigId).toBe(1);
  });

  it('skips flags with invalid orderIndex', () => {
    const contigs = [makeContig('ctg1', 0, 100)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 10, orderIndex: 0 }];
    const flags = [makeFlag(5, 3)]; // orderIndex 5 doesn't exist

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result).toHaveLength(0);
  });

  it('skips contigs with zero pixel span', () => {
    const contigs = [makeContig('tiny', 50, 50)]; // zero span
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 1, orderIndex: 0 }];
    const flags = [makeFlag(0, 0)];

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Coordinate conversion accuracy
// ---------------------------------------------------------------------------

describe('coordinate conversion accuracy', () => {
  it('overview midpoint maps to texture midpoint', () => {
    const contigs = [makeContig('ctg', 200, 400)]; // 200 texture pixels
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 10, end: 30, orderIndex: 0 }];
    const flags = [makeFlag(0, 20)]; // midpoint of [10, 30)

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    // fraction = (20 - 10) / (30 - 10) = 0.5 → 100 texture pixels
    expect(result[0].pixelOffset).toBe(100);
  });

  it('overview pixel near range start gives small texture offset', () => {
    const contigs = [makeContig('ctg', 0, 500)]; // 500 texture pixels
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 50, orderIndex: 0 }];
    const flags = [makeFlag(0, 1)]; // one pixel in from start

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    // fraction = 1/50 = 0.02 → 10 texture pixels
    expect(result[0].pixelOffset).toBe(10);
    expect(result[0].pixelOffset).toBeGreaterThanOrEqual(1);
  });

  it('large contig with proportional offset', () => {
    const contigs = [makeContig('big', 0, 1000)]; // 1000 texture pixels
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 50, orderIndex: 0 }];
    const flags = [makeFlag(0, 15)]; // 15/50 = 0.3

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    expect(result[0].pixelOffset).toBe(300);
  });

  it('handles non-zero range start correctly', () => {
    const contigs = [makeContig('ctg', 300, 500)]; // 200 texture pixels
    const contigOrder = [0];
    // Contig starts at overview pixel 20, not 0
    const ranges: ContigRange[] = [{ start: 20, end: 40, orderIndex: 0 }];
    const flags = [makeFlag(0, 25)]; // 5 pixels into the range

    const result = buildCutSuggestions(flags, ranges, contigs, contigOrder);

    // fraction = (25 - 20) / (40 - 20) = 0.25 → 50 texture pixels
    expect(result[0].pixelOffset).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline integration
// ---------------------------------------------------------------------------

describe('full pipeline: detect → buildSuggestions', () => {
  it('produces valid pixelOffsets from detection results', () => {
    const overviewSize = 100;
    // 3 contigs: [0,30), [30,60), [60,100) in overview space
    const contigs = [
      makeContig('ctg1', 0, 300),   // 300 texture pixels
      makeContig('ctg2', 300, 600),  // 300 texture pixels
      makeContig('ctg3', 600, 1000), // 400 texture pixels
    ];
    const contigOrder = [0, 1, 2];
    const contigRanges: ContigRange[] = [
      { start: 0, end: 30, orderIndex: 0 },
      { start: 30, end: 60, orderIndex: 1 },
      { start: 60, end: 100, orderIndex: 2 },
    ];

    // Build synthetic insulation result with a boundary inside ctg2
    const scores = new Float32Array(overviewSize);
    const boundaries = [45]; // midpoint of ctg2
    const boundaryStrengths = [0.9];
    const insulation = { scores, boundaries, boundaryStrengths };

    // Build synthetic compartment result with sign change inside ctg3
    const eigenvector = new Float32Array(overviewSize);
    eigenvector.fill(0.5);
    for (let i = 80; i < overviewSize; i++) eigenvector[i] = -0.5; // sign change at 80

    const compartments = {
      eigenvector,
      eigenvalue: 1.0,
      iterations: 10,
      correlationMatrix: new Float32Array(0),
    };

    const detectResult = detectMisassemblies(insulation, compartments, contigRanges);
    const suggestions = buildCutSuggestions(
      detectResult.flags, contigRanges, contigs, contigOrder,
    );

    expect(suggestions.length).toBeGreaterThan(0);

    // Verify all pixelOffsets are valid for CurationEngine.cut
    for (const s of suggestions) {
      const contig = contigs[s.contigId];
      const contigPixelLength = contig.pixelEnd - contig.pixelStart;
      expect(s.pixelOffset).toBeGreaterThanOrEqual(1);
      expect(s.pixelOffset).toBeLessThan(contigPixelLength);
    }
  });

  it('produces no suggestions when no misassemblies detected', () => {
    const overviewSize = 20;
    const contigs = [makeContig('ctg1', 0, 200)];
    const contigOrder = [0];
    const ranges: ContigRange[] = [{ start: 0, end: 20, orderIndex: 0 }];

    const insulation = {
      scores: new Float32Array(overviewSize),
      boundaries: [] as number[],
      boundaryStrengths: [] as number[],
    };
    const eigenvector = new Float32Array(overviewSize);
    eigenvector.fill(0.5);
    const compartments = {
      eigenvector,
      eigenvalue: 1.0,
      iterations: 10,
      correlationMatrix: new Float32Array(0),
    };

    const detectResult = detectMisassemblies(insulation, compartments, ranges);
    const suggestions = buildCutSuggestions(
      detectResult.flags, ranges, contigs, contigOrder,
    );

    expect(suggestions).toHaveLength(0);
  });
});
