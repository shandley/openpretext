/**
 * ContactMapReorder — Permutes a contact map Float32Array to match
 * the current contig display order.
 *
 * The original contact map stores data in file order. When contigs are
 * reordered via curation operations, rows and columns must be permuted
 * so the WebGL texture reflects the new arrangement.
 */

import type { ContigInfo } from '../core/State';

/**
 * Build a pixel-level remapping table from display order to original order.
 *
 * For each pixel in the display-ordered map, returns the corresponding
 * pixel index in the original (file-order) map.
 *
 * @param contigs     Full contigs array (indexed by original contig ID)
 * @param contigOrder Display order: contigOrder[displayPos] = originalContigId
 * @param mapSize     The overview contact map dimension (sqrt of contactMap.length))
 * @returns           Array of length mapSize where result[displayPixel] = originalPixel
 */
export function buildPixelRemapTable(
  contigs: ContigInfo[],
  contigOrder: number[],
  mapSize: number,
): Int32Array {
  const remap = new Int32Array(mapSize);

  // Compute the overview scale factor: overview pixels per full-resolution pixel.
  // contigs store pixelStart/pixelEnd in full-resolution coordinates,
  // but the overview contactMap may be smaller (e.g. 64x64 for a 32768px map).
  // We need to figure out the total pixel span from contigs.
  let totalOriginalPixels = 0;
  for (const id of contigOrder) {
    const c = contigs[id];
    totalOriginalPixels += (c.pixelEnd - c.pixelStart);
  }
  // If totalOriginalPixels is 0, nothing to remap
  if (totalOriginalPixels === 0) return remap;

  const scale = mapSize / totalOriginalPixels;

  let destPixel = 0;
  for (const contigId of contigOrder) {
    const c = contigs[contigId];
    const contigPixels = c.pixelEnd - c.pixelStart;
    const destSpan = Math.round((destPixel + contigPixels * scale)) - Math.round(destPixel);

    for (let i = 0; i < destSpan && Math.round(destPixel) + i < mapSize; i++) {
      // Map display pixel back to the original pixel coordinate.
      // When a contig is inverted, reverse the pixel order within its span.
      const srcPixel = c.inverted
        ? Math.round(c.pixelStart * scale) + (destSpan - 1 - i)
        : Math.round(c.pixelStart * scale) + i;
      remap[Math.round(destPixel) + i] = Math.min(Math.max(srcPixel, 0), mapSize - 1);
    }
    destPixel += contigPixels * scale;
  }

  return remap;
}

/**
 * Reorder a contact map according to the current contig display order.
 *
 * Produces a new Float32Array with rows and columns permuted so that
 * the pixel layout matches the display order. The original contactMap
 * is never mutated.
 *
 * @param originalMap  The original (file-order) contact map, row-major Float32Array
 * @param contigs      Full contigs array (indexed by original contig ID)
 * @param contigOrder  Display order: contigOrder[displayPos] = originalContigId
 * @param mapSize      Dimension of the square contact map
 * @returns            New Float32Array with permuted rows/columns
 */
export function reorderContactMap(
  originalMap: Float32Array,
  contigs: ContigInfo[],
  contigOrder: number[],
  mapSize: number,
): Float32Array {
  const remap = buildPixelRemapTable(contigs, contigOrder, mapSize);
  const result = new Float32Array(mapSize * mapSize);

  for (let dy = 0; dy < mapSize; dy++) {
    const sy = remap[dy];
    const destRowOffset = dy * mapSize;
    const srcRowOffset = sy * mapSize;
    for (let dx = 0; dx < mapSize; dx++) {
      result[destRowOffset + dx] = originalMap[srcRowOffset + remap[dx]];
    }
  }

  return result;
}
