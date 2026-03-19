/**
 * Tests for src/analysis/Evo2HiCEnhancement.ts
 */

import { describe, it, expect } from 'vitest';
import {
  encodeContactMap,
  decodeContactMap,
  downscaleMap,
  validateEnhancedMap,
} from '../../src/analysis/Evo2HiCEnhancement';

// ---------------------------------------------------------------------------
// encodeContactMap / decodeContactMap
// ---------------------------------------------------------------------------

describe('encodeContactMap / decodeContactMap', () => {
  it('round-trips a 1x1 map', () => {
    const map = new Float32Array([42]);
    const encoded = encodeContactMap(map);
    const decoded = decodeContactMap(encoded, 1);
    expect(decoded.length).toBe(1);
    expect(decoded[0]).toBeCloseTo(42);
  });

  it('round-trips a 2x2 map', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    const decoded = decodeContactMap(encodeContactMap(map), 2);
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
  });

  it('round-trips a 4x4 map', () => {
    const map = new Float32Array(16);
    for (let i = 0; i < 16; i++) map[i] = i * 0.5;
    const decoded = decodeContactMap(encodeContactMap(map), 4);
    expect(decoded.length).toBe(16);
    for (let i = 0; i < 16; i++) expect(decoded[i]).toBeCloseTo(map[i]);
  });

  it('round-trips a larger map (8x8)', () => {
    const map = new Float32Array(64);
    for (let i = 0; i < 64; i++) map[i] = Math.random();
    const decoded = decodeContactMap(encodeContactMap(map), 8);
    for (let i = 0; i < 64; i++) expect(decoded[i]).toBeCloseTo(map[i], 5);
  });

  it('round-trips zero-filled map', () => {
    const map = new Float32Array(9);
    const decoded = decodeContactMap(encodeContactMap(map), 3);
    for (let i = 0; i < 9; i++) expect(decoded[i]).toBe(0);
  });

  it('preserves negative values', () => {
    const map = new Float32Array([-1.5, 0, 2.5, -0.001]);
    const decoded = decodeContactMap(encodeContactMap(map), 2);
    for (let i = 0; i < 4; i++) expect(decoded[i]).toBeCloseTo(map[i]);
  });

  it('produces a non-empty base64 string', () => {
    const map = new Float32Array([1]);
    const encoded = encodeContactMap(map);
    expect(encoded.length).toBeGreaterThan(0);
    expect(typeof encoded).toBe('string');
  });

  it('decodeContactMap throws on wrong size', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    const encoded = encodeContactMap(map);
    expect(() => decodeContactMap(encoded, 3)).toThrow(/Expected 9 floats, got 4/);
  });

  it('decodeContactMap throws when base64 is too short', () => {
    const map = new Float32Array([1]);
    const encoded = encodeContactMap(map);
    expect(() => decodeContactMap(encoded, 2)).toThrow(/Expected 4 floats/);
  });
});

// ---------------------------------------------------------------------------
// downscaleMap
// ---------------------------------------------------------------------------

describe('downscaleMap', () => {
  it('identity when same size', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    const result = downscaleMap(map, 2, 2);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('downscales 4x4 to 2x2 by area averaging', () => {
    // 4x4 map: each 2x2 block has uniform values
    const map = new Float32Array([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ]);
    const result = downscaleMap(map, 4, 2);
    expect(result.length).toBe(4);
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(3);
    expect(result[3]).toBeCloseTo(4);
  });

  it('downscales 4x4 to 2x2 with mixed values', () => {
    const map = new Float32Array([
      0, 0, 4, 4,
      0, 0, 4, 4,
      8, 8, 12, 12,
      8, 8, 12, 12,
    ]);
    const result = downscaleMap(map, 4, 2);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(4);
    expect(result[2]).toBeCloseTo(8);
    expect(result[3]).toBeCloseTo(12);
  });

  it('downscales 8x8 to 2x2', () => {
    const map = new Float32Array(64);
    // Fill quadrants: top-left=1, top-right=2, bottom-left=3, bottom-right=4
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const qy = y < 4 ? 0 : 1;
        const qx = x < 4 ? 0 : 1;
        map[y * 8 + x] = qy * 2 + qx + 1;
      }
    }
    const result = downscaleMap(map, 8, 2);
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(3);
    expect(result[3]).toBeCloseTo(4);
  });

  it('preserves symmetry', () => {
    // Symmetric 4x4
    const map = new Float32Array([
      10, 2, 3, 4,
      2, 10, 5, 6,
      3, 5, 10, 7,
      4, 6, 7, 10,
    ]);
    const result = downscaleMap(map, 4, 2);
    // result[0,1] should equal result[1,0] for a symmetric input
    expect(result[1]).toBeCloseTo(result[2]);
  });

  it('handles 1x1 target', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    const result = downscaleMap(map, 2, 1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(2.5);
  });

  it('handles 1x1 source and target', () => {
    const map = new Float32Array([7]);
    const result = downscaleMap(map, 1, 1);
    expect(result[0]).toBeCloseTo(7);
  });

  it('does not modify the input array', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    const copy = new Float32Array(map);
    downscaleMap(map, 2, 2);
    expect(Array.from(map)).toEqual(Array.from(copy));
  });

  it('downscales 6x6 to 3x3', () => {
    const map = new Float32Array(36);
    for (let i = 0; i < 36; i++) map[i] = 1;
    const result = downscaleMap(map, 6, 3);
    expect(result.length).toBe(9);
    for (let i = 0; i < 9; i++) expect(result[i]).toBeCloseTo(1);
  });

  it('downscales 6x6 to 2x2 (non-power-of-2)', () => {
    const map = new Float32Array(36);
    for (let i = 0; i < 36; i++) map[i] = 2;
    const result = downscaleMap(map, 6, 2);
    expect(result.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(result[i]).toBeCloseTo(2);
  });
});

// ---------------------------------------------------------------------------
// validateEnhancedMap
// ---------------------------------------------------------------------------

describe('validateEnhancedMap', () => {
  it('accepts a valid map', () => {
    const map = new Float32Array([1, 2, 3, 4]);
    expect(validateEnhancedMap(map, 2)).toBe(true);
  });

  it('accepts a zero-filled map', () => {
    const map = new Float32Array(9);
    expect(validateEnhancedMap(map, 3)).toBe(true);
  });

  it('accepts a map with negative values', () => {
    const map = new Float32Array([-1, 0, 0, 1]);
    expect(validateEnhancedMap(map, 2)).toBe(true);
  });

  it('rejects wrong size (too small)', () => {
    const map = new Float32Array([1, 2, 3]);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });

  it('rejects wrong size (too large)', () => {
    const map = new Float32Array(5);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });

  it('rejects map with NaN', () => {
    const map = new Float32Array([1, NaN, 3, 4]);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });

  it('rejects map with Infinity', () => {
    const map = new Float32Array([1, 2, Infinity, 4]);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });

  it('rejects map with negative Infinity', () => {
    const map = new Float32Array([1, 2, 3, -Infinity]);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });

  it('accepts a large valid map', () => {
    const map = new Float32Array(256);
    for (let i = 0; i < 256; i++) map[i] = i * 0.01;
    expect(validateEnhancedMap(map, 16)).toBe(true);
  });

  it('rejects empty map for non-zero expected size', () => {
    const map = new Float32Array(0);
    expect(validateEnhancedMap(map, 2)).toBe(false);
  });
});
