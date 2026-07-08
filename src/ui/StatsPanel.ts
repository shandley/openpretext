/**
 * StatsPanel — assembly quality metrics display.
 *
 * Renders into the pinned status strip at the top of the Info sidebar: a compact
 * always-visible summary line (health + a few key numbers) plus a collapsible
 * detail block with the full metric list.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';
import { getHealthScore } from './AnalysisPanel';

const healthColor = (v: number) => (v >= 70 ? '#4caf50' : v >= 40 ? '#f39c12' : '#ff6b6b');

const fmtBp = (bp: number) => {
  if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(2)} Gb`;
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${bp} bp`;
};

export function updateStatsPanel(ctx: AppContext): void {
  const detail = document.getElementById('stats-content');
  const summaryEl = document.getElementById('stats-summary');
  if (!detail && !summaryEl) return;

  // getSummary() needs two snapshots (a baseline and a current) to compute
  // deltas, so it stays null until the first curation edit. Fall back to the
  // latest snapshot so metrics show as soon as an assembly loads, just without
  // the +/- change indicators.
  const summary = ctx.metricsTracker.getSummary();
  const m = summary ? summary.current : ctx.metricsTracker.getLatest();
  if (!m) {
    const empty = '<span style="color: var(--text-secondary);">No data loaded</span>';
    if (summaryEl) summaryEl.innerHTML = empty;
    if (detail) detail.innerHTML = `<div style="font-size: 12px;">${empty}</div>`;
    return;
  }
  // Count only excluded contigs still present in the current order (orphan-safe).
  const excluded = contigExclusion.getExcludedCountIn(state.get().contigOrder);
  const healthScore = getHealthScore(ctx);

  const delta = (val: number) => {
    if (val === 0) return '';
    const sign = val > 0 ? '+' : '';
    return ` <span style="color:${val > 0 ? '#4caf50' : '#ff6b6b'};font-size:10px;">(${sign}${val})</span>`;
  };

  // Compact summary line (always visible, pinned at the top of the sidebar).
  if (summaryEl) {
    const parts: string[] = [];
    const health = healthScore
      ? `<span class="metric-num" style="color:${healthColor(healthScore.overall)}">${healthScore.overall}</span>`
      : '<span class="metric-num" style="color:var(--text-secondary)">—</span>';
    parts.push(`<span>Health ${health}</span>`);
    parts.push(`<span><span class="metric-num">${m.contigCount}</span> <span class="metric-unit">contigs</span></span>`);
    parts.push(`<span>N50 <span class="metric-num">${fmtBp(m.n50)}</span></span>`);
    if (m.operationCount > 0) {
      parts.push(`<span><span class="metric-num">${m.operationCount}</span> <span class="metric-unit">ops</span></span>`);
    }
    summaryEl.innerHTML = parts.join('<span class="sep">·</span>');
  }

  if (!detail) return;

  let html = '';
  if (healthScore) {
    html += `<div class="stats-row"><span>Health Score</span><span style="color:${healthColor(healthScore.overall)};font-weight:600;">${healthScore.overall}</span></div>`;
  }
  html += `<div class="stats-row"><span>Contigs</span><span>${m.contigCount}${delta(summary?.contigCountDelta ?? 0)}</span></div>`;
  if (excluded > 0) {
    html += `<div class="stats-row"><span>Excluded</span><span style="color:#f39c12;">${excluded}</span></div>`;
  }
  html += `<div class="stats-row"><span>Total length</span><span>${fmtBp(m.totalLength)}</span></div>`;
  html += `<div class="stats-row"><span>N50</span><span>${fmtBp(m.n50)}${delta(summary?.n50Delta ?? 0)}</span></div>`;
  html += `<div class="stats-row"><span>L50</span><span>${m.l50}</span></div>`;
  html += `<div class="stats-row"><span>N90</span><span>${fmtBp(m.n90)}</span></div>`;
  html += `<div class="stats-row"><span>L90</span><span>${m.l90}</span></div>`;
  html += `<div class="stats-row"><span>Longest</span><span>${fmtBp(m.longestContig)}</span></div>`;
  html += `<div class="stats-row"><span>Shortest</span><span>${fmtBp(m.shortestContig)}</span></div>`;
  html += `<div class="stats-row"><span>Median</span><span>${fmtBp(m.medianLength)}</span></div>`;
  html += `<div class="stats-row"><span>Scaffolds</span><span>${m.scaffoldCount}${delta(summary?.scaffoldCountDelta ?? 0)}</span></div>`;
  html += `<div class="stats-row"><span>Operations</span><span>${m.operationCount}</span></div>`;

  detail.innerHTML = html;
}

/** Wire the click-to-expand behavior on the pinned status strip. Call once at boot. */
export function setupStatsPanel(): void {
  const toggle = document.getElementById('stats-summary-toggle');
  const detail = document.getElementById('stats-content');
  if (!toggle || !detail) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    detail.hidden = expanded;
  });
}
