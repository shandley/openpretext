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
import { getContigBoundaries } from '../core/DerivedState';
import { clearAnalysisTracks, runAllAnalyses } from './AnalysisPanel';

/**
 * Subscribe to all relevant EventBus events and wire them to the
 * appropriate UI refresh helpers.
 */
export function setupEventListeners(ctx: AppContext): void {
  events.on('file:loaded', () => {
    ctx.updateSidebarContigList();
    // Take initial metrics snapshot
    const s = state.get();
    if (s.map) {
      ctx.metricsTracker.clear();
      ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, 0);
      // Store initial order for comparison mode
      ctx.comparisonSnapshot = [...s.contigOrder];
      ctx.comparisonVisible = false;
      contigExclusion.clearAll();
    }
    ctx.updateStatsPanel();

    // Auto-compute 3D analysis tracks
    clearAnalysisTracks(ctx);
    runAllAnalyses(ctx);
  });

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
  ctx.updateSidebarContigList();
  const s = state.get();
  document.getElementById('status-contigs')!.textContent = `${s.contigOrder.length} contigs`;
  // Snapshot quality metrics
  if (s.map) {
    ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
  }
  ctx.updateStatsPanel();
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
