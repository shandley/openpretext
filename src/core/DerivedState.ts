/**
 * DerivedState — Cached derived computations that auto-invalidate
 * via state.select().
 *
 * These replace per-frame recomputations in RenderLoop with cached
 * values that only update when the underlying state changes.
 */

import { state, selectContigOrder } from './State';
import { isFileOrder } from './DisplayMapping';

let cachedContigNames: string[] | null = null;
let cachedContigScaffoldIds: (number | null)[] | null = null;
let cachedContigBoundaries: number[] | null = null;
let cachedIsFileOrder: boolean | null = null;

function invalidateDerivedCaches(): void {
  cachedIsFileOrder = null;
  cachedContigNames = null;
  cachedContigScaffoldIds = null;
  cachedContigBoundaries = null;
}

// Invalidate only when the contig order OR the map reference actually changes.
// Using two reference-identity selectors (instead of a freshly-allocated
// composite object) means unrelated updates — camera pan, gamma, selection —
// no longer null these caches every frame via the always-false Object.is check.
state.select(selectContigOrder, invalidateDerivedCaches);
state.select((s) => s.map, invalidateDerivedCaches);

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

/**
 * True when the displayed order still reads the file's texels in place (see
 * DisplayMapping.isFileOrder). Cached until contigOrder or map changes.
 */
export function getDisplayIsFileOrder(): boolean {
  if (cachedIsFileOrder !== null) return cachedIsFileOrder;
  const s = state.get();
  if (!s.map) return true;
  cachedIsFileOrder = isFileOrder(s.map.contigs, s.contigOrder);
  return cachedIsFileOrder;
}
