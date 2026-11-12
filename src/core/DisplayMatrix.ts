/**
 * DisplayMatrix — the overview contact matrix in the curated order.
 *
 * `MapData.contactMap` is the file's coarse matrix and stays in file order
 * for the life of the map. Everything that analyses the assembly as the
 * curator has arranged it (insulation, decay, compartments, auto-cut,
 * auto-sort, join support, ...) lays contigs out left to right in display
 * order and must therefore read a matrix in that order. This module is where
 * that matrix comes from; analyses should not read `contactMap` directly.
 *
 * The mapping is DisplayMapping's, sampled at the overview's resolution: each
 * display cell takes the file cell under its centre. Where a contig edge falls
 * inside a cell, the cell belongs to whichever contig covers its centre, so
 * values within half a cell of a moved contig's edge are approximate. That is
 * the resolution of the overview, not something a different resampling
 * would recover.
 */

import { state, type ContigInfo, type MapData } from './State';
import { buildDisplayRuns, buildCellRemap, type DisplayRun } from './DisplayMapping';

/**
 * For each display cell of a `size`-wide overview, the file cell it shows
 * (-1 past the end of the displayed contigs).
 */
export function displayCellRemap(
  contigs: ContigInfo[], order: number[], textureSize: number, size: number,
): Int32Array {
  return buildCellRemap(buildDisplayRuns(contigs, order), textureSize, size);
}

function isIdentity(remap: Int32Array): boolean {
  for (let i = 0; i < remap.length; i++) if (remap[i] !== i) return false;
  return true;
}

/** Permute a square file-order matrix by a cell remap. Cells mapped to -1 are 0. */
export function permuteMatrix(fileMatrix: Float32Array, size: number, remap: Int32Array): Float32Array {
  const out = new Float32Array(size * size);
  for (let dy = 0; dy < size; dy++) {
    const sy = remap[dy];
    if (sy < 0) continue;
    const dst = dy * size;
    const src = sy * size;
    for (let dx = 0; dx < size; dx++) {
      const sx = remap[dx];
      if (sx >= 0) out[dst + dx] = fileMatrix[src + sx];
    }
  }
  return out;
}

/** Reorder a per-cell vector from file order to display order (-1 cells get `fill`). */
export function permuteVector(fileValues: Float32Array, remap: Int32Array, fill = NaN): Float32Array {
  const out = new Float32Array(remap.length).fill(fill);
  for (let d = 0; d < remap.length; d++) if (remap[d] >= 0) out[d] = fileValues[remap[d]];
  return out;
}

/**
 * The overview laid out as `order` places the contigs, starting at cell 0.
 *
 * `order` may be a subset of the assembly (one scaffold's contigs, say): the
 * result then holds just those contigs packed from the left, and zeros beyond.
 * Callers lay their own ranges out the same way, by accumulating widths over
 * `order` and scaling by `size / textureSize`.
 *
 * Returns the input array itself when the order leaves it unchanged, so the
 * result must be treated as read-only.
 */
export function buildDisplayMatrix(map: MapData, order: number[]): Float32Array | null {
  if (!map.contactMap) return null;
  const size = Math.round(Math.sqrt(map.contactMap.length));
  const remap = displayCellRemap(map.contigs, order, map.textureSize, size);
  return isIdentity(remap) ? map.contactMap : permuteMatrix(map.contactMap, size, remap);
}

// One cached matrix for the current state. Keyed on the file matrix and the
// layout's content, so edits that leave the layout alone (scaffold painting
// replaces the map object) do not rebuild it.
let cachedFor: Float32Array | null = null;
let cachedLayout = '';
let cachedMatrix: Float32Array | null = null;

function layoutKey(runs: DisplayRun[], textureSize: number): string {
  let key = `${textureSize}`;
  for (const r of runs) key += `|${r.displayStart},${r.length},${r.fileStart},${r.reversed ? 1 : 0}`;
  return key;
}

/**
 * The current assembly's overview in display order, with its dimension.
 * Null when no map (or no overview) is loaded. Read-only.
 */
export function getDisplayContactMap(): { data: Float32Array; size: number } | null {
  const s = state.get();
  const map = s.map;
  if (!map?.contactMap) return null;
  const size = Math.round(Math.sqrt(map.contactMap.length));
  const runs = buildDisplayRuns(map.contigs, s.contigOrder);
  const key = layoutKey(runs, map.textureSize);
  if (cachedFor !== map.contactMap || cachedLayout !== key || !cachedMatrix) {
    const remap = buildCellRemap(runs, map.textureSize, size);
    cachedMatrix = isIdentity(remap) ? map.contactMap : permuteMatrix(map.contactMap, size, remap);
    cachedFor = map.contactMap;
    cachedLayout = key;
  }
  return { data: cachedMatrix, size };
}
