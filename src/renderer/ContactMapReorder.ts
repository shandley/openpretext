/**
 * ContactMapReorder — Permutes a contact map Float32Array to match
 * the current contig display order.
 *
 * The original contact map stores data in file order. When contigs are
 * reordered via curation operations, rows and columns must be permuted
 * so the WebGL texture reflects the new arrangement.
 */

import type { ContigInfo } from '../core/State';
import { buildDisplayRuns, buildCellRemap, displayWidth } from '../core/DisplayMapping';

/**
 * Build a pixel-level remapping table from display order to original order.
 *
 * For each pixel in the display-ordered map, returns the corresponding
 * pixel index in the original (file-order) map, or -1 for a display pixel
 * that shows nothing (only possible if the order omits contigs).
 *
 * The mapping itself is DisplayMapping's; this only samples it at the
 * overview's resolution.
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
  const runs = buildDisplayRuns(contigs, contigOrder);
  // The overview covers the full-resolution map, whose width is the total of
  // the displayed contigs (they partition it).
  return buildCellRemap(runs, displayWidth(runs), mapSize);
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
    if (sy < 0) continue;
    const destRowOffset = dy * mapSize;
    const srcRowOffset = sy * mapSize;
    for (let dx = 0; dx < mapSize; dx++) {
      const sx = remap[dx];
      if (sx >= 0) result[destRowOffset + dx] = originalMap[srcRowOffset + sx];
    }
  }

  return result;
}
