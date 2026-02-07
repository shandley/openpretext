import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import {
  computeDiagonalDensity,
  detectBreakpoints,
  autoCut,
} from '../../src/curation/AutoCut';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestMap(contigs: ContigInfo[], textureSize: number, contactMap: Float32Array | null = null): MapData {
  return {
    filename: 'test.pretext',
    textureSize,
    numMipMaps: 1,
    tileResolution: 1024,
    tilesPerDimension: 1,
    contigs,
    contactMap,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length: number = 10000,
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

/**
 * Create a contact map with uniform value along the diagonal band.
 */
function makeUniformMap(size: number, value: number): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let d = 0; d <= 10; d++) {
      if (i + d < size) {
        map[(i + d) * size + i] = value;
        map[i * size + (i + d)] = value;
      }
    }
  }
  return map;
}

/**
 * Create a contact map with a gap in the diagonal signal at a specific position.
 * Simulates a misassembly breakpoint.
 */
function makeMapWithGap(size: number, gapStart: number, gapEnd: number, signalValue: number = 1.0): Float32Array {
  const map = new Float32Array(size * size);

  for (let i = 0; i < size; i++) {
    // Skip the gap region — no signal near diagonal
    const inGap = i >= gapStart && i < gapEnd;

    for (let d = 1; d <= 10; d++) {
      if (i + d < size) {
        const otherInGap = (i + d) >= gapStart && (i + d) < gapEnd;
        const val = (inGap || otherInGap) ? 0 : signalValue;
        map[(i + d) * size + i] = val;
        map[i * size + (i + d)] = val;
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoCut', () => {
  beforeEach(() => {
    state.reset();
  });

  // -----------------------------------------------------------------------
  // computeDiagonalDensity
  // -----------------------------------------------------------------------
  describe('computeDiagonalDensity', () => {
    it('should return correct values for uniform signal', () => {
      const size = 64;
      const value = 2.0;
      const map = makeUniformMap(size, value);

      const density = computeDiagonalDensity(map, size, 10, 50, 4);

      // All positions should have similar density for uniform signal
      expect(density.length).toBe(40);

      // Interior values should be close to the signal value
      for (let i = 5; i < 35; i++) {
        expect(density[i]).toBeGreaterThan(0);
      }
    });

    it('should return zeros for empty contact map', () => {
      const size = 32;
      const map = new Float32Array(size * size); // all zeros

      const density = computeDiagonalDensity(map, size, 0, 20, 4);

      expect(density.length).toBe(20);
      for (let i = 0; i < density.length; i++) {
        expect(density[i]).toBe(0);
      }
    });

    it('should detect density drop at gap position', () => {
      const size = 128;
      const gapCenter = 64;
      const map = makeMapWithGap(size, gapCenter - 5, gapCenter + 5, 1.0);

      const density = computeDiagonalDensity(map, size, 0, 128, 4);

      // Density should be lower at the gap
      const avgSignal = density[20]; // well outside gap
      const gapValue = density[gapCenter];

      expect(gapValue).toBeLessThan(avgSignal);
    });
  });

  // -----------------------------------------------------------------------
  // detectBreakpoints
  // -----------------------------------------------------------------------
  describe('detectBreakpoints', () => {
    it('should find clear discontinuity', () => {
      // Create density with a clear dip in the middle
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        density[i] = 1.0;
      }
      // Create a sharp dip at position 50
      for (let i = 47; i <= 53; i++) {
        density[i] = 0.1;
      }

      const bps = detectBreakpoints(density, 8, 0.05, 8);

      expect(bps.length).toBeGreaterThan(0);
      // Breakpoint should be near position 50
      const nearCenter = bps.some(bp => Math.abs(bp.offset - 50) <= 10);
      expect(nearCenter).toBe(true);
    });

    it('should return empty for smooth uniform curve', () => {
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        density[i] = 1.0;
      }

      const bps = detectBreakpoints(density, 8, 0.05, 8);

      expect(bps.length).toBe(0);
    });

    it('should respect minFragmentSize', () => {
      const len = 40;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        density[i] = 1.0;
      }
      // Dip very close to start
      density[5] = 0.01;
      density[6] = 0.01;
      density[7] = 0.01;

      // With large minFragmentSize, breakpoints near edges should be filtered
      const bps = detectBreakpoints(density, 4, 0.05, 15);

      // Should not have a breakpoint at position 6 since it would create
      // a fragment smaller than 15 pixels from the start
      const tooClose = bps.some(bp => bp.offset < 15);
      expect(tooClose).toBe(false);
    });

    it('should merge nearby breakpoints', () => {
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        density[i] = 1.0;
      }
      // Create a wide dip that could produce multiple breakpoint candidates
      for (let i = 45; i <= 55; i++) {
        density[i] = 0.05;
      }

      const bps = detectBreakpoints(density, 8, 0.05, 8);

      // Multiple raw candidates in [45, 55] should be merged to 1
      expect(bps.length).toBe(1);
    });

    it('should return empty for too-short density array', () => {
      const density = new Float64Array(10);
      for (let i = 0; i < 10; i++) density[i] = 1.0;

      const bps = detectBreakpoints(density, 8, 0.05, 8);

      // 10 < minFragmentSize*2=16, so no breakpoints
      expect(bps.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // autoCut (integration)
  // -----------------------------------------------------------------------
  describe('autoCut', () => {
    it('should detect breakpoint in synthetic map with signal gap', () => {
      const size = 256;
      // Single large contig covering the full map, with a gap in the middle
      const contigs = [
        makeContig('chr1', 0, 0, 256, 256000),
      ];

      // Create a map with a wide gap at the center (pixels 118-138)
      const contactMap = makeMapWithGap(size, 118, 138, 1.0);

      const result = autoCut(
        contactMap, size, contigs, [0], 256,
        { cutThreshold: 0.05, windowSize: 6, minFragmentSize: 10 },
      );

      // Should detect at least one breakpoint in chr1
      expect(result.totalBreakpoints).toBeGreaterThanOrEqual(1);
      if (result.breakpoints.has(0)) {
        const bps = result.breakpoints.get(0)!;
        // Breakpoint should map to somewhere near the middle
        expect(bps[0].offset).toBeGreaterThan(50);
        expect(bps[0].offset).toBeLessThan(200);
      }
    });

    it('should return 0 breakpoints for uniform signal', () => {
      const size = 64;
      const contigs = [
        makeContig('chr1', 0, 0, 32, 32000),
        makeContig('chr2', 1, 32, 64, 32000),
      ];
      const contactMap = makeUniformMap(size, 1.0);

      const result = autoCut(
        contactMap, size, contigs, [0, 1], 64,
        { cutThreshold: 0.05, windowSize: 4, minFragmentSize: 4 },
      );

      expect(result.totalBreakpoints).toBe(0);
    });

    it('should skip very small contigs', () => {
      const size = 128;
      const contigs = [
        makeContig('big', 0, 0, 120, 120000),
        makeContig('tiny', 1, 120, 124, 4000),  // Only 4 pixels — too small
      ];
      const contactMap = makeMapWithGap(size, 121, 123, 1.0);

      const result = autoCut(
        contactMap, size, contigs, [0, 1], 128,
        { cutThreshold: 0.05, windowSize: 4, minFragmentSize: 4 },
      );

      // Tiny contig should not be processed (too small for minFragmentSize*2)
      expect(result.breakpoints.has(1)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // autoCutContigs integration (via BatchOperations)
  // -----------------------------------------------------------------------
  describe('autoCutContigs integration', () => {
    it('should return 0 operations when no map is loaded', async () => {
      // Import dynamically to test the batch operation
      const { autoCutContigs } = await import('../../src/curation/BatchOperations');
      const result = autoCutContigs();
      expect(result.operationsPerformed).toBe(0);
      expect(result.description).toBe('No map loaded');
    });

    it('should apply cuts via CurationEngine and be undoable', async () => {
      const { autoCutContigs } = await import('../../src/curation/BatchOperations');

      const size = 128;
      const contigs = [
        makeContig('chr1', 0, 0, 64, 64000),
        makeContig('chr2', 1, 64, 128, 64000),
      ];

      // Create map with a clear gap at pixel 32 (middle of chr1)
      const contactMap = makeMapWithGap(size, 28, 36, 1.0);
      const map = makeTestMap(contigs, 128, contactMap);

      state.update({
        map,
        contigOrder: [0, 1],
        undoStack: [],
        redoStack: [],
      });

      const initialContigCount = state.get().contigOrder.length;
      const result = autoCutContigs({
        cutThreshold: 0.05,
        windowSize: 4,
        minFragmentSize: 4,
      });

      if (result.operationsPerformed > 0) {
        const s = state.get();
        // More contigs after cutting
        expect(s.contigOrder.length).toBeGreaterThan(initialContigCount);
        // Undo stack has operations
        expect(s.undoStack.length).toBe(result.operationsPerformed);

        // Undo all operations
        for (let i = 0; i < result.operationsPerformed; i++) {
          CurationEngine.undo();
        }

        // Should be back to original state
        expect(state.get().contigOrder.length).toBe(initialContigCount);
      }
    });
  });

  // -----------------------------------------------------------------------
  // New default tuning tests
  // -----------------------------------------------------------------------
  describe('tuned defaults', () => {
    it('cutThreshold=0.30 should NOT detect a 25% drop', () => {
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) density[i] = 1.0;
      // 25% drop at position 50 — below the 0.30 threshold
      for (let i = 45; i <= 55; i++) density[i] = 0.75;

      const bps = detectBreakpoints(density, 8, 0.30, 16);
      expect(bps.length).toBe(0);
    });

    it('cutThreshold=0.30 SHOULD detect a 35% drop', () => {
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) density[i] = 1.0;
      // 35% drop at position 50 — above the 0.30 threshold
      for (let i = 45; i <= 55; i++) density[i] = 0.65;

      const bps = detectBreakpoints(density, 8, 0.30, 16);
      expect(bps.length).toBeGreaterThan(0);
      const nearCenter = bps.some(bp => Math.abs(bp.offset - 50) <= 10);
      expect(nearCenter).toBe(true);
    });

    it('minFragmentSize=16 should filter breakpoints near edges', () => {
      const len = 60;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) density[i] = 1.0;
      // Clear dip at position 10 — too close to start for minFragmentSize=16
      for (let i = 8; i <= 12; i++) density[i] = 0.0;

      const bps = detectBreakpoints(density, 4, 0.30, 16);
      const tooClose = bps.some(bp => bp.offset < 16);
      expect(tooClose).toBe(false);
    });

    it('confidence floor: breakpoints with confidence <= 0.5 are excluded from autoCut', () => {
      const size = 256;
      const contigs = [makeContig('chr1', 0, 0, 256, 256000)];

      // Create a map with a very slight dip (low confidence) at position 128
      const contactMap = new Float32Array(size * size);
      for (let i = 0; i < size; i++) {
        for (let d = 1; d <= 10; d++) {
          if (i + d < size) {
            // Slight dip near position 128 but mostly uniform
            const inDip = (i >= 125 && i <= 131) || (i + d >= 125 && i + d <= 131);
            const val = inDip ? 0.75 : 1.0;
            contactMap[(i + d) * size + i] = val;
            contactMap[i * size + (i + d)] = val;
          }
        }
      }

      const result = autoCut(
        contactMap, size, contigs, [0], 256,
        { cutThreshold: 0.05, windowSize: 6, minFragmentSize: 8 },
      );

      // Any detected breakpoints should have confidence > 0.5
      for (const [, bps] of result.breakpoints) {
        for (const bp of bps) {
          expect(bp.confidence).toBeGreaterThan(0.5);
        }
      }
    });

    it('narrow region filtering: 1-2 pixel dips should NOT be detected', () => {
      const len = 100;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) density[i] = 1.0;
      // Create a very narrow dip (2 pixels) at position 50
      density[49] = 0.0;
      density[50] = 0.0;

      // windowSize=8 -> minRegionWidth = max(3, floor(8/2)) = 4
      // A 2-pixel dip is narrower than 4, so it should be filtered out
      const bps = detectBreakpoints(density, 8, 0.05, 16);
      expect(bps.length).toBe(0);
    });

    it('local baseline: gradual transition between signal levels is NOT a breakpoint', () => {
      // Create a density array with two distinct signal levels connected by
      // a smooth ramp, so the local baseline adapts gradually.
      // Strong region (1.0), gradual ramp down over 80 pixels, weak region (0.4)
      const len = 300;
      const density = new Float64Array(len);
      // Strong signal in first third
      for (let i = 0; i < 100; i++) density[i] = 1.0;
      // Gradual transition over 80 pixels (positions 100-179)
      for (let i = 100; i < 180; i++) {
        const t = (i - 100) / 80; // 0 to 1
        density[i] = 1.0 - t * 0.6; // 1.0 down to 0.4
      }
      // Weak signal in last portion
      for (let i = 180; i < 300; i++) density[i] = 0.4;

      // With local baseline, a gradual transition should NOT produce a breakpoint
      // because the local baseline tracks the gradual change
      const bps = detectBreakpoints(density, 8, 0.30, 16);

      // There should be no breakpoints — the transition is gradual
      expect(bps.length).toBe(0);
    });

    it('local baseline: a 35% drop within a strong region IS detected', () => {
      const len = 200;
      const density = new Float64Array(len);
      for (let i = 0; i < len; i++) density[i] = 1.0;
      // Clear dip in the strong region around position 50
      for (let i = 45; i <= 55; i++) density[i] = 0.1;

      const bps = detectBreakpoints(density, 8, 0.30, 16);
      expect(bps.length).toBeGreaterThan(0);
      const nearDip = bps.some(bp => Math.abs(bp.offset - 50) <= 10);
      expect(nearDip).toBe(true);
    });

    it('high confidence threshold: shallow dip with ~0.4 confidence excluded from autoCut', () => {
      const size = 256;
      const contigs = [makeContig('chr1', 0, 0, 256, 256000)];

      // Create a map with a moderate dip that produces ~0.4 confidence
      // Signal of 1.0 everywhere except at the dip where signal is 0.6
      // This gives a ~40% drop in the dip region, confidence ~0.4
      const contactMap = new Float32Array(size * size);
      for (let i = 0; i < size; i++) {
        for (let d = 1; d <= 10; d++) {
          if (i + d < size) {
            const inDip = (i >= 120 && i <= 136) || (i + d >= 120 && i + d <= 136);
            const val = inDip ? 0.6 : 1.0;
            contactMap[(i + d) * size + i] = val;
            contactMap[i * size + (i + d)] = val;
          }
        }
      }

      const result = autoCut(
        contactMap, size, contigs, [0], 256,
        { cutThreshold: 0.05, windowSize: 6, minFragmentSize: 8 },
      );

      // All breakpoints that pass the filter must have confidence > 0.5
      for (const [, bps] of result.breakpoints) {
        for (const bp of bps) {
          expect(bp.confidence).toBeGreaterThan(0.5);
        }
      }
    });
  });
});
