import { describe, it, expect } from 'vitest';
import {
  extractViewpointRow,
  normalizeByExpected,
  scaleForDisplay,
  computeVirtual4C,
  virtual4CToTrack,
} from '../../src/analysis/Virtual4C';

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

function buildUniformMap(size: number, value: number): Float32Array {
  return new Float32Array(size * size).fill(value);
}

// ---------------------------------------------------------------------------
// extractViewpointRow
// ---------------------------------------------------------------------------

describe('extractViewpointRow', () => {
  it('returns zeros for empty matrix', () => {
    expect(extractViewpointRow(new Float32Array(0), 0, 0).length).toBe(0);
  });

  it('extracts correct row', () => {
    const m = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const row = extractViewpointRow(m, 3, 1);
    expect(row[0]).toBe(4);
    expect(row[1]).toBe(5);
    expect(row[2]).toBe(6);
  });

  it('handles out-of-bounds viewpoint', () => {
    const m = buildUniformMap(4, 1);
    const row = extractViewpointRow(m, 4, 10);
    for (let i = 0; i < 4; i++) expect(row[i]).toBe(0);
  });

  it('handles negative viewpoint', () => {
    const m = buildUniformMap(4, 1);
    const row = extractViewpointRow(m, 4, -1);
    for (let i = 0; i < 4; i++) expect(row[i]).toBe(0);
  });

  it('returns correct length', () => {
    const m = buildDiagonalDecay(10);
    expect(extractViewpointRow(m, 10, 5).length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// normalizeByExpected
// ---------------------------------------------------------------------------

describe('normalizeByExpected', () => {
  it('returns zeros for zero expected', () => {
    const profile = new Float32Array([1, 2, 3]);
    const expected = new Float64Array([0, 0, 0]);
    const result = normalizeByExpected(profile, expected, 0);
    for (let i = 0; i < 3; i++) expect(result[i]).toBe(0);
  });

  it('divides by expected correctly', () => {
    const profile = new Float32Array([4, 2, 1]);
    const expected = new Float64Array([2, 2, 2]);
    const result = normalizeByExpected(profile, expected, 0);
    expect(result[0]).toBeCloseTo(2); // 4/2
    expect(result[1]).toBeCloseTo(1); // 2/2
    expect(result[2]).toBeCloseTo(0.5); // 1/2
  });

  it('uses distance from viewpoint for expected lookup', () => {
    const profile = new Float32Array([1, 1, 1, 1]);
    const expected = new Float64Array([1, 0.5, 0.25, 0.125]);
    const result = normalizeByExpected(profile, expected, 1);
    // Distance from viewpoint=1: [1, 0, 1, 2]
    expect(result[0]).toBeCloseTo(2);   // 1/expected[1] = 1/0.5
    expect(result[1]).toBeCloseTo(1);   // 1/expected[0] = 1/1
    expect(result[2]).toBeCloseTo(2);   // 1/expected[1] = 1/0.5
    expect(result[3]).toBeCloseTo(4);   // 1/expected[2] = 1/0.25
  });
});

// ---------------------------------------------------------------------------
// scaleForDisplay
// ---------------------------------------------------------------------------

describe('scaleForDisplay', () => {
  it('returns empty for empty input', () => {
    expect(scaleForDisplay(new Float32Array(0), false).length).toBe(0);
  });

  it('scales to [0, 1]', () => {
    const result = scaleForDisplay(new Float32Array([1, 5, 3]), false);
    expect(result[0]).toBeCloseTo(0);   // min
    expect(result[1]).toBeCloseTo(1);   // max
    expect(result[2]).toBeCloseTo(0.5); // middle
  });

  it('fills 0.5 for constant values', () => {
    const result = scaleForDisplay(new Float32Array([3, 3, 3]), false);
    for (let i = 0; i < 3; i++) expect(result[i]).toBeCloseTo(0.5);
  });

  it('applies log2 transform when enabled', () => {
    const noLog = scaleForDisplay(new Float32Array([1, 4, 16]), false);
    const withLog = scaleForDisplay(new Float32Array([1, 4, 16]), true);
    // With log2: [0, 2, 4] → scaled differently than [1, 4, 16]
    // Without log: (4-1)/(16-1) = 0.2; With log: (2-0)/(4-0) = 0.5
    expect(withLog[1]).not.toBeCloseTo(noLog[1]);
  });

  it('output is always in [0, 1]', () => {
    const result = scaleForDisplay(new Float32Array([-5, 0, 10, 100]), false);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// computeVirtual4C
// ---------------------------------------------------------------------------

describe('computeVirtual4C', () => {
  it('handles empty matrix', () => {
    const result = computeVirtual4C(new Float32Array(0), 0);
    expect(result.rawProfile.length).toBe(0);
    expect(result.displayProfile.length).toBe(0);
  });

  it('handles out-of-bounds viewpoint', () => {
    const m = buildDiagonalDecay(10);
    const result = computeVirtual4C(m, 10, { viewpoint: 20, normalize: false, logTransform: false });
    expect(result.rawProfile.length).toBe(0);
  });

  it('computes profile with normalization', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 10, normalize: true, logTransform: false });
    expect(result.rawProfile.length).toBe(size);
    expect(result.normalizedProfile.length).toBe(size);
    expect(result.displayProfile.length).toBe(size);
    expect(result.viewpoint).toBe(10);
  });

  it('computes profile without normalization', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 10, normalize: false, logTransform: false });
    // Without normalization, normalized profile should equal raw profile
    for (let i = 0; i < size; i++) {
      expect(result.normalizedProfile[i]).toBeCloseTo(result.rawProfile[i], 4);
    }
  });

  it('display profile is in [0, 1]', () => {
    const size = 20;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 5, normalize: true, logTransform: false });
    for (let i = 0; i < size; i++) {
      expect(result.displayProfile[i]).toBeGreaterThanOrEqual(0);
      expect(result.displayProfile[i]).toBeLessThanOrEqual(1);
    }
  });

  it('uses default params', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size);
    expect(result.viewpoint).toBe(0);
    expect(result.rawProfile.length).toBe(size);
  });
});

// ---------------------------------------------------------------------------
// virtual4CToTrack
// ---------------------------------------------------------------------------

describe('virtual4CToTrack', () => {
  it('returns a line track', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 5, normalize: false, logTransform: false });
    const track = virtual4CToTrack(result, size, 20);
    expect(track.name).toBe('Virtual 4C (bin 5)');
    expect(track.type).toBe('line');
    expect(track.data.length).toBe(20);
    expect(track.visible).toBe(true);
  });

  it('track data is in [0, 1]', () => {
    const size = 10;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 3, normalize: true, logTransform: false });
    const track = virtual4CToTrack(result, size, 20);
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('maps overview size to texture size', () => {
    const size = 8;
    const m = buildDiagonalDecay(size);
    const result = computeVirtual4C(m, size, { viewpoint: 4, normalize: false, logTransform: false });
    const track = virtual4CToTrack(result, size, 100);
    expect(track.data.length).toBe(100);
  });
});
