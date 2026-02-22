import { describe, it, expect } from 'vitest';
import {
  digitizeBins,
  computeSaddlePlot,
  renderSaddleSVG,
} from '../../src/analysis/SaddlePlot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDiagonalDecay(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      m[i * size + j] = 1.0 / (Math.abs(i - j) + 1);
    }
  }
  return m;
}

function buildCheckerboard(size: number): Float32Array {
  const m = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const sameCompartment = (i < size / 2) === (j < size / 2);
      const dist = Math.abs(i - j);
      const base = 1.0 / (dist + 1);
      m[i * size + j] = sameCompartment ? base * 2 : base * 0.3;
    }
  }
  return m;
}

function buildCompartmentEigenvector(size: number): Float32Array {
  const ev = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    ev[i] = i < size / 2 ? -1 : 1;
  }
  return ev;
}

// ---------------------------------------------------------------------------
// digitizeBins
// ---------------------------------------------------------------------------

describe('digitizeBins', () => {
  it('returns empty for empty input', () => {
    const result = digitizeBins(new Float32Array(0), 10, [0, 1]);
    expect(result.length).toBe(0);
  });

  it('assigns bins based on value ranking', () => {
    const ev = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const bins = digitizeBins(ev, 5, [0, 1]);
    expect(bins[0]).toBe(0); // Lowest value → bin 0
    expect(bins[9]).toBe(4); // Highest value → bin 4
  });

  it('respects qRange trimming', () => {
    const ev = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 100]);
    // With qRange [0.1, 0.8], the low/high thresholds trim extremes
    const bins = digitizeBins(ev, 5, [0.1, 0.8]);
    // Value 100 is above the 80th percentile threshold → excluded
    expect(bins[9]).toBe(-1);
    // Value 0 is at/below the 10th percentile → excluded
    expect(bins[0]).toBe(-1);
  });

  it('assigns all bins to 0 for constant eigenvector', () => {
    const ev = new Float32Array([5, 5, 5, 5]);
    const bins = digitizeBins(ev, 10, [0, 1]);
    // All equal → range is 0 → all excluded
    for (let i = 0; i < 4; i++) {
      expect(bins[i]).toBe(-1);
    }
  });

  it('handles two distinct values', () => {
    const ev = new Float32Array([-1, -1, -1, 1, 1, 1]);
    const bins = digitizeBins(ev, 4, [0, 1]);
    // Negative values should be in lower bins, positive in higher bins
    expect(bins[0]).toBeLessThan(bins[5]);
  });
});

// ---------------------------------------------------------------------------
// computeSaddlePlot
// ---------------------------------------------------------------------------

describe('computeSaddlePlot', () => {
  it('handles empty input', () => {
    const result = computeSaddlePlot(new Float32Array(0), 0, new Float32Array(0));
    expect(result.nBins).toBe(0);
    expect(result.strength).toBe(0);
  });

  it('produces correct saddle matrix dimensions', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    expect(result.nBins).toBe(10);
    expect(result.saddleMatrix.length).toBe(100);
  });

  it('produces non-zero saddle matrix for contact data', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    let hasNonZero = false;
    for (let i = 0; i < result.saddleMatrix.length; i++) {
      if (result.saddleMatrix[i] > 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });

  it('produces strength > 1 for checkerboard pattern', () => {
    const size = 40;
    const m = buildCheckerboard(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    // Same-compartment contacts are enriched → AA+BB > AB+BA → strength > 1
    expect(result.strength).toBeGreaterThan(1);
  });

  it('produces strength profile', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    expect(result.strengthProfile.length).toBe(10);
  });

  it('produces correct bin edges', () => {
    const size = 20;
    const ev = buildCompartmentEigenvector(size);
    const m = buildDiagonalDecay(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 5, qRange: [0, 1], minDiag: 2 });
    expect(result.binEdges.length).toBe(6);
    // Edges should be monotonically increasing
    for (let i = 1; i < result.binEdges.length; i++) {
      expect(result.binEdges[i]).toBeGreaterThanOrEqual(result.binEdges[i - 1]);
    }
  });

  it('uses default params when none provided', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev);
    expect(result.nBins).toBe(20);
  });

  it('respects custom nBins', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const r5 = computeSaddlePlot(m, size, ev, { nBins: 5, qRange: [0, 1], minDiag: 2 });
    const r15 = computeSaddlePlot(m, size, ev, { nBins: 15, qRange: [0, 1], minDiag: 2 });
    expect(r5.saddleMatrix.length).toBe(25);
    expect(r15.saddleMatrix.length).toBe(225);
  });

  it('respects minDiag parameter', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const noSkip = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 0 });
    const skipDiag = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 10 });
    // With larger minDiag, fewer contacts are included
    let countNo = 0, countSkip = 0;
    for (let i = 0; i < noSkip.saddleMatrix.length; i++) {
      if (noSkip.saddleMatrix[i] > 0) countNo++;
      if (skipDiag.saddleMatrix[i] > 0) countSkip++;
    }
    expect(countSkip).toBeLessThanOrEqual(countNo);
  });

  it('saddle matrix values are non-negative', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    for (let i = 0; i < result.saddleMatrix.length; i++) {
      expect(result.saddleMatrix[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// renderSaddleSVG
// ---------------------------------------------------------------------------

describe('renderSaddleSVG', () => {
  it('returns empty string for empty result', () => {
    const svg = renderSaddleSVG({
      saddleMatrix: new Float32Array(0),
      nBins: 0,
      strength: 0,
      strengthProfile: new Float32Array(0),
      binEdges: new Float32Array(0),
    });
    expect(svg).toBe('');
  });

  it('returns SVG string for valid result', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 10, qRange: [0, 1], minDiag: 2 });
    const svg = renderSaddleSVG(result);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Saddle Plot');
    expect(svg).toContain('Strength');
  });

  it('contains rect elements for each cell', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 5, qRange: [0, 1], minDiag: 2 });
    const svg = renderSaddleSVG(result);
    // 5x5 = 25 cells
    const rectCount = (svg.match(/<rect /g) || []).length;
    expect(rectCount).toBe(25);
  });

  it('includes B and A labels', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const ev = buildCompartmentEigenvector(size);
    const result = computeSaddlePlot(m, size, ev, { nBins: 5, qRange: [0, 1], minDiag: 2 });
    const svg = renderSaddleSVG(result);
    expect(svg).toContain('>B<');
    expect(svg).toContain('>A<');
  });
});
