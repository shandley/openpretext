/**
 * UndoHistoryPanel — sidebar panel showing curation operation history
 * with click-to-revert and batch grouping.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import type { CurationOperation } from '../core/State';
import { undo, redo } from '../curation/CurationEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryGroup {
  type: 'single' | 'batch';
  ops: CurationOperation[];
  batchId?: string;
  label: string;
  timestamp: number;
  /** Number of individual ops to undo/redo to reach this point */
  opCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, string> = {
  cut: '\u2702',            // ✂
  move: '\u2194',           // ↔
  invert: '\u27F3',         // ⟳
  join: '\u2295',           // ⊕
  scaffold_paint: '\u25C6', // ◆
};

function iconFor(type: string): string {
  return TYPE_ICONS[type] ?? '?';
}

export function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

/** Group consecutive operations sharing a batchId (newest-first). */
export function groupOps(ops: CurationOperation[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let i = ops.length - 1;
  while (i >= 0) {
    const op = ops[i];
    if (op.batchId) {
      // Collect all consecutive ops with same batchId (walking backwards)
      const batch: CurationOperation[] = [op];
      let j = i - 1;
      while (j >= 0 && ops[j].batchId === op.batchId) {
        batch.push(ops[j]);
        j--;
      }
      const count = batch.length;
      // Use description of first op in batch, or build from batchId prefix
      const prefix = op.batchId.replace(/-\d+$/, '').replace(/-/g, ' ');
      const label = `${prefix} (${count} ops)`;
      groups.push({
        type: 'batch',
        ops: batch,
        batchId: op.batchId,
        label,
        timestamp: op.timestamp,
        opCount: count,
      });
      i = j;
    } else {
      groups.push({
        type: 'single',
        ops: [op],
        label: op.description,
        timestamp: op.timestamp,
        opCount: 1,
      });
      i--;
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function updateUndoHistoryPanel(ctx: AppContext): void {
  const el = document.getElementById('undo-history-content');
  if (!el) return;

  const s = state.get();
  const { undoStack, redoStack } = s;

  if (undoStack.length === 0 && redoStack.length === 0) {
    el.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;">No operations yet</div>';
    return;
  }

  const undoGroups = groupOps(undoStack);
  const redoGroups = groupOps(redoStack);

  let html = '';

  // Undo groups (newest first — groupOps already returns newest first)
  let undoCumulative = 0;
  for (const g of undoGroups) {
    undoCumulative += g.opCount;
    const icon = g.type === 'batch' ? '\u229E' : iconFor(g.ops[0].type); // ⊞ for batch
    const badge = g.type === 'batch'
      ? ` <span class="history-batch-count">${g.opCount}</span>`
      : '';
    html += `<div class="history-item" data-stack="undo" data-count="${undoCumulative}">
      <span class="history-icon">${icon}</span>
      <span class="history-desc">${g.label}${badge}</span>
      <span class="history-time">${relativeTime(g.timestamp)}</span>
    </div>`;
  }

  // Separator
  if (redoGroups.length > 0) {
    html += '<div class="history-separator">redo</div>';
  }

  // Redo groups (oldest redo first = groups are newest-first, so reverse)
  const redoReversed = [...redoGroups].reverse();
  let redoCumulative = 0;
  for (const g of redoReversed) {
    redoCumulative += g.opCount;
    const icon = g.type === 'batch' ? '\u229E' : iconFor(g.ops[0].type);
    const badge = g.type === 'batch'
      ? ` <span class="history-batch-count">${g.opCount}</span>`
      : '';
    html += `<div class="history-item redo" data-stack="redo" data-count="${redoCumulative}">
      <span class="history-icon">${icon}</span>
      <span class="history-desc">${g.label}${badge}</span>
      <span class="history-time">${relativeTime(g.timestamp)}</span>
    </div>`;
  }

  el.innerHTML = html;

  // Wire click handlers
  el.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => {
      const htmlItem = item as HTMLElement;
      const stack = htmlItem.dataset.stack;
      const count = parseInt(htmlItem.dataset.count ?? '0', 10);
      if (count <= 0) return;

      const verb = stack === 'undo' ? 'Undo' : 'Redo';
      if (count > 10 && !confirm(`${verb} ${count} operations?`)) return;

      const fn = stack === 'undo' ? undo : redo;
      for (let k = 0; k < count; k++) fn();
      ctx.refreshAfterCuration();
    });
  });
}
