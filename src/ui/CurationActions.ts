/**
 * CurationActions — undo, redo, invert, cut, join, contig exclusion.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { CurationEngine, undoBatch } from '../curation/CurationEngine';
import { SelectionManager } from '../curation/SelectionManager';
import { contigExclusion } from '../curation/ContigExclusion';

export function performUndo(ctx: AppContext): void {
  // When the most recent operation belongs to a batch (a script run, autosort,
  // autocut, ...), undo the whole batch as one action rather than one op.
  const undoStack = state.get().undoStack ?? [];
  const top = undoStack[undoStack.length - 1];
  if (top?.batchId) {
    ctx.suppressCurationRefresh = true;
    let count = 0;
    try {
      count = undoBatch(top.batchId);
    } finally {
      ctx.suppressCurationRefresh = false;
    }
    ctx.refreshAfterCuration();
    ctx.showToast(count > 1 ? `Undo (${count} operations)` : 'Undo');
    return;
  }
  if (CurationEngine.undo()) {
    ctx.showToast('Undo');
  }
}

export function performRedo(ctx: AppContext): void {
  if (CurationEngine.redo()) {
    ctx.showToast('Redo');
  }
}

export function invertSelectedContigs(ctx: AppContext): void {
  const selected = SelectionManager.getSelectedIndices();
  if (selected.length === 0) {
    ctx.showToast('No contigs selected');
    return;
  }
  for (const idx of selected) {
    CurationEngine.invert(idx);
  }
  ctx.showToast(`Inverted ${selected.length} contig(s)`);
}

export function cutAtCursorPosition(ctx: AppContext): void {
  if (ctx.currentMode !== 'edit') return;
  const s = state.get();
  if (!s.map || ctx.hoveredContigIndex < 0) {
    ctx.showToast('Hover over a contig to cut');
    return;
  }

  const prevBoundary = ctx.hoveredContigIndex === 0 ? 0 : ctx.contigBoundaries[ctx.hoveredContigIndex - 1];
  const curBoundary = ctx.contigBoundaries[ctx.hoveredContigIndex];
  const fraction = (ctx.mouseMapPos.x - prevBoundary) / (curBoundary - prevBoundary);

  const contigId = s.contigOrder[ctx.hoveredContigIndex];
  const contig = s.map.contigs[contigId];
  const contigPixelLength = contig.pixelEnd - contig.pixelStart;
  const pixelOffset = Math.round(fraction * contigPixelLength);

  if (pixelOffset <= 0 || pixelOffset >= contigPixelLength) {
    ctx.showToast('Cannot cut at edge of contig');
    return;
  }

  CurationEngine.cut(ctx.hoveredContigIndex, pixelOffset);
  SelectionManager.clearSelection();
  ctx.showToast(`Cut: ${contig.name} at offset ${pixelOffset}`);
}

export function joinSelectedContigs(ctx: AppContext): void {
  if (ctx.currentMode !== 'edit') return;
  const selected = SelectionManager.getSelectedIndices();

  if (selected.length === 1) {
    const idx = selected[0];
    const s = state.get();
    if (idx >= s.contigOrder.length - 1) {
      ctx.showToast('No right neighbor to join with');
      return;
    }
    CurationEngine.join(idx);
    SelectionManager.clearSelection();
    ctx.showToast('Joined contigs');
  } else if (selected.length === 2) {
    const sorted = [...selected].sort((a, b) => a - b);
    if (sorted[1] - sorted[0] !== 1) {
      ctx.showToast('Selected contigs must be adjacent to join');
      return;
    }
    CurationEngine.join(sorted[0]);
    SelectionManager.clearSelection();
    ctx.showToast('Joined contigs');
  } else {
    ctx.showToast('Select 1 or 2 adjacent contigs to join');
  }
}

export function toggleContigExclusion(ctx: AppContext): void {
  if (ctx.currentMode !== 'edit') return;
  const order = state.get().contigOrder;
  const selected = SelectionManager.getSelectedIndices();
  if (selected.length > 0) {
    // Exclusion is keyed by contig identity, so map order positions to IDs.
    for (const idx of selected) {
      contigExclusion.toggle(order[idx]);
    }
    ctx.showToast(`Toggled exclusion on ${selected.length} contig(s)`);
  } else if (ctx.hoveredContigIndex >= 0) {
    const wasExcluded = contigExclusion.toggle(order[ctx.hoveredContigIndex]);
    ctx.showToast(wasExcluded ? 'Contig excluded' : 'Contig included');
  } else {
    ctx.showToast('Hover or select contigs to exclude');
  }
  ctx.updateSidebarContigList();
  ctx.updateStatsPanel();
}
