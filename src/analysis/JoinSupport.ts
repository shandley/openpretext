/**
 * JoinSupport - score how well the Hi-C signal supports each contig junction.
 *
 * A correct join shows contact continuing across the boundary with the expected
 * short-range decay; a misjoin or misorder shows a depletion (the dark
 * off-diagonal square a curator reads by eye). For each junction between two
 * display-adjacent contigs we compute a pooled observed/expected of the
 * straddling near-diagonal:
 *
 *   support = sum_d crossObs(d)  /  sum_d E(d) * crossN(d)
 *
 * where crossObs(d) is the contact across the boundary at separation d, and
 * E(d) is the *local* expected at that separation (the neighbors' own
 * near-boundary diagonal), falling back to the genome-wide P(s) when a contig
 * is too small to self-normalize. Local expected controls for coverage: a
 * low-coverage but real join keeps support near 1 rather than being flagged.
 *
 * This is coarse triage at overview (megabase-bin) resolution: it ranks
 * junctions by suspicion, it is not a statistical test. It runs on the
 * display-order matrix so junctions are between adjacent bins.
 */

import type { ContigRange } from '../curation/AutoSort';
import { computeExpectedContacts } from './CompartmentAnalysis';

export type JoinConfidence = 'high' | 'medium' | 'low';

export interface JunctionSupport {
  /** Display index of the left contig; the junction is between it and the next. */
  orderIndex: number;
  /** Overview bin of the boundary (the left contig's end bin). */
  binPosition: number;
  /** Pooled observed/expected across the junction. ~1 supported, <<1 suspect. */
  support: number;
  /** How resolvable the junction is at this bin size. */
  confidence: JoinConfidence;
  /** Whether this junction is an outlier below the assembly's own distribution. */
  flagged: boolean;
}

export interface JoinSupportResult {
  junctions: JunctionSupport[];
  flaggedCount: number;
  /** Median support over high/medium-confidence junctions (reference). */
  median: number;
  /** The support threshold below which a junction was flagged. */
  threshold: number;
}

export interface JoinSupportParams {
  /** Window (in bins) for the straddling and local-expected sums. */
  window: number;
  /** Absolute floor for the flag threshold. */
  floor: number;
  /** Robust cutoff: flag support < median - k * MAD. */
  k: number;
}

const DEFAULT_PARAMS: JoinSupportParams = { window: 6, floor: 0.35, k: 2.5 };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Compute per-junction support on a display-order overview matrix.
 *
 * @param matrix       size*size row-major symmetric contact matrix, display order.
 * @param size         matrix dimension (bins).
 * @param contigRanges per-contig bin ranges in display order (from buildContigRanges).
 */
export function computeJoinSupport(
  matrix: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  params?: Partial<JoinSupportParams>,
  scaffoldIds?: Array<number | null>,
): JoinSupportResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const globalE = computeExpectedContacts(matrix, size);
  const at = (i: number, j: number) => matrix[i * size + j];
  const expectedAt = (d: number) => (d >= 0 && d < globalE.length ? globalE[d] : 0);

  const junctions: JunctionSupport[] = [];

  for (let c = 0; c < contigRanges.length - 1; c++) {
    // Skip a junction between two different assigned scaffolds: it is an
    // intentional chromosome boundary, expected to be weak, not a misjoin.
    if (scaffoldIds) {
      const sa = scaffoldIds[c];
      const sb = scaffoldIds[c + 1];
      if (sa != null && sb != null && sa !== sb) continue;
    }

    const a = contigRanges[c];
    const b = contigRanges[c + 1];
    const aStart = a.start, aEnd = a.end;
    const bStart = b.start, bEnd = b.end;
    const sizeA = aEnd - aStart;
    const sizeB = bEnd - bStart;
    if (sizeA <= 0 || sizeB <= 0) continue;

    let crossSum = 0;
    let crossCount = 0;
    let expSum = 0;

    for (let d = 1; d <= p.window; d++) {
      // Cross cells straddling the boundary: i in A, i+d in B.
      const iLo = Math.max(aStart, bStart - d);
      const iHi = Math.min(aEnd - 1, bEnd - 1 - d);
      let cObs = 0;
      let cN = 0;
      for (let i = iLo; i <= iHi; i++) {
        cObs += at(i, i + d);
        cN++;
      }
      if (cN === 0) continue;

      // Local expected at separation d: intra-contig contact in the
      // near-boundary ends of A and B.
      let eObs = 0;
      let eN = 0;
      for (let i = Math.max(aStart, aEnd - p.window); i <= aEnd - 1 - d; i++) {
        eObs += at(i, i + d);
        eN++;
      }
      for (let i = bStart; i <= Math.min(bEnd - 1 - d, bStart + p.window - 1); i++) {
        eObs += at(i, i + d);
        eN++;
      }
      const eD = eN > 0 ? eObs / eN : expectedAt(d);

      crossSum += cObs;
      crossCount += cN;
      expSum += eD * cN;
    }

    if (crossCount === 0) continue; // no measurable straddling signal
    const support = expSum > 0 ? crossSum / expSum : 0;
    const resolved = Math.min(sizeA, sizeB);
    const confidence: JoinConfidence = resolved >= 3 ? 'high' : resolved >= 2 ? 'medium' : 'low';

    junctions.push({ orderIndex: c, binPosition: aEnd, support, confidence, flagged: false });
  }

  // Flag outliers below the assembly's own distribution (high/medium only).
  const scored = junctions.filter((j) => j.confidence !== 'low').map((j) => j.support);
  const med = median(scored);
  const mad = median(scored.map((v) => Math.abs(v - med)));
  const threshold = Math.max(p.floor, med - p.k * mad);

  let flaggedCount = 0;
  for (const j of junctions) {
    if (j.confidence !== 'low' && j.support < threshold) {
      j.flagged = true;
      flaggedCount++;
    }
  }

  return { junctions, flaggedCount, median: med, threshold };
}
