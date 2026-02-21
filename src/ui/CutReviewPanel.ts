/**
 * CutReviewPanel — Step-by-step guided review of cut suggestions.
 *
 * Presents a floating panel that shows one misassembly-based cut
 * suggestion at a time, navigates the camera to the cut location,
 * and lets the user accept, skip, or go back through the queue.
 * After each accepted cut the queue rebuilds from fresh detection.
 */

import type { AppContext } from './AppContext';
import type { CutSuggestion } from '../analysis/MisassemblyDetector';
import { buildCutSuggestions } from '../analysis/MisassemblyDetector';
import { misassemblyFlags } from '../curation/MisassemblyFlags';
import { cut } from '../curation/CurationEngine';
import { state } from '../core/State';
import { buildContigRanges, runMisassemblyDetection } from './AnalysisPanel';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ReviewState {
  queue: CutSuggestion[];
  currentIndex: number;
  accepted: number;
  skipped: number;
  skippedKeys: Set<string>;
  active: boolean;
}

let reviewState: ReviewState | null = null;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable key that survives queue rebuilds (contigId is stable for un-cut contigs). */
function suggestionKey(s: CutSuggestion): string {
  return `${s.contigId}:${s.pixelOffset}`;
}

/** Navigate the camera to show the diagonal region around a cut point. */
function navigateToSuggestion(ctx: AppContext, suggestion: CutSuggestion): void {
  const s = state.get();
  if (!s.map) return;

  const boundaries = ctx.contigBoundaries;
  const idx = suggestion.orderIndex;
  if (idx < 0 || idx >= boundaries.length) return;

  const start = idx === 0 ? 0 : boundaries[idx - 1];
  const end = boundaries[idx];

  // Fractional position of the cut within the contig
  const contig = s.map.contigs[suggestion.contigId];
  const contigPixelLen = contig.pixelEnd - contig.pixelStart;
  const cutFraction = contigPixelLen > 0 ? suggestion.pixelOffset / contigPixelLen : 0.5;

  // Map-space position of the cut point on the diagonal
  const cutPos = start + (end - start) * cutFraction;

  // Zoom to ~3x contig span centered on the cut (minimum 5% of map)
  const contigSpan = end - start;
  const viewSpan = Math.max(contigSpan * 3, 0.05);
  const half = viewSpan / 2;

  ctx.camera.zoomToRegion(cutPos - half, cutPos - half, cutPos + half, cutPos + half);
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

function renderReviewPanel(ctx: AppContext): void {
  let panel = document.getElementById('cut-review-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cut-review-panel';
    document.body.appendChild(panel);
  }

  if (!reviewState || !reviewState.active) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';

  const { queue, currentIndex, accepted, skipped } = reviewState;

  // --- Summary screen (all suggestions processed) ---
  if (currentIndex >= queue.length) {
    panel.innerHTML = `
      <div class="review-header">
        <span>Review Complete</span>
        <button id="btn-close-review">\u00d7</button>
      </div>
      <div class="review-body">
        <div class="review-summary">
          <div class="review-summary-stat" style="color:#27ae60;">${accepted} accepted</div>
          <div class="review-summary-stat" style="color:var(--text-secondary);">${skipped} skipped</div>
        </div>
        <button class="review-done-btn" id="btn-review-done">Done</button>
      </div>`;
    document.getElementById('btn-close-review')?.addEventListener('click', () => closeCutReview(ctx));
    document.getElementById('btn-review-done')?.addEventListener('click', () => closeCutReview(ctx));
    return;
  }

  // --- Current suggestion card ---
  const suggestion = queue[currentIndex];
  const reasonLabel =
    suggestion.reason === 'both' ? 'TAD + compartment' :
    suggestion.reason === 'tad_boundary' ? 'TAD boundary' : 'Compartment switch';

  const strengthPct = Math.round(suggestion.strength * 100);
  const strengthColor =
    suggestion.strength >= 0.7 ? '#e94560' :
    suggestion.strength >= 0.4 ? '#f39c12' : '#888';

  panel.innerHTML = `
    <div class="review-header">
      <span>Review Cuts</span>
      <span class="review-progress">${currentIndex + 1} of ${queue.length}</span>
      <button id="btn-close-review">\u00d7</button>
    </div>
    <div class="review-body">
      <div class="review-card">
        <div class="review-contig-name">${suggestion.contigName}</div>
        <div class="review-detail">${reasonLabel}</div>
        <div class="review-detail">Offset: ${suggestion.pixelOffset}px</div>
        <div class="review-detail">Strength: <span style="color:${strengthColor}">${strengthPct}%</span></div>
      </div>
      <div class="review-actions">
        <button class="review-back-btn" id="btn-review-back" ${currentIndex === 0 ? 'disabled' : ''}>Back <kbd>B</kbd></button>
        <button class="review-skip-btn" id="btn-review-skip">Skip <kbd>N</kbd></button>
        <button class="review-accept-btn" id="btn-review-accept">Accept <kbd>Y</kbd></button>
      </div>
      <div class="review-stats">${accepted} accepted \u00b7 ${skipped} skipped</div>
    </div>`;

  document.getElementById('btn-close-review')?.addEventListener('click', () => closeCutReview(ctx));
  document.getElementById('btn-review-back')?.addEventListener('click', () => reviewBack(ctx));
  document.getElementById('btn-review-skip')?.addEventListener('click', () => reviewSkip(ctx));
  document.getElementById('btn-review-accept')?.addEventListener('click', () => reviewAccept(ctx));
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

function reviewAccept(ctx: AppContext): void {
  if (!reviewState?.active) return;
  const suggestion = reviewState.queue[reviewState.currentIndex];
  if (!suggestion) return;

  try {
    cut(suggestion.orderIndex, suggestion.pixelOffset);
    ctx.refreshAfterCuration();
    reviewState.accepted++;
    ctx.showToast(`Cut ${suggestion.contigName} at offset ${suggestion.pixelOffset}`);
  } catch (e) {
    ctx.showToast(`Cut failed: ${(e as Error).message}`, 4000);
    reviewState.skippedKeys.add(suggestionKey(suggestion));
    reviewState.skipped++;
    advanceAfterSkip(ctx);
    return;
  }

  rebuildQueueAfterCut(ctx);
}

function reviewSkip(ctx: AppContext): void {
  if (!reviewState?.active) return;
  const suggestion = reviewState.queue[reviewState.currentIndex];
  if (!suggestion) return;

  reviewState.skippedKeys.add(suggestionKey(suggestion));
  reviewState.skipped++;
  advanceAfterSkip(ctx);
}

function advanceAfterSkip(ctx: AppContext): void {
  if (!reviewState) return;
  reviewState.currentIndex++;

  if (reviewState.currentIndex < reviewState.queue.length) {
    navigateToSuggestion(ctx, reviewState.queue[reviewState.currentIndex]);
  }
  renderReviewPanel(ctx);
}

function reviewBack(ctx: AppContext): void {
  if (!reviewState?.active || reviewState.currentIndex === 0) return;

  // Un-skip the previous suggestion if it was skipped
  const prev = reviewState.queue[reviewState.currentIndex - 1];
  if (prev && reviewState.skippedKeys.has(suggestionKey(prev))) {
    reviewState.skippedKeys.delete(suggestionKey(prev));
    reviewState.skipped--;
  }

  reviewState.currentIndex--;
  navigateToSuggestion(ctx, reviewState.queue[reviewState.currentIndex]);
  renderReviewPanel(ctx);
}

// ---------------------------------------------------------------------------
// Queue rebuild after cut
// ---------------------------------------------------------------------------

function rebuildQueueAfterCut(ctx: AppContext): void {
  if (!reviewState) return;

  const s = state.get();
  if (!s.map) {
    closeCutReview(ctx);
    return;
  }

  // Re-detect using cached analysis data + new contig layout
  runMisassemblyDetection(ctx);

  const ranges = buildContigRanges();
  const flags = misassemblyFlags.getAllFlags();

  if (flags.length === 0) {
    reviewState.queue = [];
    reviewState.currentIndex = 0;
    renderReviewPanel(ctx);
    return;
  }

  const newSuggestions = buildCutSuggestions(flags, ranges, s.map.contigs, s.contigOrder);

  // Filter out previously skipped, sort ascending for left-to-right review
  reviewState.queue = newSuggestions
    .filter(sg => !reviewState!.skippedKeys.has(suggestionKey(sg)))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  reviewState.currentIndex = 0;

  if (reviewState.queue.length > 0) {
    navigateToSuggestion(ctx, reviewState.queue[0]);
  }
  renderReviewPanel(ctx);
}

// ---------------------------------------------------------------------------
// Keyboard handler (capture phase)
// ---------------------------------------------------------------------------

function installKeyboardHandler(ctx: AppContext): void {
  removeKeyboardHandler();

  keydownHandler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!reviewState?.active) return;

    switch (e.key.toLowerCase()) {
      case 'y':
        e.preventDefault();
        e.stopPropagation();
        reviewAccept(ctx);
        break;
      case 'n':
        e.preventDefault();
        e.stopPropagation();
        reviewSkip(ctx);
        break;
      case 'b':
        e.preventDefault();
        e.stopPropagation();
        reviewBack(ctx);
        break;
      case 'escape':
        e.preventDefault();
        e.stopPropagation();
        closeCutReview(ctx);
        break;
    }
  };

  window.addEventListener('keydown', keydownHandler, true);
}

function removeKeyboardHandler(): void {
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler, true);
    keydownHandler = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openCutReview(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) return;

  const ranges = buildContigRanges();
  const flags = misassemblyFlags.getAllFlags();
  if (flags.length === 0) {
    ctx.showToast('No misassemblies detected');
    return;
  }

  const suggestions = buildCutSuggestions(flags, ranges, s.map.contigs, s.contigOrder);
  if (suggestions.length === 0) {
    ctx.showToast('No cut suggestions available');
    return;
  }

  // Sort ascending for left-to-right review
  suggestions.sort((a, b) => a.orderIndex - b.orderIndex);

  reviewState = {
    queue: suggestions,
    currentIndex: 0,
    accepted: 0,
    skipped: 0,
    skippedKeys: new Set(),
    active: true,
  };

  installKeyboardHandler(ctx);
  navigateToSuggestion(ctx, suggestions[0]);
  renderReviewPanel(ctx);
}

export function closeCutReview(ctx: AppContext): void {
  if (reviewState && reviewState.accepted > 0) {
    ctx.showToast(
      `Review complete: ${reviewState.accepted} accepted, ${reviewState.skipped} skipped`,
      4000,
    );
  }

  reviewState = null;
  removeKeyboardHandler();

  const panel = document.getElementById('cut-review-panel');
  if (panel) panel.style.display = 'none';
}

export function isCutReviewActive(): boolean {
  return reviewState?.active ?? false;
}
