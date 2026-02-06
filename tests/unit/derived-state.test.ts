import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { getContigNames, getContigScaffoldIds, getContigBoundaries } from '../../src/core/DerivedState';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length = 1000
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

function makeTestMap(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test.pretext',
    textureSize: 400,
    numMipMaps: 1,
    contigs,
    textures: [new Float32Array(0)],
    extensions: new Map(),
  } as MapData;
}

function setupState(): void {
  const contigs = [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
    makeContig('chr3', 2, 200, 300, 6000),
    makeContig('chr4', 3, 300, 400, 4000),
  ];
  contigs[1].scaffoldId = 1;
  contigs[2].scaffoldId = 1;
  const map = makeTestMap(contigs);
  state.update({
    map,
    contigOrder: [0, 1, 2, 3],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DerivedState', () => {
  beforeEach(() => {
    state.reset();
  });

  describe('getContigNames()', () => {
    it('returns names in display order', () => {
      setupState();
      expect(getContigNames()).toEqual(['chr1', 'chr2', 'chr3', 'chr4']);
    });

    it('returns cached reference on second call', () => {
      setupState();
      const first = getContigNames();
      const second = getContigNames();
      expect(first).toBe(second);
    });

    it('invalidates after contigOrder change', () => {
      setupState();
      const first = getContigNames();

      state.update({ contigOrder: [3, 2, 1, 0] });

      const second = getContigNames();
      expect(first).not.toBe(second);
      expect(second).toEqual(['chr4', 'chr3', 'chr2', 'chr1']);
    });

    it('invalidates after map change (e.g. updateContig)', () => {
      setupState();
      const first = getContigNames();

      state.updateContig(0, { name: 'chrX' });

      const second = getContigNames();
      expect(first).not.toBe(second);
      expect(second[0]).toBe('chrX');
    });

    it('returns empty array when no map loaded', () => {
      expect(getContigNames()).toEqual([]);
    });
  });

  describe('getContigScaffoldIds()', () => {
    it('returns scaffold IDs in display order', () => {
      setupState();
      expect(getContigScaffoldIds()).toEqual([null, 1, 1, null]);
    });

    it('returns cached reference on second call', () => {
      setupState();
      const first = getContigScaffoldIds();
      const second = getContigScaffoldIds();
      expect(first).toBe(second);
    });

    it('invalidates after state change', () => {
      setupState();
      const first = getContigScaffoldIds();

      state.updateContig(0, { scaffoldId: 2 });

      const second = getContigScaffoldIds();
      expect(first).not.toBe(second);
      expect(second).toEqual([2, 1, 1, null]);
    });
  });

  describe('getContigBoundaries()', () => {
    it('returns accumulated fractions', () => {
      setupState();
      const boundaries = getContigBoundaries();
      // Each contig is 100px, textureSize is 400
      expect(boundaries).toEqual([0.25, 0.5, 0.75, 1.0]);
    });

    it('returns cached reference on second call', () => {
      setupState();
      const first = getContigBoundaries();
      const second = getContigBoundaries();
      expect(first).toBe(second);
    });

    it('invalidates after contigOrder change', () => {
      setupState();
      const first = getContigBoundaries();

      state.update({ contigOrder: [0, 1] }); // only first two

      const second = getContigBoundaries();
      expect(first).not.toBe(second);
      expect(second).toEqual([0.25, 0.5]);
    });

    it('returns empty array when no map loaded', () => {
      expect(getContigBoundaries()).toEqual([]);
    });
  });
});
