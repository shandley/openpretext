/**
 * AnalysisPanel — 3D genomics analysis controls and track registration.
 *
 * Provides UI for computing insulation scores, contact decay curves,
 * and A/B compartment eigenvectors from the Hi-C contact map.
 * Computations run in a background Web Worker via AnalysisWorkerClient.
 * Results are displayed as overlay tracks via TrackRenderer.
 * Includes inline P(s) decay chart and export buttons.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import type { ContigRange } from '../curation/AutoSort';
import { insulationToTracks, type InsulationResult } from '../analysis/InsulationScore';
import {
  formatDecayStats,
  type ContactDecayResult,
} from '../analysis/ContactDecay';
import { compartmentToTrack, type CompartmentResult } from '../analysis/CompartmentAnalysis';
import { AnalysisWorkerClient } from '../analysis/AnalysisWorkerClient';
import {
  downloadInsulationBedGraph,
  downloadCompartmentBedGraph,
  downloadDecayTSV,
} from '../export/AnalysisExport';
import {
  detectMisassemblies,
  misassemblyToTrack,
  buildCutSuggestions,
  type CutSuggestion,
} from '../analysis/MisassemblyDetector';
import { misassemblyFlags } from '../curation/MisassemblyFlags';
import { cut } from '../curation/CurationEngine';
import { computeHealthScore, type HealthScoreResult } from '../analysis/HealthScore';

// ---------------------------------------------------------------------------
// Cached state
// ---------------------------------------------------------------------------

let cachedDecay: ContactDecayResult | null = null;
let baselineDecay: ContactDecayResult | null = null;
let cachedInsulation: InsulationResult | null = null;
let cachedCompartments: CompartmentResult | null = null;
let cachedSuggestions: CutSuggestion[] | null = null;
let insulationWindowSize = 10;
let workerClient: AnalysisWorkerClient | null = null;
let computing = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOverviewSize(): number {
  const s = state.get();
  if (!s.map?.contactMap) return 0;
  return Math.round(Math.sqrt(s.map.contactMap.length));
}

function buildContigRanges(): ContigRange[] {
  const s = state.get();
  if (!s.map?.contactMap) return [];
  const overviewSize = getOverviewSize();
  const ranges: ContigRange[] = [];
  let accumulated = 0;

  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];
    const len = contig.pixelEnd - contig.pixelStart;
    const start = Math.round((accumulated / s.map.textureSize) * overviewSize);
    accumulated += len;
    const end = Math.round((accumulated / s.map.textureSize) * overviewSize);
    ranges.push({ start, end, orderIndex: i });
  }

  return ranges;
}

function getClient(): AnalysisWorkerClient {
  if (!workerClient) {
    workerClient = new AnalysisWorkerClient();
  }
  return workerClient;
}

function setButtonsDisabled(disabled: boolean): void {
  const ids = [
    'btn-compute-insulation',
    'btn-compute-decay',
    'btn-compute-compartments',
    'btn-run-all-analysis',
  ];
  for (const id of ids) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = disabled;
  }
}

// ---------------------------------------------------------------------------
// Analysis runners (async, using worker)
// ---------------------------------------------------------------------------

async function runInsulation(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const result = await getClient().computeInsulation(
    s.map.contactMap,
    overviewSize,
    { windowSize: insulationWindowSize },
  );
  cachedInsulation = result;
  const { insulationTrack, boundaryTrack } = insulationToTracks(
    result,
    overviewSize,
    s.map.textureSize,
  );

  ctx.trackRenderer.addTrack(insulationTrack);
  ctx.trackRenderer.addTrack(boundaryTrack);
  ctx.tracksVisible = true;
  ctx.updateTrackConfigPanel();
  ctx.showToast(`Insulation: ${result.boundaries.length} TAD boundaries detected`);
  runMisassemblyDetection(ctx);
  updateResultsDisplay(ctx);
}

async function runDecay(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const ranges = buildContigRanges();
  cachedDecay = await getClient().computeContactDecay(
    s.map.contactMap,
    overviewSize,
    ranges,
  );
  ctx.showToast(`P(s) decay exponent: ${cachedDecay.decayExponent.toFixed(2)}`);
  updateResultsDisplay(ctx);
}

async function runCompartments(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const result = await getClient().computeCompartments(
    s.map.contactMap,
    overviewSize,
  );
  cachedCompartments = result;
  const track = compartmentToTrack(result, overviewSize, s.map.textureSize);

  ctx.trackRenderer.addTrack(track);
  ctx.tracksVisible = true;
  ctx.updateTrackConfigPanel();
  ctx.showToast(`Compartments: ${result.iterations} iterations, eigenvalue ${result.eigenvalue.toFixed(2)}`);
  runMisassemblyDetection(ctx);
  updateResultsDisplay(ctx);
}

// ---------------------------------------------------------------------------
// Misassembly detection
// ---------------------------------------------------------------------------

function runMisassemblyDetection(ctx: AppContext): void {
  if (!cachedInsulation || !cachedCompartments) return;
  const s = state.get();
  if (!s.map) return;

  const ranges = buildContigRanges();
  const overviewSize = getOverviewSize();
  const result = detectMisassemblies(cachedInsulation, cachedCompartments, ranges);
  misassemblyFlags.setFlags(result.flags);

  const track = misassemblyToTrack(result, overviewSize, s.map.textureSize);
  ctx.trackRenderer.addTrack(track);
  ctx.updateTrackConfigPanel();

  if (result.summary.total > 0) {
    ctx.showToast(`${result.summary.total} potential misassemblies detected`, 4000);
  }
}

// ---------------------------------------------------------------------------
// Cut suggestions
// ---------------------------------------------------------------------------

function showCutSuggestions(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) return;

  const ranges = buildContigRanges();
  const flags = misassemblyFlags.getAllFlags();
  if (flags.length === 0) return;

  cachedSuggestions = buildCutSuggestions(
    flags, ranges, s.map.contigs, s.contigOrder,
  );

  renderSuggestionCards(ctx);
}

function renderSuggestionCards(ctx: AppContext): void {
  const container = document.getElementById('cut-suggestions');
  if (!container || !cachedSuggestions || cachedSuggestions.length === 0) {
    if (container) container.innerHTML = '';
    return;
  }

  let html = '';
  for (let i = 0; i < cachedSuggestions.length; i++) {
    const s = cachedSuggestions[i];
    const reasonLabel =
      s.reason === 'both' ? 'TAD + compartment' :
      s.reason === 'tad_boundary' ? 'TAD boundary' : 'Compartment switch';
    html += `<div class="cut-suggestion-card" data-idx="${i}">
      <div class="cut-suggestion-info">
        <span class="cut-suggestion-name">${s.contigName}</span>
        <span class="cut-suggestion-detail">${reasonLabel} \u00b7 offset ${s.pixelOffset}px \u00b7 strength ${s.strength.toFixed(2)}</span>
      </div>
      <div class="cut-suggestion-actions">
        <button class="cut-accept-btn" data-idx="${i}" title="Accept cut">\u2713</button>
        <button class="cut-skip-btn" data-idx="${i}" title="Skip">\u2717</button>
      </div>
    </div>`;
  }

  if (cachedSuggestions.length > 1) {
    html += `<button class="cut-accept-all-btn" id="btn-accept-all-cuts">Accept All (${cachedSuggestions.length})</button>`;
  }

  container.innerHTML = html;

  // Wire accept buttons
  container.querySelectorAll('.cut-accept-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx ?? '-1', 10);
      if (idx >= 0 && cachedSuggestions && cachedSuggestions[idx]) {
        applySingleCut(ctx, cachedSuggestions[idx]);
      }
    });
  });

  // Wire skip buttons
  container.querySelectorAll('.cut-skip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx ?? '-1', 10);
      if (idx >= 0 && cachedSuggestions) {
        cachedSuggestions.splice(idx, 1);
        renderSuggestionCards(ctx);
      }
    });
  });

  // Wire accept all button
  document.getElementById('btn-accept-all-cuts')?.addEventListener('click', () => {
    if (cachedSuggestions && cachedSuggestions.length > 0) {
      applyAllCuts(ctx, [...cachedSuggestions]);
    }
  });
}

function applySingleCut(ctx: AppContext, suggestion: CutSuggestion): void {
  try {
    cut(suggestion.orderIndex, suggestion.pixelOffset);
    ctx.refreshAfterCuration();
    ctx.showToast(`Cut ${suggestion.contigName} at offset ${suggestion.pixelOffset}`);
  } catch (e) {
    ctx.showToast(`Cut failed: ${(e as Error).message}`, 4000);
  }

  // Indices are stale after a cut — clear all remaining suggestions
  cachedSuggestions = null;
  const container = document.getElementById('cut-suggestions');
  if (container) container.innerHTML = '';

  // Re-run detection with new contig layout
  runMisassemblyDetection(ctx);
  updateResultsDisplay(ctx);
}

function applyAllCuts(ctx: AppContext, suggestions: CutSuggestion[]): void {
  // Already sorted by orderIndex descending for right-to-left execution
  let applied = 0;
  for (const s of suggestions) {
    try {
      cut(s.orderIndex, s.pixelOffset);
      applied++;
    } catch {
      // Skip invalid cuts (can happen if contig was already modified)
    }
  }

  ctx.refreshAfterCuration();
  cachedSuggestions = null;
  const container = document.getElementById('cut-suggestions');
  if (container) container.innerHTML = '';

  if (applied > 0) {
    ctx.showToast(`Applied ${applied} cuts`);
    // Re-run detection with new contig layout
    runMisassemblyDetection(ctx);
  }
  updateResultsDisplay(ctx);
}

// ---------------------------------------------------------------------------
// P(s) decay chart (inline SVG)
// ---------------------------------------------------------------------------

function computeRegressionIntercept(
  xData: Float64Array, yData: Float64Array, slope: number,
): number {
  const n = xData.length;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xData[i]; sumY += yData[i]; }
  return sumY / n - slope * (sumX / n);
}

function renderDecayChart(
  result: ContactDecayResult,
  baseline?: ContactDecayResult | null,
): string {
  if (result.distances.length < 2) return '';

  const hasBaseline = baseline != null
    && baseline !== result
    && baseline.distances.length >= 2;

  const W = 240, H = 160;
  const m = { top: 8, right: 8, bottom: 28, left: 36 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const xData = result.logDistances;
  const yData = result.logContacts;
  const n = xData.length;

  // Compute bounds from current data
  let xMin = xData[0], xMax = xData[0];
  let yMin = yData[0], yMax = yData[0];
  for (let i = 1; i < n; i++) {
    if (xData[i] < xMin) xMin = xData[i];
    if (xData[i] > xMax) xMax = xData[i];
    if (yData[i] < yMin) yMin = yData[i];
    if (yData[i] > yMax) yMax = yData[i];
  }

  // Expand bounds to include baseline if present
  if (hasBaseline) {
    const bx = baseline.logDistances;
    const by = baseline.logContacts;
    for (let i = 0; i < bx.length; i++) {
      if (bx[i] < xMin) xMin = bx[i];
      if (bx[i] > xMax) xMax = bx[i];
      if (by[i] < yMin) yMin = by[i];
      if (by[i] > yMax) yMax = by[i];
    }
  }

  // Add small padding to avoid points on edges
  const xPad = (xMax - xMin) * 0.05 || 0.1;
  const yPad = (yMax - yMin) * 0.05 || 0.1;
  xMin -= xPad; xMax += xPad;
  yMin -= yPad; yMax += yPad;

  const sx = (v: number) => m.left + ((v - xMin) / (xMax - xMin)) * pw;
  const sy = (v: number) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

  // Build SVG
  let svg = `<div class="decay-chart"><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // Axes
  svg += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#a0a0b0" stroke-width="0.5"/>`;
  svg += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#a0a0b0" stroke-width="0.5"/>`;

  // X-axis ticks (3-4 nice values)
  const xTicks = niceTickValues(xMin, xMax, 4);
  for (const tick of xTicks) {
    const x = sx(tick);
    svg += `<line x1="${x}" y1="${m.top + ph}" x2="${x}" y2="${m.top + ph + 3}" stroke="#a0a0b0" stroke-width="0.5"/>`;
    svg += `<text x="${x}" y="${m.top + ph + 12}" text-anchor="middle" font-size="7" fill="#a0a0b0">${tick.toFixed(1)}</text>`;
  }

  // Y-axis ticks
  const yTicks = niceTickValues(yMin, yMax, 4);
  for (const tick of yTicks) {
    const y = sy(tick);
    svg += `<line x1="${m.left - 3}" y1="${y}" x2="${m.left}" y2="${y}" stroke="#a0a0b0" stroke-width="0.5"/>`;
    svg += `<text x="${m.left - 5}" y="${y + 2.5}" text-anchor="end" font-size="7" fill="#a0a0b0">${tick.toFixed(1)}</text>`;
  }

  // Axis labels
  svg += `<text x="${m.left + pw / 2}" y="${H - 2}" text-anchor="middle" font-size="8" fill="#a0a0b0">log\u2081\u2080(distance)</text>`;
  svg += `<text x="8" y="${m.top + ph / 2}" text-anchor="middle" font-size="8" fill="#a0a0b0" transform="rotate(-90, 8, ${m.top + ph / 2})">log\u2081\u2080(P(s))</text>`;

  // Baseline layer (behind current)
  if (hasBaseline) {
    const bx = baseline.logDistances;
    const by = baseline.logContacts;
    const bn = bx.length;

    // Baseline fit line (gray dashed)
    const bIntercept = computeRegressionIntercept(bx, by, baseline.decayExponent);
    const bLineY0 = baseline.decayExponent * bx[0] + bIntercept;
    const bLineYn = baseline.decayExponent * bx[bn - 1] + bIntercept;
    svg += `<line x1="${sx(bx[0])}" y1="${sy(bLineY0)}" x2="${sx(bx[bn - 1])}" y2="${sy(bLineYn)}" stroke="#888" stroke-width="1" stroke-dasharray="3,3"/>`;

    // Baseline data points (gray)
    for (let i = 0; i < bn; i++) {
      svg += `<circle cx="${sx(bx[i])}" cy="${sy(by[i])}" r="1.5" fill="#888" opacity="0.3"/>`;
    }
  }

  // Current fit line (white dashed)
  const intercept = computeRegressionIntercept(xData, yData, result.decayExponent);
  const lineY0 = result.decayExponent * xData[0] + intercept;
  const lineYn = result.decayExponent * xData[n - 1] + intercept;
  svg += `<line x1="${sx(xData[0])}" y1="${sy(lineY0)}" x2="${sx(xData[n - 1])}" y2="${sy(lineYn)}" stroke="#e8e8e8" stroke-width="1.5" stroke-dasharray="4,3"/>`;

  // Current data points (red)
  for (let i = 0; i < n; i++) {
    svg += `<circle cx="${sx(xData[i])}" cy="${sy(yData[i])}" r="1.5" fill="#e94560" opacity="0.6"/>`;
  }

  svg += '</svg>';

  // Legend (only when baseline is shown)
  if (hasBaseline) {
    svg += '<div class="decay-chart-legend">';
    svg += '<span><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#888" opacity="0.5"/></svg> Initial</span>';
    svg += '<span><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#e94560"/></svg> Current</span>';
    svg += '</div>';

    // Delta exponent
    const delta = result.decayExponent - baseline.decayExponent;
    const sign = delta >= 0 ? '+' : '';
    svg += `<div style="text-align:center;font-size:9px;color:var(--text-secondary);margin-top:2px;">`;
    svg += `Exponent: ${baseline.decayExponent.toFixed(2)} \u2192 ${result.decayExponent.toFixed(2)} (\u0394 ${sign}${delta.toFixed(2)})`;
    svg += '</div>';
  }

  svg += '</div>';
  return svg;
}

function niceTickValues(min: number, max: number, count: number): number[] {
  const range = max - min;
  const rawStep = range / count;
  // Round step to nearest 0.5 or 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step: number;
  const normalized = rawStep / magnitude;
  if (normalized <= 1.5) step = magnitude;
  else if (normalized <= 3.5) step = 2 * magnitude;
  else if (normalized <= 7.5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max; v += step) {
    ticks.push(v);
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Results display
// ---------------------------------------------------------------------------

function buildHealthScore(ctx: AppContext): HealthScoreResult | null {
  const metrics = ctx.metricsTracker.getLatest?.();
  if (!metrics) return null;
  if (!cachedDecay && !cachedInsulation && !cachedCompartments) return null;

  return computeHealthScore({
    n50: metrics.n50,
    totalLength: metrics.totalLength,
    contigCount: metrics.contigCount,
    decayExponent: cachedDecay?.decayExponent ?? null,
    decayRSquared: cachedDecay?.rSquared ?? null,
    misassemblyCount: misassemblyFlags.getFlaggedCount(),
    eigenvalue: cachedCompartments?.eigenvalue ?? null,
  });
}

function renderHealthScoreCard(score: HealthScoreResult): string {
  const color = score.overall >= 70 ? '#4caf50' :
    score.overall >= 40 ? '#f39c12' : '#e94560';
  const c = score.components;
  return `<div class="health-score-card">
    <div class="health-score-value" style="color:${color}">${score.overall}</div>
    <div class="health-score-label">Health Score</div>
    <div class="health-score-breakdown">
      <span title="Contiguity (N50)">N50: ${Math.round(c.contiguity)}</span>
      <span title="P(s) decay quality">P(s): ${Math.round(c.decayQuality)}</span>
      <span title="Assembly integrity">Int: ${Math.round(c.integrity)}</span>
      <span title="A/B compartments">A/B: ${Math.round(c.compartments)}</span>
    </div>
  </div>`;
}

function updateResultsDisplay(ctx: AppContext): void {
  const el = document.getElementById('analysis-results');
  if (!el) return;

  let html = '';

  // Health score card (top of results)
  const healthScore = buildHealthScore(ctx);
  if (healthScore) {
    html += renderHealthScoreCard(healthScore);
  }

  if (cachedDecay) {
    html += formatDecayStats(cachedDecay);
    html += renderDecayChart(cachedDecay, baselineDecay);
  }

  // Misassembly summary + suggest cuts
  const flagCount = misassemblyFlags.getFlaggedCount();
  if (flagCount > 0) {
    html += `<div class="stats-row"><span>Misassemblies</span><span style="color:#e67e22;">${flagCount} contigs</span></div>`;
    const allFlags = misassemblyFlags.getAllFlags();
    html += `<button class="analysis-btn" id="btn-suggest-cuts" style="background:#e67e22;color:#fff;width:100%;margin:4px 0;">Suggest Cuts (${allFlags.length})</button>`;
    html += '<div id="cut-suggestions"></div>';
  }

  // Export buttons (only if at least one result exists)
  if (cachedInsulation || cachedDecay || cachedCompartments) {
    html += '<div class="analysis-export-buttons">';
    if (cachedInsulation) {
      html += '<button class="analysis-btn" id="btn-export-insulation">Export Insulation</button>';
    }
    if (cachedDecay) {
      html += '<button class="analysis-btn" id="btn-export-decay">Export P(s)</button>';
    }
    if (cachedCompartments) {
      html += '<button class="analysis-btn" id="btn-export-compartments">Export Compartments</button>';
    }
    html += '</div>';
  }

  el.innerHTML = html || '<div style="color: var(--text-secondary); font-size: 11px;">Click a button above to compute.</div>';

  // Wire export buttons
  const overviewSize = getOverviewSize();
  const s = state.get();

  document.getElementById('btn-export-insulation')?.addEventListener('click', () => {
    if (cachedInsulation) {
      downloadInsulationBedGraph(cachedInsulation, s, overviewSize);
      ctx.showToast('Insulation BedGraph exported');
    }
  });
  document.getElementById('btn-export-decay')?.addEventListener('click', () => {
    if (cachedDecay) {
      downloadDecayTSV(cachedDecay);
      ctx.showToast('P(s) decay TSV exported');
    }
  });
  document.getElementById('btn-export-compartments')?.addEventListener('click', () => {
    if (cachedCompartments) {
      downloadCompartmentBedGraph(cachedCompartments, s, overviewSize);
      ctx.showToast('Compartment BedGraph exported');
    }
  });

  // Wire suggest cuts button
  document.getElementById('btn-suggest-cuts')?.addEventListener('click', () => {
    showCutSuggestions(ctx);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current health score, or null if no analysis has been computed.
 */
export function getHealthScore(ctx: AppContext): HealthScoreResult | null {
  return buildHealthScore(ctx);
}

/**
 * Initialize the Analysis panel UI inside #analysis-content.
 */
export function setupAnalysisPanel(ctx: AppContext): void {
  const container = document.getElementById('analysis-content');
  if (!container) return;

  // Worker client is lazily initialized on first use.
  // The "No data loaded" placeholder is replaced by runAllAnalyses on file:loaded.
}

/**
 * Run all analyses on the current contact map and register tracks.
 * Computations run in a background Web Worker.
 */
export async function runAllAnalyses(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const container = document.getElementById('analysis-content');
  if (!container) return;

  // Build the controls UI
  container.innerHTML = `
    <div class="analysis-slider">
      <label>Window</label>
      <input type="range" id="insulation-window" min="3" max="50" value="${insulationWindowSize}">
      <span class="slider-val" id="insulation-window-val">${insulationWindowSize}</span>
    </div>
    <div class="analysis-buttons">
      <button class="analysis-btn" id="btn-compute-insulation">Insulation</button>
      <button class="analysis-btn" id="btn-compute-decay">P(s) Curve</button>
      <button class="analysis-btn" id="btn-compute-compartments">Compartments</button>
    </div>
    <button class="analysis-btn" id="btn-run-all-analysis" style="margin-bottom:6px;width:100%;">Compute All</button>
    <div id="analysis-results">
      <div style="color: var(--text-secondary); font-size: 11px;">Computing...</div>
    </div>
  `;

  // Wire slider
  const slider = document.getElementById('insulation-window') as HTMLInputElement;
  const sliderVal = document.getElementById('insulation-window-val')!;
  slider?.addEventListener('input', () => {
    insulationWindowSize = parseInt(slider.value, 10);
    sliderVal.textContent = String(insulationWindowSize);
  });

  // Wire individual buttons
  document.getElementById('btn-compute-insulation')?.addEventListener('click', () => {
    if (!computing) {
      computing = true;
      setButtonsDisabled(true);
      runInsulation(ctx).finally(() => {
        computing = false;
        setButtonsDisabled(false);
      });
    }
  });
  document.getElementById('btn-compute-decay')?.addEventListener('click', () => {
    if (!computing) {
      computing = true;
      setButtonsDisabled(true);
      runDecay(ctx).finally(() => {
        computing = false;
        setButtonsDisabled(false);
      });
    }
  });
  document.getElementById('btn-compute-compartments')?.addEventListener('click', () => {
    if (!computing) {
      computing = true;
      setButtonsDisabled(true);
      runCompartments(ctx).finally(() => {
        computing = false;
        setButtonsDisabled(false);
      });
    }
  });
  document.getElementById('btn-run-all-analysis')?.addEventListener('click', () => {
    if (!computing) {
      computing = true;
      setButtonsDisabled(true);
      Promise.all([
        runInsulation(ctx),
        runDecay(ctx),
        runCompartments(ctx),
      ]).finally(() => {
        computing = false;
        setButtonsDisabled(false);
      });
    }
  });

  // Auto-compute all analyses (async, in worker)
  computing = true;
  setButtonsDisabled(true);
  await Promise.all([
    runInsulation(ctx),
    runDecay(ctx),
    runCompartments(ctx),
  ]).finally(() => {
    computing = false;
    setButtonsDisabled(false);
    runMisassemblyDetection(ctx);
    // Capture baseline P(s) on initial computation
    if (cachedDecay && !baselineDecay) {
      baselineDecay = cachedDecay;
    }
    updateResultsDisplay(ctx);
  });
}

/**
 * Clear all analysis tracks and cached results.
 */
export function clearAnalysisTracks(ctx: AppContext): void {
  cachedDecay = null;
  baselineDecay = null;
  cachedInsulation = null;
  cachedCompartments = null;
  cachedSuggestions = null;
  misassemblyFlags.clearAll();
  ctx.trackRenderer.removeTrack('Insulation Score');
  ctx.trackRenderer.removeTrack('TAD Boundaries');
  ctx.trackRenderer.removeTrack('A/B Compartments');
  ctx.trackRenderer.removeTrack('Misassembly Flags');
  ctx.updateTrackConfigPanel();
}
