import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { previewEffects, dryRunValidate } from '../../src/ui/DSLRunner';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// Minimal fixtures (real state + real CurationEngine; only ctx is stubbed)
// ---------------------------------------------------------------------------

function makeContig(name: string, index: number, pixelStart: number, pixelEnd: number, length = 10000): ContigInfo {
  return { name, originalIndex: index, length, pixelStart, pixelEnd, inverted: false, scaffoldId: null };
}

function makeTestMap(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test.pretext',
    textureSize: 1024,
    numMipMaps: 1,
    tileResolution: 512,
    tilesPerDimension: 2,
    contigs,
    contactMap: null,
    extensions: new Map(),
  };
}

function setupState(): void {
  state.reset();
  const contigs = [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
    makeContig('chr3', 2, 200, 300, 6000),
    makeContig('chr4', 3, 300, 400, 4000),
  ];
  state.update({ map: makeTestMap(contigs), contigOrder: [0, 1, 2, 3] });
}

// Only the fields DSLRunner touches; mutations go through the real singletons.
const ctx = {
  scaffoldManager: { getAllScaffolds: () => [] },
  refreshAfterCuration: () => {},
  updateSidebarScaffoldList: () => {},
  camera: {},
  suppressCurationRefresh: false,
} as unknown as AppContext;

describe('previewEffects (run + revert)', () => {
  beforeEach(setupState);

  it('reports the effect but restores state exactly (nothing kept)', () => {
    const invertedBefore = state.get().map!.contigs.map((c) => c.inverted);
    const undoBefore = state.get().undoStack.length;

    const { diff } = previewEffects(ctx, 'invert #0\ninvert #1');

    expect(diff).not.toBeNull();
    expect(diff!.applied).toBe(2);
    // State fully restored: no inversions kept, stacks unchanged.
    expect(state.get().map!.contigs.map((c) => c.inverted)).toEqual(invertedBefore);
    expect(state.get().undoStack.length).toBe(undoBefore);
    expect(state.get().redoStack.length).toBe(0);
  });

  it('reports contig-count change for cuts, then reverts the count', () => {
    const { diff } = previewEffects(ctx, 'cut #0 20\ncut #1 20');

    expect(diff!.contigCountBefore).toBe(4);
    expect(diff!.contigCountAfter).toBe(6);
    // Reverted: the assembly is back to 4 contigs.
    expect(state.get().contigOrder.length).toBe(4);
    expect(state.get().undoStack.length).toBe(0);
  });

  it('does not pollute the redo stack', () => {
    previewEffects(ctx, 'invert #0');
    expect(state.get().redoStack).toEqual([]);
  });
});

describe('dryRunValidate (no mutation)', () => {
  beforeEach(setupState);

  it('validates each line and flags a bad contig reference without applying', () => {
    const out = dryRunValidate(ctx, 'invert chr1\ninvert nope');

    expect(out.results).toHaveLength(2);
    expect(out.results[0].success).toBe(true);
    expect(out.results[1].success).toBe(false);
    expect(out.results[1].message).toContain('not found');
    // Nothing was applied.
    expect(state.get().undoStack.length).toBe(0);
    expect(state.get().map!.contigs[0].inverted).toBe(false);
  });

  it('continues past errors to validate every line', () => {
    const out = dryRunValidate(ctx, 'invert nope\ninvert chr2');
    expect(out.results).toHaveLength(2);
    expect(out.results[0].success).toBe(false);
    expect(out.results[1].success).toBe(true);
  });
});
