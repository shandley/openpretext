/**
 * HiCQualityMetrics — Library-level quality assessment for Hi-C data.
 *
 * Computes:
 * - Cis/trans ratio: contacts within scaffold vs between scaffolds
 * - Short/long range ratio: intra-scaffold contacts below/above threshold
 * - Contact density: mean contact value across the upper triangle
 * - Per-contig cis ratio: fraction of contacts that are intra-scaffold
 *
 * Pure algorithm — no DOM dependencies.
 */

import type { ContigRange } from '../curation/AutoSort';
import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HiCQualityParams {
  /** Distance threshold (in bins) separating short from long range. Default: 20. */
  shortRangeThreshold: number;
}

export interface ScaffoldCisResult {
  scaffoldId: number;
  name: string;
  cisRatio: number;
  contactCount: number;
}

export interface HiCQualityResult {
  /** Cis contacts / total contacts. */
  cisTransRatio: number;
  /** Cis percentage (0-100). */
  cisPercentage: number;
  /** Long-range / short-range contact ratio. */
  longShortRatio: number;
  /** Mean contact value in the upper triangle. */
  contactDensity: number;
  /** Per-contig cis ratio. Length = number of contigs. */
  perContigCisRatio: Float32Array;
  /** Per-scaffold cis results. */
  perScaffoldCis: ScaffoldCisResult[];
  /** Contig indices with cis ratio < 0.5 (potential misjoins). */
  flaggedContigs: number[];
}

const DEFAULT_PARAMS: HiCQualityParams = {
  shortRangeThreshold: 20,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute Hi-C quality metrics from the overview contact map.
 *
 * @param contactMap Row-major symmetric contact matrix.
 * @param size Matrix dimension.
 * @param contigRanges Bin ranges for each contig.
 * @param scaffoldIds Scaffold ID per contig (-1 for unscaffolded). Same length as contigRanges.
 * @param scaffoldNames Scaffold name per unique scaffold ID.
 * @param params Optional parameters.
 */
export function computeHiCQuality(
  contactMap: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  scaffoldIds: number[],
  scaffoldNames: Map<number, string>,
  params?: Partial<HiCQualityParams>,
): HiCQualityResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (size === 0 || contigRanges.length === 0) {
    return {
      cisTransRatio: 0,
      cisPercentage: 0,
      longShortRatio: 0,
      contactDensity: 0,
      perContigCisRatio: new Float32Array(0),
      perScaffoldCis: [],
      flaggedContigs: [],
    };
  }

  // Build bin→contig index and bin→scaffold ID lookup
  const binToContig = new Int32Array(size).fill(-1);
  const binToScaffold = new Int32Array(size).fill(-1);
  for (let c = 0; c < contigRanges.length; c++) {
    const r = contigRanges[c];
    const sid = c < scaffoldIds.length ? scaffoldIds[c] : -1;
    for (let b = r.start; b < r.end && b < size; b++) {
      binToContig[b] = c;
      binToScaffold[b] = sid;
    }
  }

  // Accumulate cis/trans contacts
  let cisTotal = 0;
  let transTotal = 0;
  let shortRange = 0;
  let longRange = 0;
  let totalContact = 0;
  let totalPixels = 0;

  // Per-contig cis/total contact sums
  const contigCis = new Float64Array(contigRanges.length);
  const contigTotal = new Float64Array(contigRanges.length);

  // Per-scaffold cis/total contact sums
  const scaffoldCis = new Map<number, number>();
  const scaffoldTotal = new Map<number, number>();

  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const v = contactMap[i * size + j];
      if (v <= 0) continue;

      totalContact += v;
      totalPixels++;

      const ci = binToContig[i];
      const cj = binToContig[j];
      const si = binToScaffold[i];
      const sj = binToScaffold[j];

      // Cis: same scaffold (and both scaffolded)
      const isCis = si >= 0 && si === sj;

      if (isCis) {
        cisTotal += v;

        // Short vs long range (within same scaffold)
        const dist = j - i;
        if (dist <= p.shortRangeThreshold) {
          shortRange += v;
        } else {
          longRange += v;
        }
      } else {
        transTotal += v;
      }

      // Per-contig tracking
      if (ci >= 0) {
        contigTotal[ci] += v;
        if (isCis) contigCis[ci] += v;
      }
      if (cj >= 0 && cj !== ci) {
        contigTotal[cj] += v;
        if (isCis) contigCis[cj] += v;
      }

      // Per-scaffold tracking
      if (si >= 0) {
        scaffoldTotal.set(si, (scaffoldTotal.get(si) ?? 0) + v);
        if (isCis) scaffoldCis.set(si, (scaffoldCis.get(si) ?? 0) + v);
      }
      if (sj >= 0 && sj !== si) {
        scaffoldTotal.set(sj, (scaffoldTotal.get(sj) ?? 0) + v);
        if (isCis) scaffoldCis.set(sj, (scaffoldCis.get(sj) ?? 0) + v);
      }
    }
  }

  const total = cisTotal + transTotal;
  const cisTransRatio = total > 0 ? cisTotal / total : 0;
  const cisPercentage = cisTransRatio * 100;
  const longShortRatio = shortRange > 0 ? longRange / shortRange : 0;
  const contactDensity = totalPixels > 0 ? totalContact / totalPixels : 0;

  // Per-contig cis ratio
  const perContigCisRatio = new Float32Array(contigRanges.length);
  const flaggedContigs: number[] = [];
  for (let c = 0; c < contigRanges.length; c++) {
    if (contigTotal[c] > 0) {
      perContigCisRatio[c] = contigCis[c] / contigTotal[c];
    } else {
      perContigCisRatio[c] = 0;
    }
    if (perContigCisRatio[c] < 0.5 && contigTotal[c] > 0) {
      flaggedContigs.push(c);
    }
  }

  // Per-scaffold cis results
  const perScaffoldCis: ScaffoldCisResult[] = [];
  for (const [sid, total] of scaffoldTotal.entries()) {
    const cis = scaffoldCis.get(sid) ?? 0;
    perScaffoldCis.push({
      scaffoldId: sid,
      name: scaffoldNames.get(sid) ?? `Scaffold ${sid}`,
      cisRatio: total > 0 ? cis / total : 0,
      contactCount: total,
    });
  }
  perScaffoldCis.sort((a, b) => b.contactCount - a.contactCount);

  return {
    cisTransRatio,
    cisPercentage,
    longShortRatio,
    contactDensity,
    perContigCisRatio,
    perScaffoldCis,
    flaggedContigs,
  };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert per-contig cis ratio to a line track.
 */
export function qualityToTrack(
  result: HiCQualityResult,
  contigRanges: ContigRange[],
  overviewSize: number,
  textureSize: number,
): TrackConfig {
  const data = new Float32Array(textureSize);

  // Map per-contig cis ratio to bins
  const binValues = new Float32Array(overviewSize);
  for (let c = 0; c < contigRanges.length; c++) {
    const r = contigRanges[c];
    const ratio = c < result.perContigCisRatio.length ? result.perContigCisRatio[c] : 0;
    for (let b = r.start; b < r.end && b < overviewSize; b++) {
      binValues[b] = ratio;
    }
  }

  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    data[tp] = binValues[op];
  }

  return {
    name: 'Per-Contig Cis Ratio',
    type: 'line',
    data,
    color: '#64b4ff',
    height: 30,
    visible: true,
  };
}
