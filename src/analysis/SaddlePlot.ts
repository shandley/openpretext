/**
 * SaddlePlot — Compartment strength visualization.
 *
 * Digitizes bins by compartment eigenvector quantile, accumulates mean O/E
 * per quantile-bin pair to produce an n×n saddle matrix. Strength is
 * measured as (AA + BB corners) / (AB + BA corners).
 *
 * Reuses O/E computation from CompartmentAnalysis.
 *
 * Pure algorithm — no DOM dependencies.
 */

import { computeExpectedContacts, computeOEMatrix } from './CompartmentAnalysis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SaddleParams {
  /** Number of quantile bins. Default: 20. */
  nBins: number;
  /** Quantile range [min, max] to trim extremes. Default: [0.025, 0.975]. */
  qRange: [number, number];
  /** Minimum diagonal distance to include. Default: 3. */
  minDiag: number;
}

export interface SaddleResult {
  /** Saddle matrix (nBins × nBins), row-major. */
  saddleMatrix: Float32Array;
  /** Number of quantile bins. */
  nBins: number;
  /** Compartment strength: (AA + BB) / (AB + BA). */
  strength: number;
  /** Per-quantile-bin strength profile. Length = nBins. */
  strengthProfile: Float32Array;
  /** Quantile bin edges. Length = nBins + 1. */
  binEdges: Float32Array;
}

const DEFAULT_PARAMS: SaddleParams = {
  nBins: 20,
  qRange: [0.025, 0.975],
  minDiag: 3,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Assign each bin to a quantile rank based on eigenvector values.
 * Returns an array of quantile bin indices (0 to nBins-1).
 * Bins outside qRange or with NaN eigenvector get -1 (excluded).
 */
export function digitizeBins(
  eigenvector: Float32Array,
  nBins: number,
  qRange: [number, number],
): Int32Array {
  const n = eigenvector.length;
  const assignments = new Int32Array(n).fill(-1);

  if (n === 0) return assignments;

  // Sort eigenvector values to get quantile edges
  const sorted = Array.from(eigenvector).filter(v => isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return assignments;

  const lo = sorted[Math.floor(qRange[0] * sorted.length)];
  const hi = sorted[Math.min(sorted.length - 1, Math.ceil(qRange[1] * sorted.length))];
  const range = hi - lo;

  if (range <= 0) return assignments;

  for (let i = 0; i < n; i++) {
    const v = eigenvector[i];
    if (!isFinite(v) || v < lo || v > hi) continue;
    const frac = (v - lo) / range;
    const bin = Math.min(nBins - 1, Math.floor(frac * nBins));
    assignments[i] = bin;
  }

  return assignments;
}

/**
 * Compute saddle plot matrix from contact map and compartment eigenvector.
 *
 * @param contactMap Row-major symmetric contact matrix.
 * @param size Matrix dimension.
 * @param eigenvector Compartment eigenvector (positive = A, negative = B).
 * @param params Optional parameters.
 */
export function computeSaddlePlot(
  contactMap: Float32Array,
  size: number,
  eigenvector: Float32Array,
  params?: Partial<SaddleParams>,
): SaddleResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const { nBins, qRange, minDiag } = p;

  if (size === 0 || eigenvector.length === 0) {
    return {
      saddleMatrix: new Float32Array(0),
      nBins: 0,
      strength: 0,
      strengthProfile: new Float32Array(0),
      binEdges: new Float32Array(0),
    };
  }

  // Compute O/E matrix
  const expected = computeExpectedContacts(contactMap, size);
  const oeMatrix = computeOEMatrix(contactMap, size, expected);

  // Digitize bins by eigenvector quantile
  const binAssignment = digitizeBins(eigenvector, nBins, qRange);

  // Accumulate mean O/E per quantile pair
  const saddleSums = new Float64Array(nBins * nBins);
  const saddleCounts = new Float64Array(nBins * nBins);

  for (let i = 0; i < size; i++) {
    const qi = binAssignment[i];
    if (qi < 0) continue;
    for (let j = i + minDiag; j < size; j++) {
      const qj = binAssignment[j];
      if (qj < 0) continue;

      const oe = oeMatrix[i * size + j];
      if (!isFinite(oe) || oe <= 0) continue;

      // Symmetric: accumulate both (qi, qj) and (qj, qi)
      saddleSums[qi * nBins + qj] += oe;
      saddleCounts[qi * nBins + qj]++;
      if (qi !== qj) {
        saddleSums[qj * nBins + qi] += oe;
        saddleCounts[qj * nBins + qi]++;
      }
    }
  }

  // Compute means
  const saddleMatrix = new Float32Array(nBins * nBins);
  for (let i = 0; i < nBins * nBins; i++) {
    saddleMatrix[i] = saddleCounts[i] > 0 ? saddleSums[i] / saddleCounts[i] : 0;
  }

  // Compute bin edges for reference
  const sorted = Array.from(eigenvector).filter(v => isFinite(v)).sort((a, b) => a - b);
  const lo = sorted.length > 0 ? sorted[Math.floor(qRange[0] * sorted.length)] : 0;
  const hi = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.ceil(qRange[1] * sorted.length))] : 1;
  const binEdges = new Float32Array(nBins + 1);
  for (let i = 0; i <= nBins; i++) {
    binEdges[i] = lo + (i / nBins) * (hi - lo);
  }

  // Compartment strength: (AA + BB) / (AB + BA)
  // A = high eigenvector (top quantiles), B = low (bottom quantiles)
  const cornerSize = Math.max(1, Math.floor(nBins / 5));
  let aaSum = 0, aaCount = 0;
  let bbSum = 0, bbCount = 0;
  let abSum = 0, abCount = 0;

  for (let i = 0; i < cornerSize; i++) {
    for (let j = 0; j < cornerSize; j++) {
      // BB corner (top-left)
      const bb = saddleMatrix[i * nBins + j];
      if (bb > 0) { bbSum += bb; bbCount++; }
      // AA corner (bottom-right)
      const ai = nBins - 1 - i;
      const aj = nBins - 1 - j;
      const aa = saddleMatrix[ai * nBins + aj];
      if (aa > 0) { aaSum += aa; aaCount++; }
      // AB corner (top-right)
      const ab = saddleMatrix[i * nBins + aj];
      if (ab > 0) { abSum += ab; abCount++; }
      // BA corner (bottom-left)
      const ba = saddleMatrix[ai * nBins + j];
      if (ba > 0) { abSum += ba; abCount++; }
    }
  }

  const aaMean = aaCount > 0 ? aaSum / aaCount : 0;
  const bbMean = bbCount > 0 ? bbSum / bbCount : 0;
  const abMean = abCount > 0 ? abSum / abCount : 0;
  const strength = abMean > 0 ? (aaMean + bbMean) / (2 * abMean) : 0;

  // Per-bin strength profile: diagonal value / off-diagonal mean for each quantile
  const strengthProfile = new Float32Array(nBins);
  for (let i = 0; i < nBins; i++) {
    const diag = saddleMatrix[i * nBins + i];
    let offDiagSum = 0;
    let offDiagCount = 0;
    for (let j = 0; j < nBins; j++) {
      if (j !== i && saddleMatrix[i * nBins + j] > 0) {
        offDiagSum += saddleMatrix[i * nBins + j];
        offDiagCount++;
      }
    }
    const offDiagMean = offDiagCount > 0 ? offDiagSum / offDiagCount : 0;
    strengthProfile[i] = offDiagMean > 0 ? diag / offDiagMean : 0;
  }

  return {
    saddleMatrix,
    nBins,
    strength,
    strengthProfile,
    binEdges,
  };
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/**
 * Render a saddle plot as an inline SVG string.
 */
export function renderSaddleSVG(result: SaddleResult): string {
  if (result.nBins === 0 || result.saddleMatrix.length === 0) return '';

  const { nBins, saddleMatrix, strength } = result;
  const cellSize = Math.max(4, Math.floor(200 / nBins));
  const W = nBins * cellSize;
  const H = nBins * cellSize;
  const margin = { top: 16, right: 8, bottom: 28, left: 8 };
  const totalW = W + margin.left + margin.right;
  const totalH = H + margin.top + margin.bottom;

  // Find value range for color scaling
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < saddleMatrix.length; i++) {
    if (saddleMatrix[i] > 0) {
      if (saddleMatrix[i] < vMin) vMin = saddleMatrix[i];
      if (saddleMatrix[i] > vMax) vMax = saddleMatrix[i];
    }
  }
  if (!isFinite(vMin)) vMin = 0;
  if (!isFinite(vMax)) vMax = 1;
  const vRange = vMax - vMin || 1;

  let svg = `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg" class="saddle-svg">`;

  // Title
  svg += `<text x="${totalW / 2}" y="12" text-anchor="middle" font-size="9" fill="#a0a0b0">Saddle Plot</text>`;

  // Cells
  for (let i = 0; i < nBins; i++) {
    for (let j = 0; j < nBins; j++) {
      const v = saddleMatrix[i * nBins + j];
      const frac = v > 0 ? (v - vMin) / vRange : 0;
      const color = saddleColor(frac);
      const x = margin.left + j * cellSize;
      const y = margin.top + i * cellSize;
      svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${color}" stroke="none"/>`;
    }
  }

  // Labels
  svg += `<text x="${margin.left}" y="${totalH - 4}" font-size="7" fill="#a0a0b0">B</text>`;
  svg += `<text x="${margin.left + W - 8}" y="${totalH - 4}" font-size="7" fill="#a0a0b0">A</text>`;

  // Strength annotation
  svg += `<text x="${totalW / 2}" y="${totalH - 4}" text-anchor="middle" font-size="8" fill="#a0a0b0">Strength: ${strength.toFixed(2)}</text>`;

  svg += '</svg>';
  return svg;
}

/**
 * Map a [0,1] fraction to a blue-white-red color.
 */
function saddleColor(frac: number): string {
  const t = Math.max(0, Math.min(1, frac));
  if (t < 0.5) {
    // Blue to white
    const s = t * 2;
    const r = Math.round(50 + s * 205);
    const g = Math.round(50 + s * 205);
    const b = Math.round(200 + s * 55);
    return `rgb(${r},${g},${b})`;
  } else {
    // White to red
    const s = (t - 0.5) * 2;
    const r = 255;
    const g = Math.round(255 - s * 205);
    const b = Math.round(255 - s * 205);
    return `rgb(${r},${g},${b})`;
  }
}
