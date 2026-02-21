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
  computeDecayByScaffold,
  type ContactDecayResult,
  type ScaffoldDecayResult,
  type ScaffoldGroup,
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
  scoreCutConfidence,
  type CutSuggestion,
} from '../analysis/MisassemblyDetector';
import { misassemblyFlags } from '../curation/MisassemblyFlags';
import { cut } from '../curation/CurationEngine';
import { computeHealthScore, type HealthScoreResult } from '../analysis/HealthScore';
import type {
  SessionAnalysisData,
  SessionDecay,
  SessionScaffoldDecay,
} from '../io/SessionManager';
import { openCutReview } from './CutReviewPanel';
import { autoAssignScaffolds } from './Sidebar';
import { computeProgress, computeTrend } from '../analysis/CurationProgress';
import type { DetectedPattern } from '../analysis/PatternDetector';

// ---------------------------------------------------------------------------
// Cached state
// ---------------------------------------------------------------------------

let cachedDecay: ContactDecayResult | null = null;
let baselineDecay: ContactDecayResult | null = null;
let cachedInsulation: InsulationResult | null = null;
let cachedCompartments: CompartmentResult | null = null;
let cachedSuggestions: CutSuggestion[] | null = null;
let cachedScaffoldDecay: ScaffoldDecayResult[] | null = null;
let cachedPatterns: DetectedPattern[] | null = null;
let insulationWindowSize = 10;
let workerClient: AnalysisWorkerClient | null = null;
let computing = false;
let autoRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRecompute = false;
let autoRecomputing = false;
const AUTO_RECOMPUTE_DELAY_MS = 1000;
const healthScoreHistory: number[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getOverviewSize(): number {
  const s = state.get();
  if (!s.map?.contactMap) return 0;
  return Math.round(Math.sqrt(s.map.contactMap.length));
}

export function buildContigRanges(): ContigRange[] {
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

function buildScaffoldGroups(ctx: AppContext): ScaffoldGroup[] {
  const s = state.get();
  if (!s.map) return [];

  const scaffolds = ctx.scaffoldManager.getAllScaffolds();
  if (scaffolds.length === 0) return [];

  // Group contigs by scaffoldId
  const groups: ScaffoldGroup[] = [];
  const unscaffolded: number[] = [];

  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];
    if (contig.scaffoldId === null) {
      unscaffolded.push(i);
    }
  }

  for (const scaffold of scaffolds) {
    const orderIndices: number[] = [];
    for (let i = 0; i < s.contigOrder.length; i++) {
      const contigId = s.contigOrder[i];
      if (s.map.contigs[contigId].scaffoldId === scaffold.id) {
        orderIndices.push(i);
      }
    }
    if (orderIndices.length > 0) {
      groups.push({
        scaffoldId: scaffold.id,
        name: scaffold.name,
        color: scaffold.color,
        orderIndices,
      });
    }
  }

  // Add unscaffolded group if there are both scaffolded and unscaffolded contigs
  if (unscaffolded.length > 0 && groups.length > 0) {
    groups.push({
      scaffoldId: -1,
      name: 'Unscaffolded',
      color: '#888888',
      orderIndices: unscaffolded,
    });
  }

  return groups;
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
    'btn-detect-patterns',
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

  // Compute per-scaffold decay if scaffolds are assigned
  const scaffoldGroups = buildScaffoldGroups(ctx);
  if (scaffoldGroups.length >= 2) {
    cachedScaffoldDecay = computeDecayByScaffold(
      s.map.contactMap, overviewSize, ranges, scaffoldGroups,
    );
  } else {
    cachedScaffoldDecay = null;
  }

  ctx.showToast(`P(s) decay exponent: ${cachedDecay.decayExponent.toFixed(2)}`);
  updateResultsDisplay(ctx);
}

/**
 * Recompute per-scaffold P(s) decay from already-cached genome-wide decay.
 * Called after scaffold assignment changes (e.g. auto-assign) to refresh
 * the scaffold decay table without re-running the full decay computation.
 */
export function recomputeScaffoldDecay(ctx: AppContext): void {
  if (!cachedDecay) return;

  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const ranges = buildContigRanges();
  const scaffoldGroups = buildScaffoldGroups(ctx);

  if (scaffoldGroups.length >= 2) {
    cachedScaffoldDecay = computeDecayByScaffold(
      s.map.contactMap, overviewSize, ranges, scaffoldGroups,
    );
  } else {
    cachedScaffoldDecay = null;
  }

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

export function runMisassemblyDetection(ctx: AppContext): void {
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

  // Compute composite confidence scores
  scoreCutConfidence(
    cachedSuggestions,
    flags,
    cachedInsulation?.normalizedScores ?? null,
    cachedCompartments?.eigenvector ?? null,
    cachedInsulation?.normalizedScores ?? null,  // reuse insulation as decay proxy
    ranges,
  );

  // Sort by confidence (highest first) instead of orderIndex
  cachedSuggestions.sort((a, b) => (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0));

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
    const conf = s.confidence;
    const badgeColor = conf?.level === 'high' ? '#4caf50' :
      conf?.level === 'medium' ? '#f39c12' : '#e94560';
    const badgeLabel = conf ? `${Math.round(conf.score * 100)}%` : '';
    const badgeTitle = conf
      ? `Confidence: ${Math.round(conf.score * 100)}% (TAD: ${Math.round(conf.components.tad * 100)}%, Comp: ${Math.round(conf.components.compartment * 100)}%, Decay: ${Math.round(conf.components.decay * 100)}%)`
      : '';
    html += `<div class="cut-suggestion-card" data-idx="${i}">
      <div class="cut-suggestion-info">
        <span class="cut-suggestion-name">${s.contigName}</span>
        <span class="cut-suggestion-detail">${reasonLabel} \u00b7 offset ${s.pixelOffset}px${conf ? ` \u00b7 <span class="confidence-badge" style="background:${badgeColor}" title="${badgeTitle}">${badgeLabel}</span>` : ''}</span>
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
  scaffolds?: ScaffoldDecayResult[] | null,
): string {
  if (result.distances.length < 2) return '';

  const hasBaseline = baseline != null
    && baseline !== result
    && baseline.distances.length >= 2;
  const hasScaffolds = scaffolds != null && scaffolds.length > 0;

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

  // Expand bounds to include scaffold data
  if (hasScaffolds) {
    for (const sr of scaffolds) {
      const dx = sr.decay.logDistances;
      const dy = sr.decay.logContacts;
      for (let i = 0; i < dx.length; i++) {
        if (dx[i] < xMin) xMin = dx[i];
        if (dx[i] > xMax) xMax = dx[i];
        if (dy[i] < yMin) yMin = dy[i];
        if (dy[i] > yMax) yMax = dy[i];
      }
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

  // Per-scaffold curves (behind genome-wide)
  if (hasScaffolds) {
    for (const sr of scaffolds) {
      const d = sr.decay;
      if (d.logDistances.length < 2) continue;
      const sn = d.logDistances.length;

      // Scaffold fit line (colored, thin dashed)
      const sIntercept = computeRegressionIntercept(d.logDistances, d.logContacts, d.decayExponent);
      const sLineY0 = d.decayExponent * d.logDistances[0] + sIntercept;
      const sLineYn = d.decayExponent * d.logDistances[sn - 1] + sIntercept;
      svg += `<line x1="${sx(d.logDistances[0])}" y1="${sy(sLineY0)}" x2="${sx(d.logDistances[sn - 1])}" y2="${sy(sLineYn)}" stroke="${sr.color}" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.6"/>`;

      // Scaffold data points (colored, small)
      for (let i = 0; i < sn; i++) {
        svg += `<circle cx="${sx(d.logDistances[i])}" cy="${sy(d.logContacts[i])}" r="1" fill="${sr.color}" opacity="0.5"/>`;
      }
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

  // Legend
  if (hasBaseline || hasScaffolds) {
    svg += '<div class="decay-chart-legend">';
    if (hasBaseline) {
      svg += '<span><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#888" opacity="0.5"/></svg> Initial</span>';
    }
    svg += '<span><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#e94560"/></svg> Genome</span>';
    if (hasScaffolds) {
      for (const sr of scaffolds) {
        svg += `<span><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="${sr.color}"/></svg> ${sr.scaffoldName}</span>`;
      }
    }
    svg += '</div>';

    // Delta exponent (only when baseline exists)
    if (hasBaseline) {
      const delta = result.decayExponent - baseline.decayExponent;
      const sign = delta >= 0 ? '+' : '';
      svg += `<div style="text-align:center;font-size:9px;color:var(--text-secondary);margin-top:2px;">`;
      svg += `Exponent: ${baseline.decayExponent.toFixed(2)} \u2192 ${result.decayExponent.toFixed(2)} (\u0394 ${sign}${delta.toFixed(2)})`;
      svg += '</div>';
    }
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

function renderSparkline(values: number[]): string {
  if (values.length < 2) return '';
  const w = 80, h = 24, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1];
  const color = last >= 70 ? '#4caf50' : last >= 40 ? '#f39c12' : '#e94560';
  return `<svg class="health-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function renderHealthScoreCard(score: HealthScoreResult): string {
  // Track score in history
  healthScoreHistory.push(score.overall);
  const color = score.overall >= 70 ? '#4caf50' :
    score.overall >= 40 ? '#f39c12' : '#e94560';
  const c = score.components;
  const sparkline = renderSparkline(healthScoreHistory);
  return `<div class="health-score-card">
    <div class="health-score-value" style="color:${color}">${score.overall}</div>
    <div class="health-score-label">Health Score</div>
    ${sparkline}
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

  // Recomputing indicator (hidden by default, shown during auto-recompute)
  html += '<div id="analysis-recomputing" class="analysis-recomputing" style="display:none;"><span class="recomputing-dot"></span> Updating analysis...</div>';

  // Health score card (top of results)
  const healthScore = buildHealthScore(ctx);
  if (healthScore) {
    html += renderHealthScoreCard(healthScore);
  }

  if (cachedDecay) {
    html += formatDecayStats(cachedDecay);

    // Baseline comparison stats (when baseline differs from current)
    const hasBaseline = baselineDecay != null && baselineDecay !== cachedDecay;
    if (hasBaseline) {
      const delta = cachedDecay.decayExponent - baselineDecay!.decayExponent;
      const sign = delta >= 0 ? '+' : '';
      const deltaColor = Math.abs(delta) < 0.05 ? '#4caf50' : '#f39c12';
      html += `<div class="stats-row"><span>Baseline exponent</span><span style="color:var(--text-secondary)">${baselineDecay!.decayExponent.toFixed(2)}</span></div>`;
      html += `<div class="stats-row"><span>\u0394 exponent</span><span style="color:${deltaColor}">${sign}${delta.toFixed(2)}</span></div>`;
    }

    html += renderDecayChart(cachedDecay, baselineDecay, cachedScaffoldDecay);

    // Baseline control buttons
    html += '<div class="baseline-controls">';
    if (hasBaseline) {
      html += '<button class="analysis-btn" id="btn-reset-baseline">Clear Baseline</button>';
    }
    html += '<button class="analysis-btn" id="btn-snapshot-baseline">Snapshot Baseline</button>';
    html += '</div>';

    // Per-scaffold exponent table
    if (cachedScaffoldDecay && cachedScaffoldDecay.length > 0) {
      html += '<div class="scaffold-decay-table">';
      for (const sr of cachedScaffoldDecay) {
        const exp = sr.decay.decayExponent;
        const r2 = sr.decay.rSquared;
        const inRange = exp <= -0.8 && exp >= -1.5;
        const expColor = inRange ? '#4caf50' : '#f39c12';
        html += `<div class="scaffold-decay-row">`;
        html += `<span style="color:${sr.color}">${sr.scaffoldName} (${sr.contigCount})</span>`;
        html += `<span style="color:${expColor}">${exp.toFixed(2)} <span style="color:var(--text-secondary);font-size:9px;">R\u00B2=${r2.toFixed(2)}</span></span>`;
        html += '</div>';
      }
      html += '</div>';
    }
  }

  // Auto-assign scaffolds button (when P(s) computed but no scaffolds)
  if (cachedDecay && ctx.scaffoldManager.getAllScaffolds().length === 0) {
    html += `<button class="analysis-btn" id="btn-auto-scaffold-analysis" style="width:100%;margin:4px 0;">Auto-assign Scaffolds</button>`;
  }

  // Misassembly summary + suggest cuts
  const flagCount = misassemblyFlags.getFlaggedCount();
  if (flagCount > 0) {
    html += `<div class="stats-row"><span>Misassemblies</span><span style="color:#e67e22;">${flagCount} contigs</span></div>`;
    const allFlags = misassemblyFlags.getAllFlags();
    html += `<button class="analysis-btn" id="btn-suggest-cuts" style="background:#e67e22;color:#fff;width:100%;margin:4px 0;">Suggest Cuts (${allFlags.length})</button>`;
    html += `<button class="analysis-btn" id="btn-review-cuts" style="background:#2980b9;color:#fff;width:100%;margin:2px 0;">Review Cuts (${allFlags.length})</button>`;
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

  // Restore recomputing indicator if auto-recompute is in progress
  if (autoRecomputing) showRecomputingIndicator(true);

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

  // Wire review cuts button
  document.getElementById('btn-review-cuts')?.addEventListener('click', () => {
    openCutReview(ctx);
  });

  // Wire auto-assign scaffolds button
  document.getElementById('btn-auto-scaffold-analysis')?.addEventListener('click', () => {
    autoAssignScaffolds(ctx);
  });

  // Wire baseline control buttons
  document.getElementById('btn-reset-baseline')?.addEventListener('click', () => {
    baselineDecay = null;
    updateResultsDisplay(ctx);
    ctx.showToast('Baseline cleared');
  });
  document.getElementById('btn-snapshot-baseline')?.addEventListener('click', () => {
    if (cachedDecay) {
      baselineDecay = cachedDecay;
      updateResultsDisplay(ctx);
      ctx.showToast('Current P(s) saved as baseline');
    }
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

/** Save the current P(s) decay as the comparison baseline. */
export function snapshotBaseline(): void {
  if (cachedDecay) baselineDecay = cachedDecay;
}

/** Clear the comparison baseline. */
export function resetBaseline(): void {
  baselineDecay = null;
}

/** Get the current baseline decay result (for testing). */
export function getBaselineDecay(): ContactDecayResult | null {
  return baselineDecay;
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

async function runPatternDetection(ctx: AppContext): Promise<void> {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const ranges = buildContigRanges();

  cachedPatterns = await getClient().detectPatterns(
    s.map.contactMap,
    overviewSize,
    ranges,
  );

  const inv = cachedPatterns.filter(p => p.type === 'inversion').length;
  const trans = cachedPatterns.filter(p => p.type === 'translocation').length;
  ctx.showToast(`Patterns: ${inv} inversions, ${trans} translocations`);

  renderPatternCards(ctx);
}

function renderPatternCards(ctx: AppContext): void {
  const container = document.getElementById('pattern-results');
  if (!container) return;

  if (!cachedPatterns || cachedPatterns.length === 0) {
    container.innerHTML = cachedPatterns
      ? '<div style="color: var(--text-secondary); font-size: 11px; padding: 4px 0;">No patterns detected</div>'
      : '';
    return;
  }

  const s = state.get();
  const overviewSize = getOverviewSize();

  let html = '';
  for (let i = 0; i < cachedPatterns.length; i++) {
    const p = cachedPatterns[i];
    const icon = p.type === 'inversion' ? '\u{1F504}' : '\u2197\uFE0F';
    const strengthPct = Math.round(p.strength * 100);
    const strengthColor = strengthPct >= 70 ? '#4caf50' : strengthPct >= 40 ? '#f39c12' : '#e94560';
    html += `<div class="pattern-card" data-pattern-idx="${i}">
      <span class="pattern-icon">${icon}</span>
      <div class="pattern-info">
        <span class="pattern-desc">${p.description}</span>
        <span class="pattern-strength" style="color:${strengthColor}">${strengthPct}%</span>
      </div>
      <button class="pattern-nav-btn" data-pattern-idx="${i}">Go</button>
    </div>`;
  }
  container.innerHTML = html;

  // Wire navigation buttons
  container.querySelectorAll('.pattern-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.patternIdx ?? '-1', 10);
      if (idx < 0 || !cachedPatterns || !cachedPatterns[idx]) return;
      const p = cachedPatterns[idx];
      if (!s.map) return;

      // Navigate camera to the pattern region
      const midBin = (p.region.startBin + p.region.endBin) / 2;
      const normPos = midBin / overviewSize;
      const span = (p.region.endBin - p.region.startBin) / overviewSize;
      const zoom = Math.min(10, 0.5 / Math.max(span, 0.01));
      ctx.camera.animateTo({ x: normPos, y: normPos, zoom }, 300);
    });
  });
}

// ---------------------------------------------------------------------------
// Curation progress panel
// ---------------------------------------------------------------------------

/**
 * Update the curation progress sidebar section.
 * Shows kendall tau, longest correct run, and trend indicators.
 */
export function updateProgressPanel(ctx: AppContext): void {
  const el = document.getElementById('progress-content');
  const section = document.getElementById('progress-section');
  if (!el || !section) return;

  const s = state.get();
  if (!s.map || !ctx.progressReference) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const score = computeProgress(s.contigOrder, ctx.progressReference, s.undoStack.length);
  const trend = computeTrend(score, ctx.previousProgress);
  ctx.previousProgress = score;

  // Map tau from [-1,1] to [0,100]%
  const tauPct = Math.round(((score.kendallTau + 1) / 2) * 100);
  const tauColor = tauPct >= 70 ? '#4caf50' : tauPct >= 40 ? '#f39c12' : '#e94560';

  // Trend arrow
  let trendIcon: string;
  let trendColor: string;
  if (trend.tauDelta > 0.001) {
    trendIcon = '\u25B2'; trendColor = '#4caf50';
  } else if (trend.tauDelta < -0.001) {
    trendIcon = '\u25BC'; trendColor = '#e94560';
  } else {
    trendIcon = '\u2014'; trendColor = 'var(--text-secondary)';
  }

  el.innerHTML = `
    <div class="progress-tau-row">
      <span>Ordering</span>
      <span style="color:${tauColor};font-weight:600;">${tauPct}%
        <span class="progress-trend" style="color:${trendColor}">${trendIcon}</span>
      </span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar-fill" style="width:${tauPct}%;background:${tauColor}"></div>
    </div>
    <div class="progress-detail-row">
      <span>Longest run</span>
      <span>${score.longestRun}/${score.totalContigs} (${Math.round(score.longestRunPct)}%)</span>
    </div>
    <div class="progress-detail-row">
      <span>Operations</span>
      <span>${score.operationCount}</span>
    </div>
    <button class="analysis-btn progress-set-ref-btn" id="btn-set-progress-ref">Set Reference</button>
  `;

  document.getElementById('btn-set-progress-ref')?.addEventListener('click', () => {
    ctx.progressReference = [...s.contigOrder];
    ctx.previousProgress = null;
    updateProgressPanel(ctx);
    ctx.showToast('Progress reference updated to current order');
  });
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function decayToSession(result: ContactDecayResult): SessionDecay {
  return {
    distances: Array.from(result.distances),
    meanContacts: Array.from(result.meanContacts),
    logDistances: Array.from(result.logDistances),
    logContacts: Array.from(result.logContacts),
    decayExponent: result.decayExponent,
    rSquared: result.rSquared,
    maxDistance: result.maxDistance,
  };
}

function sessionToDecay(s: SessionDecay): ContactDecayResult {
  return {
    distances: Float64Array.from(s.distances),
    meanContacts: Float64Array.from(s.meanContacts),
    logDistances: Float64Array.from(s.logDistances),
    logContacts: Float64Array.from(s.logContacts),
    decayExponent: s.decayExponent,
    rSquared: s.rSquared,
    maxDistance: s.maxDistance,
  };
}

/**
 * Export the current analysis state for session persistence.
 * Returns null if no analysis has been computed.
 */
export function exportAnalysisState(): SessionAnalysisData | null {
  if (!cachedInsulation && !cachedDecay && !cachedCompartments) return null;

  const data: SessionAnalysisData = {
    insulationWindowSize,
  };

  if (cachedInsulation) {
    data.insulation = {
      rawScores: Array.from(cachedInsulation.rawScores),
      normalizedScores: Array.from(cachedInsulation.normalizedScores),
      boundaries: [...cachedInsulation.boundaries],
      boundaryStrengths: [...cachedInsulation.boundaryStrengths],
    };
  }

  if (cachedDecay) {
    data.decay = decayToSession(cachedDecay);
  }

  if (baselineDecay) {
    data.baselineDecay = decayToSession(baselineDecay);
  }

  if (cachedCompartments) {
    data.compartments = {
      eigenvector: Array.from(cachedCompartments.eigenvector),
      normalizedEigenvector: Array.from(cachedCompartments.normalizedEigenvector),
      iterations: cachedCompartments.iterations,
      eigenvalue: cachedCompartments.eigenvalue,
    };
  }

  if (cachedScaffoldDecay && cachedScaffoldDecay.length > 0) {
    data.scaffoldDecay = cachedScaffoldDecay.map(sr => ({
      scaffoldId: sr.scaffoldId,
      scaffoldName: sr.scaffoldName,
      color: sr.color,
      decay: decayToSession(sr.decay),
      contigCount: sr.contigCount,
    }));
  }

  return data;
}

/**
 * Restore analysis state from a session, re-registering tracks and running
 * misassembly detection from the restored data.
 */
export function restoreAnalysisState(ctx: AppContext, data: SessionAnalysisData): void {
  const s = state.get();
  if (!s.map) return;

  insulationWindowSize = data.insulationWindowSize;
  const overviewSize = getOverviewSize();

  if (data.insulation) {
    cachedInsulation = {
      rawScores: Float64Array.from(data.insulation.rawScores),
      normalizedScores: Float32Array.from(data.insulation.normalizedScores),
      boundaries: [...data.insulation.boundaries],
      boundaryStrengths: [...data.insulation.boundaryStrengths],
    };
    const { insulationTrack, boundaryTrack } = insulationToTracks(
      cachedInsulation, overviewSize, s.map.textureSize,
    );
    ctx.trackRenderer.addTrack(insulationTrack);
    ctx.trackRenderer.addTrack(boundaryTrack);
  }

  if (data.decay) {
    cachedDecay = sessionToDecay(data.decay);
  }

  if (data.baselineDecay) {
    baselineDecay = sessionToDecay(data.baselineDecay);
  }

  if (data.scaffoldDecay && data.scaffoldDecay.length > 0) {
    cachedScaffoldDecay = data.scaffoldDecay.map((sd: SessionScaffoldDecay) => ({
      scaffoldId: sd.scaffoldId,
      scaffoldName: sd.scaffoldName,
      color: sd.color,
      decay: sessionToDecay(sd.decay),
      contigCount: sd.contigCount,
    }));
  }

  if (data.compartments) {
    cachedCompartments = {
      eigenvector: Float32Array.from(data.compartments.eigenvector),
      normalizedEigenvector: Float32Array.from(data.compartments.normalizedEigenvector),
      iterations: data.compartments.iterations,
      eigenvalue: data.compartments.eigenvalue,
    };
    const track = compartmentToTrack(cachedCompartments, overviewSize, s.map.textureSize);
    ctx.trackRenderer.addTrack(track);
  }

  // Re-derive misassembly detection from restored insulation + compartments
  if (cachedInsulation && cachedCompartments) {
    runMisassemblyDetection(ctx);
  }

  ctx.tracksVisible = true;
  ctx.updateTrackConfigPanel();
  updateResultsDisplay(ctx);
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
    <button class="analysis-btn" id="btn-detect-patterns" style="margin-bottom:6px;width:100%;background:#8e44ad;color:#fff;">Detect Patterns</button>
    <div id="pattern-results"></div>
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
        drainPendingRecompute(ctx);
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
        drainPendingRecompute(ctx);
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
        drainPendingRecompute(ctx);
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
        drainPendingRecompute(ctx);
      });
    }
  });
  document.getElementById('btn-detect-patterns')?.addEventListener('click', () => {
    if (!computing) {
      computing = true;
      setButtonsDisabled(true);
      runPatternDetection(ctx).finally(() => {
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
    drainPendingRecompute(ctx);
  });
}

/**
 * Clear all analysis tracks and cached results.
 */
export function clearAnalysisTracks(ctx: AppContext): void {
  // Cancel any pending auto-recompute
  if (autoRecomputeTimer !== null) {
    clearTimeout(autoRecomputeTimer);
    autoRecomputeTimer = null;
  }
  pendingRecompute = false;

  cachedDecay = null;
  baselineDecay = null;
  cachedInsulation = null;
  cachedCompartments = null;
  cachedSuggestions = null;
  cachedScaffoldDecay = null;
  cachedPatterns = null;
  healthScoreHistory.length = 0;
  misassemblyFlags.clearAll();
  ctx.trackRenderer.removeTrack('Insulation Score');
  ctx.trackRenderer.removeTrack('TAD Boundaries');
  ctx.trackRenderer.removeTrack('A/B Compartments');
  ctx.trackRenderer.removeTrack('Misassembly Flags');
  ctx.updateTrackConfigPanel();
}

// ---------------------------------------------------------------------------
// Auto-recompute after curation (debounced)
// ---------------------------------------------------------------------------

function showRecomputingIndicator(visible: boolean): void {
  const el = document.getElementById('analysis-recomputing');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

/**
 * Schedule a debounced recompute of insulation + P(s) decay analysis.
 * Called from refreshAfterCuration() after every curation operation.
 * Only triggers if at least one analysis has been previously computed.
 */
export function scheduleAnalysisRecompute(ctx: AppContext): void {
  if (!cachedInsulation && !cachedDecay) return;

  if (autoRecomputeTimer !== null) {
    clearTimeout(autoRecomputeTimer);
  }

  autoRecomputeTimer = setTimeout(() => {
    autoRecomputeTimer = null;
    triggerAutoRecompute(ctx);
  }, AUTO_RECOMPUTE_DELAY_MS);
}

function drainPendingRecompute(ctx: AppContext): void {
  if (pendingRecompute) {
    pendingRecompute = false;
    setTimeout(() => triggerAutoRecompute(ctx), 100);
  }
}

async function triggerAutoRecompute(ctx: AppContext): Promise<void> {
  if (computing) {
    pendingRecompute = true;
    return;
  }

  computing = true;
  autoRecomputing = true;
  setButtonsDisabled(true);
  showRecomputingIndicator(true);

  const hadInsulation = cachedInsulation !== null;
  const tasks: Promise<void>[] = [];
  if (cachedInsulation) tasks.push(runInsulation(ctx));
  if (cachedDecay) tasks.push(runDecay(ctx));

  await Promise.all(tasks).finally(() => {
    if (hadInsulation && cachedInsulation && cachedCompartments) {
      runMisassemblyDetection(ctx);
    }
    updateResultsDisplay(ctx);

    computing = false;
    autoRecomputing = false;
    setButtonsDisabled(false);
    showRecomputingIndicator(false);

    if (pendingRecompute) {
      pendingRecompute = false;
      setTimeout(() => triggerAutoRecompute(ctx), 100);
    }
  });
}
