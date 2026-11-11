/**
 * BaseOverview — putting the file's own whole-map view on screen.
 *
 * The map texture normally holds one of the file's stored mip levels, in file
 * order; the renderer lays it out in the curated order itself. Some views
 * (observed/expected, model output) temporarily replace it with a texture
 * computed in display order. Everything that needs the file's view back goes
 * through showBaseOverview, so there is one place that decides which level
 * that is.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { reorderContactMap } from '../renderer/ContactMapReorder';

/**
 * The file-order overview for the current mode. 'faithful' uses the finer
 * stored mip level, assembled by the tile worker and cached on ctx (see
 * EventWiring.applyOverviewMode); if it isn't available, falls back to the
 * coarsest level so the map is never blank.
 */
export function overviewForMode(ctx: AppContext): Float32Array | null {
  const s = state.get();
  if (!s.map) return null;
  if (s.overviewMode === 'faithful' && ctx.faithfulOverviewOriginal) {
    return ctx.faithfulOverviewOriginal;
  }
  return s.map.originalContactMap ?? null;
}

/**
 * Show the file's overview for the current mode and refresh the minimap.
 *
 * The texture is uploaded only if it is not already the one on the GPU, so
 * this is cheap to call after every curation edit: an edit changes the
 * layout, not the texture.
 */
export function showBaseOverview(ctx: AppContext): void {
  const base = overviewForMode(ctx);
  if (!base) return;
  const size = Math.round(Math.sqrt(base.length));
  if (size === 0) return;
  if (!ctx.renderer.isCurrentMap(base)) {
    ctx.renderer.uploadContactMap(base, size, 'file');
  }
  refreshMinimap(ctx);
  ctx.renderDirty = true;
}

/**
 * Redraw the minimap thumbnail in the curated order. The thumbnail is 160 px
 * across, so it is built from the coarsest level whatever the overview mode.
 */
export function refreshMinimap(ctx: AppContext): void {
  const s = state.get();
  const coarse = s.map?.originalContactMap;
  if (!s.map || !coarse) return;
  const size = Math.round(Math.sqrt(coarse.length));
  if (size === 0) return;
  const reordered = reorderContactMap(coarse, s.map.contigs, s.contigOrder, size);
  ctx.minimap.updateThumbnail(reordered, size, undefined, s.signalFloor, s.signalCeil);
}
