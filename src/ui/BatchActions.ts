/**
 * BatchActions — batch select, cut, join, invert, sort, auto-sort, auto-cut.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { undoBatch } from '../curation/CurationEngine';
import {
  selectByPattern,
  selectBySize,
  batchCutBySize,
  batchJoinSelected,
  batchInvertSelected,
  sortByLength,
  autoSortContigs,
  autoCutContigs,
} from '../curation/BatchOperations';

export function runBatchSelectByPattern(ctx: AppContext): void {
  const pattern = prompt('Enter name pattern (regex):');
  if (!pattern) return;
  try {
    const indices = selectByPattern(pattern);
    if (indices.length === 0) {
      ctx.showToast('No contigs match pattern');
      return;
    }
    for (const idx of indices) {
      SelectionManager.selectToggle(idx);
    }
    ctx.updateSidebarContigList();
    ctx.showToast(`Selected ${indices.length} contigs matching "${pattern}"`);
  } catch (err) {
    ctx.showToast(`Invalid pattern: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

export function runBatchSelectBySize(ctx: AppContext): void {
  const input = prompt('Enter size range in bp (min-max, e.g. 1000000-5000000):');
  if (!input) return;
  const parts = input.split('-').map(s => parseInt(s.trim(), 10));
  const min = parts[0] || undefined;
  const max = parts[1] || undefined;
  const indices = selectBySize(min, max);
  if (indices.length === 0) {
    ctx.showToast('No contigs in size range');
    return;
  }
  for (const idx of indices) {
    SelectionManager.selectToggle(idx);
  }
  ctx.updateSidebarContigList();
  ctx.showToast(`Selected ${indices.length} contigs in size range`);
}

export function runBatchCut(ctx: AppContext): void {
  const input = prompt('Cut contigs larger than (bp):');
  if (!input) return;
  const minLength = parseInt(input.trim(), 10);
  if (isNaN(minLength) || minLength <= 0) {
    ctx.showToast('Invalid size');
    return;
  }
  const result = batchCutBySize(minLength);
  ctx.refreshAfterCuration();
  ctx.showToast(result.description);
}

export function runBatchJoin(ctx: AppContext): void {
  const result = batchJoinSelected();
  if (result.operationsPerformed === 0) {
    ctx.showToast('Select adjacent contigs to batch join');
    return;
  }
  SelectionManager.clearSelection();
  ctx.refreshAfterCuration();
  ctx.showToast(result.description);
}

export function runBatchInvert(ctx: AppContext): void {
  const result = batchInvertSelected();
  if (result.operationsPerformed === 0) {
    ctx.showToast('Select contigs to batch invert');
    return;
  }
  ctx.refreshAfterCuration();
  ctx.showToast(result.description);
}

export function runSortByLength(ctx: AppContext): void {
  const result = sortByLength(true);
  ctx.refreshAfterCuration();
  ctx.showToast(result.description);
}

export function runAutoSort(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) {
    ctx.showToast('No contact map loaded');
    return;
  }
  const input = prompt('Link threshold (0.05-0.8, default 0.20):');
  if (input === null) return;
  const hardThreshold = input.trim() ? parseFloat(input) : undefined;
  if (hardThreshold !== undefined && (isNaN(hardThreshold) || hardThreshold <= 0 || hardThreshold > 1)) {
    ctx.showToast('Invalid threshold'); return;
  }
  ctx.showToast('Auto sorting...');
  setTimeout(() => {
    const result = autoSortContigs(hardThreshold !== undefined ? { hardThreshold } : undefined);
    ctx.refreshAfterCuration();
    ctx.showToast(result.description);
  }, 50);
}

export function runAutoCut(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) {
    ctx.showToast('No contact map loaded');
    return;
  }
  const input = prompt('Cut sensitivity (0.05-0.5, default 0.20):');
  if (input === null) return;
  const cutThreshold = input.trim() ? parseFloat(input) : undefined;
  if (cutThreshold !== undefined && (isNaN(cutThreshold) || cutThreshold <= 0 || cutThreshold > 1)) {
    ctx.showToast('Invalid threshold'); return;
  }
  ctx.showToast('Auto cutting...');
  setTimeout(() => {
    const result = autoCutContigs(cutThreshold !== undefined ? { cutThreshold } : undefined);
    ctx.refreshAfterCuration();
    ctx.showToast(result.description);
  }, 50);
}

export function undoLastBatch(ctx: AppContext, prefix: string): void {
  const s = state.get();
  const lastOp = [...s.undoStack].reverse().find(op => op.batchId?.startsWith(prefix));
  if (!lastOp?.batchId) {
    ctx.showToast(`No ${prefix} operations to undo`);
    return;
  }
  const count = undoBatch(lastOp.batchId);
  ctx.refreshAfterCuration();
  ctx.showToast(`Undid ${count} ${prefix} operation(s)`);
}
