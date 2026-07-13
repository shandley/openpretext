import { describe, it, expect } from 'vitest';
import { computeAutoContrast } from '../../src/renderer/AutoContrast';

/** Build a dim x dim row-major overview from a per-cell value function. */
function overview(dim: number, f: (i: number, j: number) => number): Float32Array {
  const m = new Float32Array(dim * dim);
  for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) m[i * dim + j] = f(i, j);
  return m;
}

describe('computeAutoContrast', () => {
  it('leaves a sparse, well-behaved map at floor 0', () => {
    // Bright diagonal, near-empty off-diagonal (a clean assembly).
    const m = overview(64, (i, j) => (i === j ? 1 : (Math.abs(i - j) <= 1 ? 0.3 : 0)));
    const c = computeAutoContrast(m);
    expect(c.floor).toBe(0);
    expect(c.ceil).toBe(1);
  });

  it('raises the floor for a dense, saturated map', () => {
    // Off-diagonal background sits high everywhere (a compact, dense genome).
    const m = overview(64, (i, j) => (i === j ? 1 : 0.8));
    const c = computeAutoContrast(m);
    expect(c.floor).toBeGreaterThan(0.5);
    expect(c.floor).toBeLessThanOrEqual(0.7); // capped
    expect(c.background).toBeGreaterThan(0.5);
  });

  it('ignores the diagonal when estimating background', () => {
    // Saturated diagonal but empty off-diagonal must not trigger flooring.
    const m = overview(64, (i, j) => (i === j ? 1 : 0));
    expect(computeAutoContrast(m).floor).toBe(0);
  });

  it('never floors above the cap even when background is maximal', () => {
    const m = overview(32, (i, j) => (i === j ? 1 : 0.99));
    expect(computeAutoContrast(m).floor).toBeLessThanOrEqual(0.7);
  });

  it('handles a degenerate tiny map without flooring', () => {
    expect(computeAutoContrast(new Float32Array([0, 1, 1, 0])).floor).toBe(0);
  });
});
