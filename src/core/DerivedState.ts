/**
 * DerivedState — Cached derived computations that auto-invalidate
 * via state.select().
 *
 * These replace per-frame recomputations in RenderLoop with cached
 * values that only update when the underlying state changes.
 */

import { state, type AppState } from './State';

let cachedContigNames: string[] | null = null;
let cachedContigScaffoldIds: (number | null)[] | null = null;
let cachedContigBoundaries: number[] | null = null;

// Selector that captures both contigOrder and map reference.
// When either changes, derived caches are invalidated.
function selectContigDeps(s: AppState): { order: number[]; map: AppState['map'] } {
  return { order: s.contigOrder, map: s.map };
}

state.select(selectContigDeps, () => {
  cachedContigNames = null;
  cachedContigScaffoldIds = null;
  cachedContigBoundaries = null;
});

/**
 * Returns contig names in current display order. Cached until
 * contigOrder or map changes.
 */
export function getContigNames(): string[] {
  if (cachedContigNames !== null) return cachedContigNames;
  const s = state.get();
  if (!s.map) return [];
  cachedContigNames = s.contigOrder.map(id => s.map!.contigs[id]?.name ?? '');
  return cachedContigNames;
}

/**
 * Returns scaffold IDs for contigs in current display order. Cached
 * until contigOrder or map changes.
 */
export function getContigScaffoldIds(): (number | null)[] {
  if (cachedContigScaffoldIds !== null) return cachedContigScaffoldIds;
  const s = state.get();
  if (!s.map) return [];
  cachedContigScaffoldIds = s.contigOrder.map(id => s.map!.contigs[id]?.scaffoldId ?? null);
  return cachedContigScaffoldIds;
}

/**
 * Returns accumulated contig boundary positions as fractions of
 * texture size. Cached until contigOrder or map changes.
 */
export function getContigBoundaries(): number[] {
  if (cachedContigBoundaries !== null) return cachedContigBoundaries;
  const s = state.get();
  if (!s.map) return [];
  const totalPixels = s.map.textureSize;
  let accumulated = 0;
  cachedContigBoundaries = [];
  for (const contigId of s.contigOrder) {
    const contig = s.map.contigs[contigId];
    accumulated += (contig.pixelEnd - contig.pixelStart);
    cachedContigBoundaries.push(accumulated / totalPixels);
  }
  return cachedContigBoundaries;
}
