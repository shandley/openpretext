/**
 * StatsPanel — assembly quality metrics display.
 */

import type { AppContext } from './AppContext';
import { contigExclusion } from '../curation/ContigExclusion';
import { getHealthScore } from './AnalysisPanel';

export function updateStatsPanel(ctx: AppContext): void {
  const el = document.getElementById('stats-content');
  if (!el) return;

  const summary = ctx.metricsTracker.getSummary();
  if (!summary) {
    el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No data loaded</div>';
    return;
  }

  const m = summary.current;
  const excluded = contigExclusion.getExcludedCount();

  const fmtBp = (bp: number) => {
    if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(2)} Gb`;
    if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
    if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
    return `${bp} bp`;
  };

  const delta = (val: number) => {
    if (val === 0) return '';
    const sign = val > 0 ? '+' : '';
    return ` <span style="color:${val > 0 ? '#4caf50' : '#e94560'};font-size:10px;">(${sign}${val})</span>`;
  };

  let html = '';

  // Health score summary row
  const healthScore = getHealthScore(ctx);
  if (healthScore) {
    const color = healthScore.overall >= 70 ? '#4caf50' :
      healthScore.overall >= 40 ? '#f39c12' : '#e94560';
    html += `<div class="stats-row"><span>Health Score</span><span style="color:${color};font-weight:600;">${healthScore.overall}</span></div>`;
  }

  html += `<div class="stats-row"><span>Contigs</span><span>${m.contigCount}${delta(summary.contigCountDelta)}</span></div>`;
  if (excluded > 0) {
    html += `<div class="stats-row"><span>Excluded</span><span style="color:#f39c12;">${excluded}</span></div>`;
  }
  html += `<div class="stats-row"><span>Total length</span><span>${fmtBp(m.totalLength)}</span></div>`;
  html += `<div class="stats-row"><span>N50</span><span>${fmtBp(m.n50)}${delta(summary.n50Delta)}</span></div>`;
  html += `<div class="stats-row"><span>L50</span><span>${m.l50}</span></div>`;
  html += `<div class="stats-row"><span>N90</span><span>${fmtBp(m.n90)}</span></div>`;
  html += `<div class="stats-row"><span>L90</span><span>${m.l90}</span></div>`;
  html += `<div class="stats-row"><span>Longest</span><span>${fmtBp(m.longestContig)}</span></div>`;
  html += `<div class="stats-row"><span>Shortest</span><span>${fmtBp(m.shortestContig)}</span></div>`;
  html += `<div class="stats-row"><span>Median</span><span>${fmtBp(m.medianLength)}</span></div>`;
  html += `<div class="stats-row"><span>Scaffolds</span><span>${m.scaffoldCount}${delta(summary.scaffoldCountDelta)}</span></div>`;
  html += `<div class="stats-row"><span>Operations</span><span>${m.operationCount}</span></div>`;

  el.innerHTML = html;
}
