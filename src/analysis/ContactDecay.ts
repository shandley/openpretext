/**
 * ContactDecay — Contact frequency decay P(s) curve analysis.
 *
 * Computes the mean contact frequency as a function of genomic distance
 * (diagonal offset), fits a power-law in log-log space, and reports the
 * decay exponent. For well-assembled Hi-C data, the exponent is typically
 * -1.0 to -1.5.
 *
 * Reuses computeIntraDiagonalProfile from AutoSort for the core computation.
 *
 * Pure algorithm — no side effects or state mutations.
 */

import {
  computeIntraDiagonalProfile,
  type ContigRange,
} from '../curation/AutoSort';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactDecayParams {
  /** Maximum diagonal distance to compute. Default: min(size/2, 500). */
  maxDistance: number;
  /** Minimum count at a distance to include in fit. Default: 10. */
  minCountForFit: number;
  /**
   * Minimum number of distinct distances (fit points) required to report a
   * decay exponent / R-squared. Below this the log-log OLS fit is unreliable —
   * at 2 points R-squared is 1.0 by construction (zero residual degrees of
   * freedom) — so the fit is reported as not-fitted (NaN) rather than a
   * spurious value. Default: 5.
   */
  minFitPoints: number;
}

/** Default minimum distinct distances required for a trustworthy P(s) fit. */
const DEFAULT_MIN_FIT_POINTS = 5;

export interface ContactDecayResult {
  /** Diagonal distances (1, 2, 3, ...). */
  distances: Float64Array;
  /** Mean contact frequency at each distance. */
  meanContacts: Float64Array;
  /** Log10 of distances. */
  logDistances: Float64Array;
  /** Log10 of mean contacts. */
  logContacts: Float64Array;
  /**
   * Decay exponent (slope of log-log fit). Typically -1.0 to -1.5. `NaN` when
   * the curve could not be fitted (no data, or fewer than `minFitPoints`
   * distinct distances) — check with `Number.isFinite` before use.
   */
  decayExponent: number;
  /**
   * R-squared of the linear fit in log-log space. `NaN` when not fitted (see
   * `decayExponent`); a sparse curve is deliberately not collapsed to 0 so
   * callers can exclude it rather than average in a spurious value.
   */
  rSquared: number;
  /** Maximum diagonal distance computed. */
  maxDistance: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

/**
 * Ordinary least-squares linear regression.
 */
function linearRegression(x: number[], y: number[]): RegressionResult {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: 0, rSquared: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: 0, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept;
    ssRes += (y[i] - predicted) * (y[i] - predicted);
    ssTot += (y[i] - meanY) * (y[i] - meanY);
  }

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, rSquared };
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute the contact decay P(s) curve.
 *
 * Uses computeIntraDiagonalProfile from AutoSort for the per-distance
 * mean intensity, then fits a line in log10-log10 space to extract the
 * decay exponent.
 */
export function computeContactDecay(
  contactMap: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  params?: Partial<ContactDecayParams>,
): ContactDecayResult {
  const maxD = params?.maxDistance ?? Math.min(Math.floor(size / 2), 500);
  const _minCount = params?.minCountForFit ?? 10;
  const minFitPoints = params?.minFitPoints ?? DEFAULT_MIN_FIT_POINTS;

  if (size === 0 || contigRanges.length === 0) {
    return notFitted(maxD);
  }

  const profile = computeIntraDiagonalProfile(contactMap, size, contigRanges, maxD);

  // Collect non-zero distances and their mean contacts
  const distArr: number[] = [];
  const contArr: number[] = [];
  for (let d = 1; d <= maxD; d++) {
    if (profile[d] > 0) {
      distArr.push(d);
      contArr.push(profile[d]);
    }
  }

  // Log-transform
  const logDist = distArr.map(d => Math.log10(d));
  const logCont = contArr.map(c => Math.log10(c));

  // Too few points to trust the log-log fit — keep the data (so the curve can
  // still be plotted) but report the fit as not-fitted rather than spurious.
  if (distArr.length < minFitPoints) {
    return notFitted(
      maxD,
      Float64Array.from(distArr),
      Float64Array.from(contArr),
      Float64Array.from(logDist),
      Float64Array.from(logCont),
    );
  }

  // Linear regression in log-log space
  const { slope, rSquared } = linearRegression(logDist, logCont);

  return {
    distances: Float64Array.from(distArr),
    meanContacts: Float64Array.from(contArr),
    logDistances: Float64Array.from(logDist),
    logContacts: Float64Array.from(logCont),
    decayExponent: slope,
    rSquared,
    maxDistance: maxD,
  };
}

/**
 * Build a not-fitted result: NaN exponent/R-squared, optionally carrying the
 * raw curve data (present for a sparse curve, empty for no data at all).
 */
function notFitted(
  maxD: number,
  distances = new Float64Array(0),
  meanContacts = new Float64Array(0),
  logDistances = new Float64Array(0),
  logContacts = new Float64Array(0),
): ContactDecayResult {
  return {
    distances,
    meanContacts,
    logDistances,
    logContacts,
    decayExponent: NaN,
    rSquared: NaN,
    maxDistance: maxD,
  };
}

// ---------------------------------------------------------------------------
// Per-scaffold computation
// ---------------------------------------------------------------------------

export interface ScaffoldGroup {
  scaffoldId: number;
  name: string;
  color: string;
  orderIndices: number[];
}

export interface ScaffoldDecayResult {
  scaffoldId: number;
  scaffoldName: string;
  color: string;
  decay: ContactDecayResult;
  contigCount: number;
}

/**
 * Compute P(s) decay curves for each scaffold group independently.
 *
 * Filters contigRanges to those belonging to each scaffold, then calls
 * computeContactDecay on the subset. Only includes scaffolds with at least
 * one contig range that spans > 1 pixel.
 */
export function computeDecayByScaffold(
  contactMap: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  scaffoldGroups: ScaffoldGroup[],
  params?: Partial<ContactDecayParams>,
): ScaffoldDecayResult[] {
  const rangeByOrder = new Map<number, ContigRange>();
  for (const r of contigRanges) {
    rangeByOrder.set(r.orderIndex, r);
  }

  const results: ScaffoldDecayResult[] = [];

  for (const group of scaffoldGroups) {
    const filteredRanges: ContigRange[] = [];
    for (const idx of group.orderIndices) {
      const range = rangeByOrder.get(idx);
      if (range && (range.end - range.start) > 1) {
        filteredRanges.push(range);
      }
    }

    if (filteredRanges.length === 0) continue;

    const decay = computeContactDecay(contactMap, size, filteredRanges, params);
    results.push({
      scaffoldId: group.scaffoldId,
      scaffoldName: group.name,
      color: group.color,
      decay,
      contigCount: filteredRanges.length,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Stats panel formatting
// ---------------------------------------------------------------------------

/**
 * Format the decay result as HTML for the stats panel.
 */
export function formatDecayStats(result: ContactDecayResult): string {
  if (result.distances.length === 0) {
    return '<div class="stats-row"><span>P(s) decay</span><span>—</span></div>';
  }

  const exp = result.decayExponent;
  const r2 = result.rSquared;
  const fitted = Number.isFinite(exp);

  // Color code: green if exponent is in typical Hi-C range [-1.5, -0.8].
  const inRange = fitted && exp <= -0.8 && exp >= -1.5;
  const color = fitted ? (inRange ? '#4caf50' : '#f39c12') : 'var(--text-secondary)';

  let html = '';
  html += `<div class="stats-row"><span>P(s) exponent</span>`;
  html += `<span style="color:${color};">${fitted ? exp.toFixed(2) : '\u2014'}</span></div>`;
  html += `<div class="stats-row"><span>P(s) R\u00B2</span>`;
  html += `<span>${Number.isFinite(r2) ? r2.toFixed(3) : '\u2014'}</span></div>`;
  html += `<div class="stats-row"><span>P(s) range</span>`;
  html += `<span>1–${result.maxDistance} px</span></div>`;

  return html;
}
