/**
 * EventWiring — Connects core EventBus events to UI refresh logic.
 *
 * Extracted from the OpenPretextApp class so that main.ts stays a
 * pure orchestrator and the event-subscription details live here.
 */

import type { AppContext } from './AppContext';
import { events } from '../core/EventBus';
import { state } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';
import { metaTags } from '../curation/MetaTagManager';
import { getContigBoundaries } from '../core/DerivedState';
import { clearAnalysisTracks, runAllAnalyses, scheduleAnalysisRecompute, updateProgressPanel, clearEnhancedMap } from './AnalysisPanel';
import { resetOEMap } from './OEMapToggle';
import { updateComparisonSummary } from './ComparisonMode';
import { reorderContactMap } from '../renderer/ContactMapReorder';
import { syncOverviewModeSelect } from './ColorMapControls';
import { refreshCuratorTracks } from './CuratorTracks';

/**
 * Subscribe to all relevant EventBus events and wire them to the
 * appropriate UI refresh helpers.
 */
export function setupEventListeners(ctx: AppContext): void {
  events.on('file:loaded', () => {
    // Reset the view to fit so a newly loaded genome isn't shown at the
    // previous file's zoom/pan (which can leave the fresh map off-screen).
    ctx.camera?.resetViewImmediate();
    // A new assembly replaces the overview texture; drop any O/E view.
    resetOEMap(ctx);

    ctx.updateSidebarContigList();
    ctx.updateSidebarScaffoldList();
    // Take initial metrics snapshot
    const s = state.get();
    if (s.map) {
      ctx.metricsTracker.clear();
      ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, 0);
      // Store initial order and inversion state for comparison mode
      ctx.comparisonSnapshot = [...s.contigOrder];
      ctx.comparisonInvertedSnapshot = new Map(
        s.contigOrder.map(id => [id, s.map!.contigs[id]?.inverted ?? false])
      );
      ctx.comparisonVisible = false;
      contigExclusion.clearAll();
      metaTags.clearAll();
      // A newly loaded file has no FASTA-derived tracks yet; clear any from the
      // previous file so they aren't reused against the new assembly.
      ctx.fastaTrackData = null;
      // Set progress reference to initial contig order
      ctx.progressReference = [...s.contigOrder];
      ctx.previousProgress = null;
    }
    ctx.updateStatsPanel();

    // Auto-compute 3D analysis tracks
    clearAnalysisTracks(ctx);
    runAllAnalyses(ctx);

    // Surface the curator tracks (coverage, gaps, telomeres, ...) embedded in
    // the .pretext file, if any.
    refreshCuratorTracks(ctx);

    // Show orientation toast for first-time guidance
    setTimeout(() => {
      ctx.showToast('Scroll to zoom \u2022 Drag to pan \u2022 Press E for edit mode \u2022 \u2318K for commands', 5000);
    }, 800);
  });

  events.on('misassembly:updated', () => ctx.updateSidebarContigList());
  events.on('metatag:updated', () => ctx.updateSidebarContigList());
  // Scaffold assignment changes scaffold-level metrics (scaffold N50, auN,
  // % assigned), so re-snapshot and refresh the stats panel. Assignment does
  // not go through refreshAfterCuration, so it needs its own hook to stay live.
  events.on('scaffold:changed', () => {
    const s = state.get();
    if (s.map) ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
    ctx.updateStatsPanel();
  });

  events.on('curation:cut', (data) => { if (ctx.suppressCurationRefresh) return; refreshAfterCuration(ctx); flashContig(ctx, data?.contigIndex); });
  events.on('curation:join', (data) => { if (ctx.suppressCurationRefresh) return; refreshAfterCuration(ctx); flashContig(ctx, data?.contigIndex); });
  events.on('curation:invert', (data) => { if (ctx.suppressCurationRefresh) return; refreshAfterCuration(ctx); flashContig(ctx, data?.contigIndex); });
  events.on('curation:move', (data) => { if (ctx.suppressCurationRefresh) return; refreshAfterCuration(ctx); flashContig(ctx, data?.toIndex ?? data?.fromIndex); });
  events.on('curation:undo', () => refreshAfterCuration(ctx));
  events.on('curation:redo', () => refreshAfterCuration(ctx));
}

/**
 * Briefly flash-highlight a contig after a curation operation.
 */
function flashContig(ctx: AppContext, contigIndex?: number): void {
  if (contigIndex == null || contigIndex < 0 || contigIndex >= ctx.contigBoundaries.length) return;
  ctx.flashHighlightStart = contigIndex === 0 ? 0 : ctx.contigBoundaries[contigIndex - 1];
  ctx.flashHighlightEnd = ctx.contigBoundaries[contigIndex];
  ctx.flashHighlightUntil = performance.now() + 800;
}

/**
 * Refresh all downstream UI after any curation operation
 * (cut, join, invert, move, undo, redo).
 */
export function refreshAfterCuration(ctx: AppContext): void {
  rebuildContigBoundaries(ctx);
  reorderAndUploadContactMap(ctx);
  refreshCuratorTracks(ctx);
  ctx.updateSidebarContigList();
  ctx.updateSidebarScaffoldList();
  const s = state.get();
  document.getElementById('status-contigs')!.textContent = `${s.contigOrder.length} contigs`;
  // Snapshot quality metrics
  if (s.map) {
    ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
  }
  ctx.updateStatsPanel();
  ctx.updateUndoHistoryPanel();
  updateComparisonSummary(ctx);
  // Clear enhanced map on curation (ordering changed, enhancement is stale)
  clearEnhancedMap();
  // Curation re-uploaded the raw map above; drop O/E and restore the colour map.
  resetOEMap(ctx);
  // Update curation progress panel
  updateProgressPanel(ctx);
  // Schedule debounced analysis recompute (insulation + P(s) only)
  scheduleAnalysisRecompute(ctx);
}

/**
 * Reorder the contact map to match the current contig display order
 * and re-upload the texture to the GPU.
 */
function reorderAndUploadContactMap(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) return;
  const original = overviewForMode(ctx, s);
  if (!original) return;
  const mapSize = Math.round(Math.sqrt(original.length));
  if (mapSize === 0) return;

  // Gate texture = the current mode's overview in ORIGINAL order (it must align
  // with the original-order detail tiles). Both modes gate the detail layer by
  // their own overview, so detail stays consistent with the overview at every
  // zoom (clean suppresses faint signal; faithful keeps the max-pooled signal).
  ctx.renderer.uploadGateOverview(original, mapSize);

  const reordered = reorderContactMap(original, s.map.contigs, s.contigOrder, mapSize);
  ctx.renderer.uploadContactMap(reordered, mapSize);
  ctx.minimap.updateThumbnail(reordered, mapSize);
}

/**
 * Pick the original-order overview for the current mode. Faithful uses the
 * worker-assembled max-pooled overview cached on ctx (see applyOverviewMode);
 * if it isn't available, falls back to the clean overview so the map is never
 * blank.
 */
function overviewForMode(ctx: AppContext, s: ReturnType<typeof state.get>): Float32Array | null {
  if (!s.map) return null;
  const clean = s.map.originalContactMap ?? null;
  if (s.overviewMode === 'faithful' && ctx.faithfulOverviewOriginal) {
    return ctx.faithfulOverviewOriginal;
  }
  return clean;
}

/** Cheap check that an assembled overview actually carries signal. */
function overviewHasSignal(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] > 0.02) return true;
  return false;
}

/**
 * Re-apply the overview for the current `overviewMode` (clean ⇄ faithful),
 * reordered to the current contig order. For faithful, lazily asks the tile
 * decode worker (which owns the raw tile bytes) to assemble the max-pooled
 * overview and caches it. If faithful can't be assembled, reverts to clean
 * rather than uploading a blank texture.
 */
export async function applyOverviewMode(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (s.overviewMode === 'faithful' && !ctx.faithfulOverviewOriginal && ctx.tileDecoder && s.map?.parsedHeader) {
    try {
      const { overview } = await ctx.tileDecoder.assembleOverview('faithful');
      if (overview.length > 0 && overviewHasSignal(overview)) {
        ctx.faithfulOverviewOriginal = overview;
      }
    } catch {
      /* fall through to the clean fallback below */
    }
    if (!ctx.faithfulOverviewOriginal) {
      state.update({ overviewMode: 'clean' });
      syncOverviewModeSelect('clean');
      ctx.showToast('Faithful overview unavailable — showing Clean');
    }
  }
  reorderAndUploadContactMap(ctx);
  ctx.requestRender();
}

/**
 * Recompute contig boundary positions (as fractions of texture size)
 * from the current contig order.
 */
export function rebuildContigBoundaries(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) return;
  ctx.contigBoundaries = getContigBoundaries();
}
