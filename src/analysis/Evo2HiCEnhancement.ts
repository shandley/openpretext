/**
 * Evo2HiCEnhancement — pure utility functions for encoding, decoding,
 * downscaling, and validating Hi-C contact maps for Evo2-based resolution
 * enhancement.
 *
 * No DOM or network dependencies.
 */

// Base64 <-> Float32Array codecs live in MLCodec (shared across ML backends);
// re-exported here for backward compatibility with existing importers.
export {
  encodeContactMap,
  decodeContactMap,
  encodeFloat32Array,
  decodeFloat32Array,
} from './MLCodec';

/** Bilinear downscale of a square matrix using area averaging. */
export function downscaleMap(
  enhanced: Float32Array,
  enhancedSize: number,
  targetSize: number,
): Float32Array {
  if (enhancedSize === targetSize) {
    return new Float32Array(enhanced);
  }
  const result = new Float32Array(targetSize * targetSize);
  const scale = enhancedSize / targetSize;

  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      const srcY0 = ty * scale;
      const srcY1 = Math.min((ty + 1) * scale, enhancedSize);
      const srcX0 = tx * scale;
      const srcX1 = Math.min((tx + 1) * scale, enhancedSize);

      let sum = 0;
      let count = 0;
      const iy0 = Math.floor(srcY0);
      const iy1 = Math.ceil(srcY1);
      const ix0 = Math.floor(srcX0);
      const ix1 = Math.ceil(srcX1);

      for (let sy = iy0; sy < iy1; sy++) {
        const wy =
          Math.min(sy + 1, srcY1) - Math.max(sy, srcY0);
        for (let sx = ix0; sx < ix1; sx++) {
          const wx =
            Math.min(sx + 1, srcX1) - Math.max(sx, srcX0);
          const w = wx * wy;
          sum += enhanced[sy * enhancedSize + sx] * w;
          count += w;
        }
      }
      result[ty * targetSize + tx] = count > 0 ? sum / count : 0;
    }
  }
  return result;
}

import type { TrackConfig } from '../renderer/TrackRenderer';

/**
 * Convert predicted epigenomic tracks to TrackConfig objects for rendering.
 * Maps from overviewSize coordinates to textureSize coordinates.
 */
export function trackPredictionToConfigs(
  tracks: { name: string; values: Float32Array; color: string }[],
  overviewSize: number,
  textureSize: number,
): TrackConfig[] {
  return tracks.map(track => {
    const data = new Float32Array(textureSize);
    for (let tp = 0; tp < textureSize; tp++) {
      const op = Math.min(
        Math.floor((tp / textureSize) * overviewSize),
        overviewSize - 1,
      );
      data[tp] = track.values[op];
    }
    return {
      name: track.name,
      type: 'line' as const,
      data,
      color: track.color,
      height: 25,
      visible: true,
    };
  });
}

/** Validate that an enhanced map has the expected dimensions and finite values. */
export function validateEnhancedMap(map: Float32Array, expectedSize: number): boolean {
  if (map.length !== expectedSize * expectedSize) return false;
  for (let i = 0; i < map.length; i++) {
    if (!Number.isFinite(map[i])) return false;
  }
  return true;
}
