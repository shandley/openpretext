/**
 * Tooltip — contig info tooltip on hover.
 *
 * Module-local state: tooltipVisible flag.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { formatBp } from './Sidebar';

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

  let html = `<div class="tooltip-name">${contig.name}</div>`;
  html += `<div class="tooltip-row"><span class="label">Length</span><span class="value">${lengthStr}</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Pixels</span><span class="value">${pixelSpan} px</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Order</span><span class="value">${orderStr}</span></div>`;
  html += `<div class="tooltip-row"><span class="label">Orient.</span><span class="value">${orientStr}</span></div>`;
  if (scaffoldInfo) {
    html += `<div class="tooltip-row"><span class="label">Scaffold</span><span class="value"><span class="tooltip-badge" style="background:${scaffoldInfo.color};color:#fff;">${scaffoldInfo.name}</span></span></div>`;
  }

  // Show position in map space
  const mx = ctx.mouseMapPos.x;
  const my = ctx.mouseMapPos.y;
  html += `<div class="tooltip-row" style="margin-top:4px;font-size:10px;opacity:0.6"><span>Map pos</span><span>${mx.toFixed(3)}, ${my.toFixed(3)}</span></div>`;

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
