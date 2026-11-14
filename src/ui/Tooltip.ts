/**
 * Tooltip — contig info tooltip on hover.
 *
 * Module-local state: tooltipVisible flag.
 */

import { escapeHtml, cssColor } from './Html';
import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { formatBp } from './Sidebar';
import { locateDisplayTexel, boundaryAtOffset, cutOffsetAt, type SequencePosition } from '../core/SequenceCoords';

let tooltipVisible = false;

export function updateTooltip(ctx: AppContext, clientX: number, clientY: number): void {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;

  const s = state.get();
  if (!s.map || ctx.hoveredContigIndex < 0) {
    hideTooltip();
    return;
  }

  const contigId = s.contigOrder[ctx.hoveredContigIndex];
  const contig = s.map.contigs[contigId];
  if (!contig) {
    hideTooltip();
    return;
  }

  // Build tooltip content
  const lengthStr = formatBp(contig.length);
  const pixelSpan = contig.pixelEnd - contig.pixelStart;
  const orderStr = `${ctx.hoveredContigIndex + 1} / ${s.contigOrder.length}`;
  const orientStr = contig.inverted ? 'Inverted' : 'Forward';
  const scaffoldInfo = contig.scaffoldId !== null
    ? ctx.scaffoldManager.getScaffold(contig.scaffoldId)
    : null;

  let html = `<div class="tooltip-name">${escapeHtml(contig.name)}</div>`;
  html += `<div class="tooltip-row"><span class="label">Length</span><span class="value">${lengthStr}</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Pixels</span><span class="value">${pixelSpan} px</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Order</span><span class="value">${orderStr}</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Orient.</span><span class="value">${orientStr}</span></div>`;
  if (scaffoldInfo) {
    html += `<div class="tooltip-row"><span class="label">Scaffold</span><span class="value"><span class="tooltip-badge" style="background:${cssColor(scaffoldInfo.color)};color:#fff;">${escapeHtml(scaffoldInfo.name)}</span></span></div>`;
  }

  // Where the cursor is in the sequences the map was built from. The column
  // under the cursor first, then the row when it is a different place.
  const N = s.map.textureSize;
  const at = (v: number) => (v >= 0 && v < 1 ? locateDisplayTexel(s.map!, s.contigOrder, Math.floor(v * N)) : null);
  const px = at(ctx.mouseMapPos.x);
  const py = at(ctx.mouseMapPos.y);
  const where = (p: SequencePosition) => `${escapeHtml(p.sequence)}: ${p.bpStart.toLocaleString('en-US')}`;
  const row = (label: string, value: string) =>
    `<div class="tooltip-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  if (px) {
    html += row('Position', `${where(px)} bp`);
    html += row('Texel', `${px.offset} of ${px.contigTexels}`);
    if (py && (py.sourceIndex !== px.sourceIndex || py.sequenceTexel !== px.sequenceTexel)) {
      html += row('Against', `${where(py)} bp`);
    }
    if (ctx.currentMode === 'edit') {
      // What pressing C would do from here.
      const prev = ctx.hoveredContigIndex === 0 ? 0 : ctx.contigBoundaries[ctx.hoveredContigIndex - 1];
      const cur = ctx.contigBoundaries[ctx.hoveredContigIndex];
      const offset = cutOffsetAt(px.contigTexels, (ctx.mouseMapPos.x - prev) / (cur - prev));
      const b = boundaryAtOffset(s.map, s.contigOrder, ctx.hoveredContigIndex, offset);
      if (b) html += row('Cut here', `after ${b.bp.toLocaleString('en-US')} bp (offset ${offset})`);
    }
  }

  tooltip.innerHTML = html;

  // Position tooltip near cursor (offset to avoid overlapping)
  const offsetX = 16;
  const offsetY = 16;
  let left = clientX + offsetX;
  let top = clientY + offsetY;

  // Keep within viewport
  const tooltipW = tooltip.offsetWidth || 200;
  const tooltipH = tooltip.offsetHeight || 100;
  if (left + tooltipW > window.innerWidth - 10) {
    left = clientX - tooltipW - 8;
  }
  if (top + tooltipH > window.innerHeight - 10) {
    top = clientY - tooltipH - 8;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.add('visible');
  tooltipVisible = true;
}

export function hideTooltip(): void {
  if (!tooltipVisible) return;
  const tooltip = document.getElementById('tooltip');
  if (tooltip) tooltip.classList.remove('visible');
  tooltipVisible = false;
}
