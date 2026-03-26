/**
 * Tests for HealthScore — composite assembly quality score.
 */
import { describe, it, expect } from 'vitest';
import {
  computeHealthScore,
  type HealthScoreInput,
} from '../../src/analysis/HealthScore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<HealthScoreInput> = {}): HealthScoreInput {
  return {
    n50: 50_000_000,
    totalLength: 100_000_000,
    contigCount: 10,
    decayExponent: -1.15,
    decayRSquared: 0.98,
    misassemblyCount: 0,
    eigenvalue: 0.5,
    cisTransRatio: 0.7,
    checkerboardScore: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeHealthScore — overall
// ---------------------------------------------------------------------------

describe('computeHealthScore', () => {
  it('returns high score for a perfect assembly', () => {
    const input = makeInput({
      n50: 100_000_000,
      totalLength: 100_000_000,
      contigCount: 1,
      decayExponent: -1.15,
      misassemblyCount: 0,
      eigenvalue: 0.5,
    });
    const result = computeHealthScore(input);
    expect(result.overall).toBeGreaterThanOrEqual(95);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('returns lower score when misassemblies are present', () => {
    const good = computeHealthScore(makeInput({ misassemblyCount: 0 }));
    const bad = computeHealthScore(makeInput({ misassemblyCount: 5 }));
    expect(bad.overall).toBeLessThan(good.overall);
  });

  it('returns lower score when P(s) exponent is outside ideal range', () => {
    const ideal = computeHealthScore(makeInput({ decayExponent: -1.15 }));
    const poor = computeHealthScore(makeInput({ decayExponent: -0.3 }));
    expect(poor.overall).toBeLessThan(ideal.overall);
  });

  it('handles null decay and compartments gracefully (falls back to 50)', () => {
    const result = computeHealthScore(makeInput({
      decayExponent: null,
      decayRSquared: null,
      eigenvalue: null,
    }));
    expect(result.components.decayQuality).toBe(50);
    expect(result.components.compartments).toBe(50);
    expect(result.overall).toBeGreaterThan(0);
  });

  it('handles zero contigs gracefully', () => {
    const result = computeHealthScore(makeInput({
      n50: 0,
      totalLength: 0,
      contigCount: 0,
    }));
    expect(result.components.contiguity).toBe(0);
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });

  it('overall score is always in [0, 100]', () => {
    // Worst case: everything bad
    const worst = computeHealthScore(makeInput({
      n50: 0,
      totalLength: 0,
      contigCount: 0,
      decayExponent: 5.0,
      misassemblyCount: 100,
      eigenvalue: 0,
    }));
    expect(worst.overall).toBeGreaterThanOrEqual(0);
    expect(worst.overall).toBeLessThanOrEqual(100);

    // Best case: everything perfect
    const best = computeHealthScore(makeInput({
      n50: 100_000_000,
      totalLength: 100_000_000,
      contigCount: 1,
      decayExponent: -1.15,
      misassemblyCount: 0,
      eigenvalue: 1.0,
    }));
    expect(best.overall).toBeGreaterThanOrEqual(0);
    expect(best.overall).toBeLessThanOrEqual(100);
  });

  it('all component scores are in [0, 100]', () => {
    const result = computeHealthScore(makeInput({
      decayExponent: -5.0,
      misassemblyCount: 50,
      eigenvalue: 10.0,
    }));
    const c = result.components;
    expect(c.contiguity).toBeGreaterThanOrEqual(0);
    expect(c.contiguity).toBeLessThanOrEqual(100);
    expect(c.decayQuality).toBeGreaterThanOrEqual(0);
    expect(c.decayQuality).toBeLessThanOrEqual(100);
    expect(c.integrity).toBeGreaterThanOrEqual(0);
    expect(c.integrity).toBeLessThanOrEqual(100);
    expect(c.compartments).toBeGreaterThanOrEqual(0);
    expect(c.compartments).toBeLessThanOrEqual(100);
    expect(c.libraryQuality).toBeGreaterThanOrEqual(0);
    expect(c.libraryQuality).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Individual components
// ---------------------------------------------------------------------------

describe('contiguity component', () => {
  it('scores 100 when N50 equals total length (single contig)', () => {
    const result = computeHealthScore(makeInput({
      n50: 100_000_000,
      totalLength: 100_000_000,
      contigCount: 1,
    }));
    expect(result.components.contiguity).toBe(100);
  });

  it('scores ~0 when N50/total = 0.1 (log10 boundary)', () => {
    const result = computeHealthScore(makeInput({
      n50: 10_000_000,
      totalLength: 100_000_000,
      contigCount: 10,
    }));
    // N50/total = 0.1 → log10(0.1) = -1 → (1 + -1) * 100 = 0
    expect(result.components.contiguity).toBe(0);
  });

  it('scores 0 for highly fragmented assembly', () => {
    const result = computeHealthScore(makeInput({
      n50: 1_000,
      totalLength: 100_000_000,
      contigCount: 100_000,
    }));
    // N50/total = 1e-5 → far below 0.1 threshold → 0
    expect(result.components.contiguity).toBe(0);
  });

  it('scores ~50 when N50/total ≈ 0.316 (sqrt of 0.1)', () => {
    const result = computeHealthScore(makeInput({
      n50: 31_600_000,
      totalLength: 100_000_000,
      contigCount: 4,
    }));
    // log10(0.316) ≈ -0.5 → (1 + -0.5) * 100 = 50
    expect(result.components.contiguity).toBeGreaterThan(45);
    expect(result.components.contiguity).toBeLessThan(55);
  });

  it('scores 0 when totalLength is 0', () => {
    const result = computeHealthScore(makeInput({
      n50: 0,
      totalLength: 0,
      contigCount: 0,
    }));
    expect(result.components.contiguity).toBe(0);
  });

  it('monotonically increases with N50/total ratio', () => {
    const low = computeHealthScore(makeInput({
      n50: 20_000_000,
      totalLength: 100_000_000,
      contigCount: 5,
    }));
    const mid = computeHealthScore(makeInput({
      n50: 50_000_000,
      totalLength: 100_000_000,
      contigCount: 2,
    }));
    const high = computeHealthScore(makeInput({
      n50: 90_000_000,
      totalLength: 100_000_000,
      contigCount: 2,
    }));
    expect(mid.components.contiguity).toBeGreaterThan(low.components.contiguity);
    expect(high.components.contiguity).toBeGreaterThan(mid.components.contiguity);
  });
});

describe('decay quality component', () => {
  it('scores 100 when exponent is at ideal center (-1.15)', () => {
    const result = computeHealthScore(makeInput({ decayExponent: -1.15 }));
    expect(result.components.decayQuality).toBe(100);
  });

  it('scores low when exponent is far from ideal', () => {
    const result = computeHealthScore(makeInput({ decayExponent: -0.3 }));
    expect(result.components.decayQuality).toBeCloseTo(0, 5);
  });

  it('scores 50 when exponent is null', () => {
    const result = computeHealthScore(makeInput({ decayExponent: null }));
    expect(result.components.decayQuality).toBe(50);
  });

  it('scores moderately for exponent at edge of ideal range', () => {
    const atEdge = computeHealthScore(makeInput({ decayExponent: -0.8 }));
    // distance = 0.35, max = 0.85 → ~59
    expect(atEdge.components.decayQuality).toBeGreaterThan(50);
    expect(atEdge.components.decayQuality).toBeLessThan(70);
  });
});

describe('integrity component', () => {
  it('scores 100 with 0 misassemblies', () => {
    const result = computeHealthScore(makeInput({ misassemblyCount: 0 }));
    expect(result.components.integrity).toBe(100);
  });

  it('scores 0 with 10+ misassemblies', () => {
    const result = computeHealthScore(makeInput({ misassemblyCount: 10 }));
    expect(result.components.integrity).toBe(0);
  });

  it('scores 50 with 5 misassemblies', () => {
    const result = computeHealthScore(makeInput({ misassemblyCount: 5 }));
    expect(result.components.integrity).toBe(50);
  });

  it('clamps to 0 for very high misassembly count', () => {
    const result = computeHealthScore(makeInput({ misassemblyCount: 100 }));
    expect(result.components.integrity).toBe(0);
  });
});

describe('compartments component', () => {
  it('scores 100 for eigenvalue >= 0.5', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 0.5 }));
    expect(result.components.compartments).toBe(100);
  });

  it('scores 0 for eigenvalue = 0', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 0 }));
    expect(result.components.compartments).toBe(0);
  });

  it('scores 50 for null eigenvalue', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: null }));
    expect(result.components.compartments).toBe(50);
  });

  it('clamps to 100 for very high eigenvalue', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 5.0 }));
    expect(result.components.compartments).toBe(100);
  });

  it('scores proportionally for small eigenvalue', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 0.25 }));
    // 0.25 * 200 = 50
    expect(result.components.compartments).toBe(50);
  });

  it('blends eigenvalue and checkerboard when both present', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 0.5, checkerboardScore: 60 }));
    // eigenvalue 0.5 → 100, checkerboard 60 → blend = (100 + 60) / 2 = 80
    expect(result.components.compartments).toBe(80);
  });

  it('uses only checkerboard when eigenvalue is null', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: null, checkerboardScore: 75 }));
    expect(result.components.compartments).toBe(75);
  });

  it('uses only eigenvalue when checkerboard is null', () => {
    const result = computeHealthScore(makeInput({ eigenvalue: 0.5, checkerboardScore: null }));
    expect(result.components.compartments).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('health score responds to curation changes', () => {
  it('score changes when N50 improves', () => {
    const before = computeHealthScore(makeInput({ n50: 20_000_000, contigCount: 20 }));
    const after = computeHealthScore(makeInput({ n50: 80_000_000, contigCount: 2 }));
    // After has much higher N50/total ratio → higher contiguity score
    expect(after.components.contiguity).toBeGreaterThan(before.components.contiguity);
    expect(after.overall).toBeGreaterThan(before.overall);
  });

  it('score drops when misassemblies increase after cuts', () => {
    const before = computeHealthScore(makeInput({ misassemblyCount: 2 }));
    const after = computeHealthScore(makeInput({ misassemblyCount: 8 }));
    expect(after.overall).toBeLessThan(before.overall);
  });
});
