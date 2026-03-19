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
import { clearAnalysisTracks, runAllAnalyses, scheduleAnalysisRecompute, updateProgressPanel } from './AnalysisPanel';
import { updateComparisonSummary } from './ComparisonMode';
import { reorderContactMap } from '../renderer/ContactMapReorder';

/**
 * Subscribe to all relevant EventBus events and wire them to the
 * appropriate UI refresh helpers.
 */
export function setupEventListeners(ctx: AppContext): void {
  events.on('file:loaded', () => {
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
      // Set progress reference to initial contig order
      ctx.progressReference = [...s.contigOrder];
      ctx.previousProgress = null;
    }
    ctx.updateStatsPanel();

    // Auto-compute 3D analysis tracks
    clearAnalysisTracks(ctx);
    runAllAnalyses(ctx);

    // Show orientation toast for first-time guidance
    setTimeout(() => {
      ctx.showToast('Scroll to zoom \u2022 Drag to pan \u2022 Press E for edit mode \u2022 \u2318K for commands', 5000);
    }, 800);
  });

  events.on('misassembly:updated', () => ctx.updateSidebarContigList());
  events.on('metatag:updated', () => ctx.updateSidebarContigList());

  events.on('curation:cut', () => refreshAfterCuration(ctx));
  events.on('curation:join', () => refreshAfterCuration(ctx));
  events.on('curation:invert', () => refreshAfterCuration(ctx));
  events.on('curation:move', () => refreshAfterCuration(ctx));
  events.on('curation:undo', () => refreshAfterCuration(ctx));
  events.on('curation:redo', () => refreshAfterCuration(ctx));
}

/**
 * Refresh all downstream UI after any curation operation
 * (cut, join, invert, move, undo, redo).
 */
export function refreshAfterCuration(ctx: AppContext): void {
  rebuildContigBoundaries(ctx);
  reorderAndUploadContactMap(ctx);
  ctx.updateSidebarContigList();
  const s = state.get();
  document.getElementById('status-contigs')!.textContent = `${s.contigOrder.length} contigs`;
  // Snapshot quality metrics
  if (s.map) {
    ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
  }
  ctx.updateStatsPanel();
  ctx.updateUndoHistoryPanel();
  updateComparisonSummary(ctx);
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
  const original = s.map.originalContactMap;
  if (!original) return;
  const mapSize = Math.round(Math.sqrt(original.length));
  if (mapSize === 0) return;

  const reordered = reorderContactMap(original, s.map.contigs, s.contigOrder, mapSize);
  ctx.renderer.uploadContactMap(reordered, mapSize);
  ctx.minimap.updateThumbnail(reordered, mapSize);
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
