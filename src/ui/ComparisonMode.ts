/**
 * ComparisonMode — overlay original contig boundaries for visual comparison
 * with diff-style color coding showing what changed since the baseline.
 */

import type { AppContext } from './AppContext';
import type { CameraState } from '../renderer/Camera';
import { state } from '../core/State';
import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

export interface DiffSummary {
  moved: number;
  inverted: number;
  added: number;     // contigs created by cuts (not in snapshot)
  removed: number;   // contigs removed by joins (in snapshot but not in current)
  unchanged: number;
  total: number;
}

export type ContigChangeType = 'unchanged' | 'moved' | 'inverted' | 'added';

/**
 * Compute per-contig change type and an overall diff summary.
 * Returns a Map from contig ID → change type for the current order.
 */
export function computeDiff(
  snapshot: number[],
  invertedSnapshot: Map<number, boolean>,
  currentOrder: number[],
  contigs: ContigInfo[],
): { changes: Map<number, ContigChangeType>; summary: DiffSummary } {
  const snapshotSet = new Set(snapshot);
  const currentSet = new Set(currentOrder);
  const changes = new Map<number, ContigChangeType>();

  let moved = 0;
  let inverted = 0;
  let added = 0;
  let unchanged = 0;

  // Build position map for snapshot order (only contigs still present)
  const snapshotPos = new Map<number, number>();
  let pos = 0;
  for (const id of snapshot) {
    if (currentSet.has(id)) {
      snapshotPos.set(id, pos++);
    }
  }

  // Walk current order and classify each contig
  let currentPos = 0;
  for (const id of currentOrder) {
    if (!snapshotSet.has(id)) {
      // New contig (from a cut)
      changes.set(id, 'added');
      added++;
    } else {
      const wasInverted = invertedSnapshot.get(id) ?? false;
      const isInverted = contigs[id]?.inverted ?? false;
      const oldPos = snapshotPos.get(id) ?? -1;

      if (wasInverted !== isInverted) {
        changes.set(id, 'inverted');
        inverted++;
      } else if (oldPos !== currentPos) {
        changes.set(id, 'moved');
        moved++;
      } else {
        changes.set(id, 'unchanged');
        unchanged++;
      }
      currentPos++;
    }
  }

  // Removed contigs (joined away)
  const removed = [...snapshotSet].filter(id => !currentSet.has(id)).length;

  return {
    changes,
    summary: {
      moved,
      inverted,
      added,
      removed,
      unchanged,
      total: currentOrder.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Colors for each change type
// ---------------------------------------------------------------------------

const CHANGE_COLORS: Record<ContigChangeType, string> = {
  unchanged: 'rgba(52, 152, 219, 0.5)',   // blue (original)
  moved:     'rgba(243, 156, 18, 0.7)',    // orange
  inverted:  'rgba(155, 89, 182, 0.7)',    // purple
  added:     'rgba(46, 204, 113, 0.7)',    // green
};

// ---------------------------------------------------------------------------
// Toggle + summary
// ---------------------------------------------------------------------------

export function toggleComparisonMode(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data loaded');
    return;
  }
  if (!ctx.comparisonSnapshot) {
    ctx.showToast('No comparison snapshot available');
    return;
  }
  ctx.comparisonVisible = !ctx.comparisonVisible;

  if (ctx.comparisonVisible) {
    const inv = ctx.comparisonInvertedSnapshot ?? new Map();
    const { summary } = computeDiff(ctx.comparisonSnapshot, inv, s.contigOrder, s.map.contigs);
    const parts: string[] = [];
    if (summary.moved > 0) parts.push(`${summary.moved} moved`);
    if (summary.inverted > 0) parts.push(`${summary.inverted} inverted`);
    if (summary.added > 0) parts.push(`${summary.added} new`);
    if (summary.removed > 0) parts.push(`${summary.removed} removed`);
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ' (no changes)';
    ctx.showToast(`Comparison: ON${detail}`);
  } else {
    ctx.showToast('Comparison: OFF');
  }
  updateComparisonSummary(ctx);
}

// ---------------------------------------------------------------------------
// Sidebar summary panel
// ---------------------------------------------------------------------------

export function updateComparisonSummary(ctx: AppContext): void {
  const el = document.getElementById('comparison-summary');
  if (!el) return;

  if (!ctx.comparisonVisible || !ctx.comparisonSnapshot) {
    el.style.display = 'none';
    return;
  }

  const s = state.get();
  if (!s.map) {
    el.style.display = 'none';
    return;
  }

  const inv = ctx.comparisonInvertedSnapshot ?? new Map();
  const { summary } = computeDiff(ctx.comparisonSnapshot, inv, s.contigOrder, s.map.contigs);

  const rows: string[] = [];
  if (summary.moved > 0)
    rows.push(`<span class="diff-badge diff-moved">${summary.moved} moved</span>`);
  if (summary.inverted > 0)
    rows.push(`<span class="diff-badge diff-inverted">${summary.inverted} inverted</span>`);
  if (summary.added > 0)
    rows.push(`<span class="diff-badge diff-added">${summary.added} new</span>`);
  if (summary.removed > 0)
    rows.push(`<span class="diff-badge diff-removed">${summary.removed} removed</span>`);
  if (summary.unchanged > 0)
    rows.push(`<span class="diff-badge diff-unchanged">${summary.unchanged} unchanged</span>`);

  el.style.display = 'block';
  el.innerHTML = `<div class="diff-summary">${rows.join(' ')}</div>`;
}

// ---------------------------------------------------------------------------
// Canvas overlay rendering
// ---------------------------------------------------------------------------

export function renderComparisonOverlay(ctx: AppContext, canvasCtx: CanvasRenderingContext2D, cam: CameraState, canvasWidth: number, canvasHeight: number): void {
  if (!ctx.comparisonVisible || !ctx.comparisonSnapshot) return;
  const s = state.get();
  if (!s.map) return;

  const inv = ctx.comparisonInvertedSnapshot ?? new Map();
  const { changes } = computeDiff(ctx.comparisonSnapshot, inv, s.contigOrder, s.map.contigs);

  // Build boundary arrays for original order (baseline dashed lines)
  const totalPixels = s.map.textureSize;
  const origBoundaries: number[] = [];
  let acc = 0;
  for (const contigId of ctx.comparisonSnapshot) {
    const contig = s.map.contigs[contigId];
    if (contig) {
      acc += (contig.pixelEnd - contig.pixelStart);
      origBoundaries.push(acc / totalPixels);
    }
  }

  canvasCtx.save();

  // Draw original boundaries as semi-transparent blue dashed lines
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
  canvasCtx.lineWidth = 1;

  for (const boundary of origBoundaries) {
    const screenX = (boundary - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;
    const screenY = (boundary - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;

    if (screenX > 0 && screenX < canvasWidth) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(screenX, 0);
      canvasCtx.lineTo(screenX, canvasHeight);
      canvasCtx.stroke();
    }
    if (screenY > 0 && screenY < canvasHeight) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, screenY);
      canvasCtx.lineTo(canvasWidth, screenY);
      canvasCtx.stroke();
    }
  }

  // Draw colored markers on current contig boundaries showing change type
  canvasCtx.setLineDash([]);
  canvasCtx.lineWidth = 3;
  let currentAcc = 0;
  for (const contigId of s.contigOrder) {
    const contig = s.map.contigs[contigId];
    if (!contig) continue;
    const changeType = changes.get(contigId) ?? 'unchanged';
    if (changeType === 'unchanged') {
      currentAcc += (contig.pixelEnd - contig.pixelStart);
      continue;
    }

    const startNorm = currentAcc / totalPixels;
    currentAcc += (contig.pixelEnd - contig.pixelStart);
    const endNorm = currentAcc / totalPixels;
    const midNorm = (startNorm + endNorm) / 2;

    const color = CHANGE_COLORS[changeType];
    canvasCtx.strokeStyle = color;

    // Draw tick marks at the edges of the map for this contig
    const screenStart = (startNorm - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;
    const screenEnd = (endNorm - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;
    const screenMid = (midNorm - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;

    // Top edge marker (horizontal bar)
    if (screenStart < canvasWidth && screenEnd > 0) {
      const x0 = Math.max(0, screenStart);
      const x1 = Math.min(canvasWidth, screenEnd);
      canvasCtx.beginPath();
      canvasCtx.moveTo(x0, 0);
      canvasCtx.lineTo(x1, 0);
      canvasCtx.stroke();
    }

    // Left edge marker (vertical bar)
    const screenStartY = (startNorm - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;
    const screenEndY = (endNorm - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;
    if (screenStartY < canvasHeight && screenEndY > 0) {
      const y0 = Math.max(0, screenStartY);
      const y1 = Math.min(canvasHeight, screenEndY);
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, y0);
      canvasCtx.lineTo(0, y1);
      canvasCtx.stroke();
    }

    // Draw change icon at midpoint if visible
    const screenMidY = (midNorm - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;
    if (screenMid > 10 && screenMid < canvasWidth - 10) {
      canvasCtx.fillStyle = color;
      canvasCtx.font = '10px monospace';
      const icon = changeType === 'moved' ? '\u2194' : changeType === 'inverted' ? '\u27F3' : '+';
      canvasCtx.fillText(icon, screenMid - 4, 14);
    }
    if (screenMidY > 10 && screenMidY < canvasHeight - 10) {
      canvasCtx.fillStyle = color;
      canvasCtx.font = '10px monospace';
      const icon = changeType === 'moved' ? '\u2194' : changeType === 'inverted' ? '\u27F3' : '+';
      canvasCtx.fillText(icon, 4, screenMidY + 4);
    }
  }

  canvasCtx.restore();
}
