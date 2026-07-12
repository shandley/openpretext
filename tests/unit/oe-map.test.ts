import { describe, it, expect } from 'vitest';
import { buildOEDisplay } from '../../src/ui/OEMapToggle';

describe('buildOEDisplay', () => {
  it('centres O/E = 1 at 0.5 (the white midpoint of a diverging map)', () => {
    const out = buildOEDisplay(Float32Array.from([1]));
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('maps the display range endpoints to 0 and 1 (O/E 2^-3 and 2^3)', () => {
    const out = buildOEDisplay(Float32Array.from([0.125, 8]));
    expect(out[0]).toBeCloseTo(0, 6); // 2^-3 -> depleted end
    expect(out[1]).toBeCloseTo(1, 6); // 2^3 -> enriched end
  });

  it('clamps values beyond the display range', () => {
    const out = buildOEDisplay(Float32Array.from([0.01, 64]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });

  it('is monotonic and symmetric in log space', () => {
    const out = buildOEDisplay(Float32Array.from([2, 4]));
    expect(out[0]).toBeCloseTo((1 + 3) / 6, 6); // log2(2)=1
    expect(out[1]).toBeCloseTo((2 + 3) / 6, 6); // log2(4)=2
    // 2 and 1/2 are symmetric about 0.5
    const sym = buildOEDisplay(Float32Array.from([0.5]));
    expect(out[0] - 0.5).toBeCloseTo(0.5 - sym[0], 6);
  });

  it('sends empty and non-finite ratios to the depleted end, never -Inf/NaN', () => {
    const out = buildOEDisplay(Float32Array.from([0, Infinity, NaN, -1]));
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
  });
});
