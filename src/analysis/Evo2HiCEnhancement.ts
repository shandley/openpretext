/**
 * Evo2HiCEnhancement — pure utility functions for encoding, decoding,
 * downscaling, and validating Hi-C contact maps for Evo2-based resolution
 * enhancement.
 *
 * No DOM or network dependencies.
 */

/** Encode a Float32Array contact map to a base64 string. */
export function encodeContactMap(map: Float32Array): string {
  const bytes = new Uint8Array(map.buffer, map.byteOffset, map.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode a base64 string back to a Float32Array contact map. */
export function decodeContactMap(base64: string, size: number): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = new Float32Array(bytes.buffer);
  if (result.length !== size * size) {
    throw new Error(`Expected ${size * size} floats, got ${result.length}`);
  }
  return result;
}

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

/** Validate that an enhanced map has the expected dimensions and finite values. */
export function validateEnhancedMap(map: Float32Array, expectedSize: number): boolean {
  if (map.length !== expectedSize * expectedSize) return false;
  for (let i = 0; i < map.length; i++) {
    if (!Number.isFinite(map[i])) return false;
  }
  return true;
}
