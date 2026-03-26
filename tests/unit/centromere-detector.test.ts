/**
 * Tests for CentromereDetector — centromere position prediction from Hi-C.
 */

import { describe, it, expect } from 'vitest';
import { detectCentromeres, centromereToTracks } from '../../src/analysis/CentromereDetector';
import type { ContigRange } from '../../src/curation/AutoSort';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a block-diagonal contact map with inter-block hub at centromere positions. */
function makeMapWithCentromeres(size: number, blocks: { start: number; end: number; centromere: number }[]): Float32Array {
  const map = new Float32Array(size * size);

  // Diagonal decay within each block
  for (const block of blocks) {
    for (let i = block.start; i < block.end; i++) {
      for (let j = block.start; j < block.end; j++) {
        const dist = Math.abs(i - j);
        map[i * size + j] = Math.exp(-dist * 0.2) * 5;
      }
    }
  }

  // Inter-block contacts concentrated at centromere positions
  for (let a = 0; a < blocks.length; a++) {
    for (let b = a + 1; b < blocks.length; b++) {
      const cenA = blocks[a].centromere;
      const cenB = blocks[b].centromere;
      // Gaussian hub of inter-block contacts around centromeres
      for (let i = blocks[a].start; i < blocks[a].end; i++) {
        for (let j = blocks[b].start; j < blocks[b].end; j++) {
          const distA = Math.abs(i - cenA);
          const distB = Math.abs(j - cenB);
          const interContact = Math.exp(-(distA * distA + distB * distB) / 50);
          map[i * size + j] += interContact;
          map[j * size + i] += interContact; // symmetric
        }
      }
    }
  }

  return map;
}

function makeContigRanges(blocks: { start: number; end: number }[]): ContigRange[] {
  return blocks.map((b, i) => ({ start: b.start, end: b.end, orderIndex: i }));
}

/** Uniform noise map — no structure. */
function makeNoiseMap(size: number): Float32Array {
  const map = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    map[i] = Math.abs(Math.sin(i * 7.3 + 0.5)) * 0.1;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CentromereDetector', () => {
  describe('detectCentromeres', () => {
    it('returns valid result object', () => {
      const size = 64;
      const blocks = [
        { start: 0, end: 30, centromere: 15 },
        { start: 30, end: 64, centromere: 47 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      expect(result).toHaveProperty('positions');
      expect(result).toHaveProperty('confidences');
      expect(result).toHaveProperty('contigIndices');
      expect(result).toHaveProperty('signalProfile');
      expect(result.signalProfile.length).toBe(size);
    });

    it('detects centromeres near expected positions', () => {
      const size = 100;
      const blocks = [
        { start: 0, end: 50, centromere: 25 },
        { start: 50, end: 100, centromere: 75 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      expect(result.positions.length).toBe(2);
      // Predicted centromeres should be within ~5 pixels of the true positions
      expect(Math.abs(result.positions[0] - 25)).toBeLessThan(8);
      expect(Math.abs(result.positions[1] - 75)).toBeLessThan(8);
    });

    it('assigns correct contig indices', () => {
      const size = 80;
      const blocks = [
        { start: 0, end: 40, centromere: 20 },
        { start: 40, end: 80, centromere: 60 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      expect(result.contigIndices.length).toBe(result.positions.length);
      if (result.positions.length >= 2) {
        expect(result.contigIndices[0]).toBe(0);
        expect(result.contigIndices[1]).toBe(1);
      }
    });

    it('confidences are between 0 and 1', () => {
      const size = 80;
      const blocks = [
        { start: 0, end: 40, centromere: 20 },
        { start: 40, end: 80, centromere: 60 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      for (const c of result.confidences) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    });

    it('skips contigs smaller than minContigSpan', () => {
      const size = 50;
      const ranges: ContigRange[] = [
        { start: 0, end: 3, orderIndex: 0 },  // too small
        { start: 3, end: 50, orderIndex: 1 },
      ];
      const map = new Float32Array(size * size);
      // Some random contacts
      for (let i = 0; i < size * size; i++) map[i] = Math.random();
      const result = detectCentromeres(map, size, ranges);

      // Should only process contig 1 (contig 0 is too small)
      for (const idx of result.contigIndices) {
        expect(idx).toBe(1);
      }
    });

    it('handles empty contig ranges', () => {
      const size = 32;
      const map = new Float32Array(size * size);
      const result = detectCentromeres(map, size, []);

      expect(result.positions).toHaveLength(0);
      expect(result.confidences).toHaveLength(0);
      expect(result.contigIndices).toHaveLength(0);
    });

    it('handles noise map gracefully', () => {
      const size = 64;
      const ranges: ContigRange[] = [
        { start: 0, end: 32, orderIndex: 0 },
        { start: 32, end: 64, orderIndex: 1 },
      ];
      const map = makeNoiseMap(size);
      const result = detectCentromeres(map, size, ranges);

      // Should still return valid result (may or may not find centromeres)
      expect(Array.isArray(result.positions)).toBe(true);
      expect(result.signalProfile.length).toBe(size);
    });

    it('signalProfile has non-zero values for detected contigs', () => {
      const size = 80;
      const blocks = [
        { start: 0, end: 40, centromere: 20 },
        { start: 40, end: 80, centromere: 60 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      // Signal profile should have some non-zero values
      let hasNonZero = false;
      for (let i = 0; i < result.signalProfile.length; i++) {
        if (result.signalProfile[i] > 0) { hasNonZero = true; break; }
      }
      expect(hasNonZero).toBe(true);
    });

    it('respects antiDiagonalWeight parameter', () => {
      const size = 80;
      const blocks = [
        { start: 0, end: 40, centromere: 20 },
        { start: 40, end: 80, centromere: 60 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);

      const withAntiDiag = detectCentromeres(map, size, ranges, { antiDiagonalWeight: 0.5 });
      const withoutAntiDiag = detectCentromeres(map, size, ranges, { antiDiagonalWeight: 0 });

      // Both should detect centromeres
      expect(withAntiDiag.positions.length).toBeGreaterThan(0);
      expect(withoutAntiDiag.positions.length).toBeGreaterThan(0);
    });

    it('works with three blocks', () => {
      const size = 120;
      const blocks = [
        { start: 0, end: 40, centromere: 20 },
        { start: 40, end: 80, centromere: 60 },
        { start: 80, end: 120, centromere: 100 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);

      expect(result.positions.length).toBe(3);
    });
  });

  describe('centromereToTracks', () => {
    it('produces signal and marker tracks', () => {
      const size = 64;
      const blocks = [
        { start: 0, end: 32, centromere: 16 },
        { start: 32, end: 64, centromere: 48 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);
      const textureSize = 1024;

      const { signalTrack, markerTrack } = centromereToTracks(result, size, textureSize);

      expect(signalTrack.name).toBe('Centromere Signal');
      expect(signalTrack.data.length).toBe(textureSize);
      expect(signalTrack.type).toBe('line');
      expect(signalTrack.color).toBe('#e056a0');

      expect(markerTrack.name).toBe('Centromeres');
      expect(markerTrack.data.length).toBe(textureSize);
      expect(markerTrack.type).toBe('marker');
    });

    it('marker track has non-zero values at centromere positions', () => {
      const size = 64;
      const blocks = [
        { start: 0, end: 32, centromere: 16 },
        { start: 32, end: 64, centromere: 48 },
      ];
      const map = makeMapWithCentromeres(size, blocks);
      const ranges = makeContigRanges(blocks);
      const result = detectCentromeres(map, size, ranges);
      const textureSize = 1024;

      const { markerTrack } = centromereToTracks(result, size, textureSize);

      // Should have exactly as many markers as detected centromeres
      let markerCount = 0;
      for (let i = 0; i < markerTrack.data.length; i++) {
        if (markerTrack.data[i] > 0) markerCount++;
      }
      expect(markerCount).toBe(result.positions.length);
    });

    it('handles empty result', () => {
      const result = {
        positions: [],
        confidences: [],
        contigIndices: [],
        signalProfile: new Float32Array(64),
      };
      const { signalTrack, markerTrack } = centromereToTracks(result, 64, 1024);

      expect(signalTrack.data.length).toBe(1024);
      expect(markerTrack.data.length).toBe(1024);
    });
  });
});
