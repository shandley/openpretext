/**
 * AnalysisPanel — 3D genomics analysis controls and track registration.
 *
 * Provides UI for computing insulation scores, contact decay curves,
 * and A/B compartment eigenvectors from the Hi-C contact map.
 * Results are displayed as overlay tracks via TrackRenderer.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import type { ContigRange } from '../curation/AutoSort';
import {
  computeInsulation,
  insulationToTracks,
} from '../analysis/InsulationScore';
import {
  computeContactDecay,
  formatDecayStats,
  type ContactDecayResult,
} from '../analysis/ContactDecay';
import {
  computeCompartments,
  compartmentToTrack,
} from '../analysis/CompartmentAnalysis';

// ---------------------------------------------------------------------------
// Cached state
// ---------------------------------------------------------------------------

let cachedDecay: ContactDecayResult | null = null;
let insulationWindowSize = 10;

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

// ---------------------------------------------------------------------------
// Analysis runners
// ---------------------------------------------------------------------------

function runInsulation(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const result = computeInsulation(s.map.contactMap, overviewSize, {
    windowSize: insulationWindowSize,
  });
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
  updateResultsDisplay();
}

function runDecay(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const ranges = buildContigRanges();
  cachedDecay = computeContactDecay(s.map.contactMap, overviewSize, ranges);
  ctx.showToast(`P(s) decay exponent: ${cachedDecay.decayExponent.toFixed(2)}`);
  updateResultsDisplay();
}

function runCompartments(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = getOverviewSize();
  const result = computeCompartments(s.map.contactMap, overviewSize);
  const track = compartmentToTrack(result, overviewSize, s.map.textureSize);

  ctx.trackRenderer.addTrack(track);
  ctx.tracksVisible = true;
  ctx.updateTrackConfigPanel();
  ctx.showToast(`Compartments: ${result.iterations} iterations, eigenvalue ${result.eigenvalue.toFixed(2)}`);
  updateResultsDisplay();
}

// ---------------------------------------------------------------------------
// Results display
// ---------------------------------------------------------------------------

function updateResultsDisplay(): void {
  const el = document.getElementById('analysis-results');
  if (!el) return;

  let html = '';
  if (cachedDecay) {
    html += formatDecayStats(cachedDecay);
  }
  el.innerHTML = html || '<div style="color: var(--text-secondary); font-size: 11px;">Click a button above to compute.</div>';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the Analysis panel UI inside #analysis-content.
 */
export function setupAnalysisPanel(ctx: AppContext): void {
  const container = document.getElementById('analysis-content');
  if (!container) return;

  // Build the panel HTML (will be shown once data is loaded)
  // The initial "No data loaded" placeholder is replaced by runAllAnalyses
  // or by the user clicking buttons.
}

/**
 * Run all analyses on the current contact map and register tracks.
 */
export function runAllAnalyses(ctx: AppContext): void {
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
    <div id="analysis-results"></div>
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
    runInsulation(ctx);
  });
  document.getElementById('btn-compute-decay')?.addEventListener('click', () => {
    runDecay(ctx);
  });
  document.getElementById('btn-compute-compartments')?.addEventListener('click', () => {
    runCompartments(ctx);
  });
  document.getElementById('btn-run-all-analysis')?.addEventListener('click', () => {
    runInsulation(ctx);
    runDecay(ctx);
    runCompartments(ctx);
  });

  // Auto-compute all analyses
  runInsulation(ctx);
  runDecay(ctx);
  runCompartments(ctx);
}

/**
 * Clear all analysis tracks and cached results.
 */
export function clearAnalysisTracks(ctx: AppContext): void {
  cachedDecay = null;
  ctx.trackRenderer.removeTrack('Insulation Score');
  ctx.trackRenderer.removeTrack('TAD Boundaries');
  ctx.trackRenderer.removeTrack('A/B Compartments');
  ctx.updateTrackConfigPanel();
}
