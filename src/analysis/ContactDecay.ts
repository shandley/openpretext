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
}

export interface ContactDecayResult {
  /** Diagonal distances (1, 2, 3, ...). */
  distances: Float64Array;
  /** Mean contact frequency at each distance. */
  meanContacts: Float64Array;
  /** Log10 of distances. */
  logDistances: Float64Array;
  /** Log10 of mean contacts. */
  logContacts: Float64Array;
  /** Decay exponent (slope of log-log fit). Typically -1.0 to -1.5. */
  decayExponent: number;
  /** R-squared of the linear fit in log-log space. */
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

  if (size === 0 || contigRanges.length === 0) {
    return {
      distances: new Float64Array(0),
      meanContacts: new Float64Array(0),
      logDistances: new Float64Array(0),
      logContacts: new Float64Array(0),
      decayExponent: 0,
      rSquared: 0,
      maxDistance: maxD,
    };
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

  // Color code: green if exponent is in typical Hi-C range [-1.5, -0.8]
  const inRange = exp <= -0.8 && exp >= -1.5;
  const color = inRange ? '#4caf50' : '#f39c12';

  let html = '';
  html += `<div class="stats-row"><span>P(s) exponent</span>`;
  html += `<span style="color:${color};">${exp.toFixed(2)}</span></div>`;
  html += `<div class="stats-row"><span>P(s) R\u00B2</span>`;
  html += `<span>${r2.toFixed(3)}</span></div>`;
  html += `<div class="stats-row"><span>P(s) range</span>`;
  html += `<span>1–${result.maxDistance} px</span></div>`;

  return html;
}
