import { describe, it, expect } from 'vitest';
import { describeCuration } from '../../src/ui/BeforeAfterMap';
import type { DiffSummary } from '../../src/ui/ComparisonMode';

function summary(partial: Partial<DiffSummary>): DiffSummary {
  return { moved: 0, inverted: 0, added: 0, removed: 0, unchanged: 0, total: 0, ...partial };
}

describe('describeCuration', () => {
  it('reports no change when nothing was curated', () => {
    const r = describeCuration(summary({ unchanged: 10, total: 10 }));
    expect(r.changed).toBe(false);
    expect(r.text).toBe('');
  });

  it('lists moves, inversions, cuts and joins', () => {
    const r = describeCuration(summary({ moved: 3, inverted: 2, added: 1, removed: 4 }));
    expect(r.changed).toBe(true);
    expect(r.text).toBe('3 moved, 2 inverted, 1 new from cuts, 4 joined away');
  });

  it('treats a single inversion as a change', () => {
    const r = describeCuration(summary({ inverted: 1, unchanged: 9 }));
    expect(r.changed).toBe(true);
    expect(r.text).toBe('1 inverted');
  });
});
