/**
 * HaplotigDetector - flag contigs that look like retained haplotigs.
 *
 * A retained haplotig is a piece of the alternate haplotype that was not merged
 * into the primary assembly. It leaves two signatures:
 *
 *  - Contact: Hi-C reads from the alternate haplotype cross-map to the primary,
 *    so the haplotig shows a bright off-diagonal block against its one
 *    homologous primary region. We score this as a block observed/expected,
 *    reusing the same P(s) expectation JoinSupport uses.
 *  - Coverage: reads split across the two haplotypes, so a haplotig sits near
 *    half the assembly's median read depth.
 *
 * Neither signal is specific on its own. A bright off-diagonal block is also
 * produced by segmental duplications, repeats, and displaced true-neighbours,
 * so a contact-only flag is "possible duplicate, unconfirmed", never "likely
 * haplotig". Coverage is the discriminator: only when a bright block *and*
 * half-coverage agree do we report high confidence. Files without a coverage
 * track can still surface candidates, but they stay unconfirmed.
 *
 * This is coarse triage at overview (megabase-bin) resolution, matching the
 * rest of the analysis panel. Small contigs (the common small-haplotig case)
 * do not span enough overview bins to carry a contact signal; on those we fall
 * back to coverage alone, which is computed at full pixel resolution.
 */

import type { ContigRange } from '../curation/AutoSort';
import type { MapData } from '../core/State';
import { computeExpectedContacts } from './CompartmentAnalysis';

export type HaplotigConfidence = 'high' | 'medium' | 'low';

export interface HaplotigCandidate {
  /** Display index of the candidate contig. */
  orderIndex: number;
  /** File (original) index, for tagging. */
  originalIndex: number;
  /** Display index of the best homologous partner, or -1 when coverage-only. */
  partnerOrderIndex: number;
  /** Best-partner block observed/expected. NaN when the contig is unresolvable. */
  contactEnrichment: number;
  /** Median coverage / assembly median. NaN when no coverage track is loaded. */
  coverageRatio: number;
  /** Coverage is present and near half: the haplotig signature is confirmed. */
  coverageConfirmed: boolean;
  confidence: HaplotigConfidence;
  flagged: boolean;
}

export interface HaplotigResult {
  /** Flagged candidates, most suspect first. */
  candidates: HaplotigCandidate[];
  flaggedCount: number;
  coverageAvailable: boolean;
}

export interface HaplotigParams {
  /** Partner must be at least this many contigs away in display order (avoids cis-proximal neighbours). */
  minPartnerSeparation: number;
  /** A contig needs at least this many overview bins to carry a contact signal. */
  minContigBins: number;
  /** Absolute floor for a contact enrichment flag. */
  enrichmentFloor: number;
  /** Robust cutoff: flag enrichment > median + k * MAD. */
  k: number;
  /** Coverage ratio at or below this is treated as confirmed half-coverage. */
  halfCoverageMax: number;
  /** Floor for the expected denominator in the far-off-diagonal block O/E. */
  denomFloor: number;
}

const DEFAULT_PARAMS: HaplotigParams = {
  minPartnerSeparation: 4,
  minContigBins: 2,
  enrichmentFloor: 2,
  k: 3,
  halfCoverageMax: 0.65,
  denomFloor: 1e-6,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface DetectHaplotigsOptions {
  /** Per-contig coverage ratio aligned to display order; NaN where unknown. */
  coverageRatioByOrder?: Float32Array | null;
  /** Display index -> file (original) index. Defaults to identity. */
  originalIndexByOrder?: Int32Array | number[];
  params?: Partial<HaplotigParams>;
}

/**
 * Per-contig coverage ratio (median contig coverage / assembly median), in
 * file (original) order. Returns null when the map carries no coverage track.
 * The ratio is computed at full pixel resolution from the embedded track.
 */
export function computeContigCoverageRatios(map: MapData): Float32Array | null {
  const cov = map.extensions?.get('coverage');
  if (!cov || cov.length !== map.textureSize) return null;

  const contigMedians = new Float32Array(map.contigs.length).fill(NaN);
  const present: number[] = [];
  for (let ci = 0; ci < map.contigs.length; ci++) {
    const c = map.contigs[ci];
    const lo = Math.max(0, Math.min(cov.length, c.pixelStart));
    const hi = Math.max(lo, Math.min(cov.length, c.pixelEnd));
    if (hi <= lo) continue;
    const vals: number[] = [];
    for (let p = lo; p < hi; p++) vals.push(cov[p]);
    const m = median(vals);
    contigMedians[ci] = m;
    if (m > 0) present.push(m);
  }

  const genomeMedian = median(present);
  if (!(genomeMedian > 0)) return null;

  const ratios = new Float32Array(map.contigs.length).fill(NaN);
  for (let ci = 0; ci < contigMedians.length; ci++) {
    const m = contigMedians[ci];
    if (!Number.isNaN(m)) ratios[ci] = m / genomeMedian;
  }
  return ratios;
}

/**
 * Detect retained-haplotig candidates on a display-order overview matrix.
 *
 * @param matrix size*size row-major symmetric contact matrix, display order.
 * @param size   matrix dimension (bins).
 * @param ranges per-contig bin ranges in display order (from buildContigRanges).
 */
export function detectHaplotigs(
  matrix: Float32Array,
  size: number,
  ranges: ContigRange[],
  opts: DetectHaplotigsOptions = {},
): HaplotigResult {
  const p = { ...DEFAULT_PARAMS, ...opts.params };
  const covByOrder = opts.coverageRatioByOrder ?? null;
  const coverageAvailable = !!covByOrder;
  const origByOrder = opts.originalIndexByOrder;
  const originalOf = (order: number): number =>
    origByOrder ? origByOrder[order] ?? order : order;

  const expected = computeExpectedContacts(matrix, size);
  const expectedAt = (d: number): number =>
    d >= 0 && d < expected.length ? Math.max(expected[d], p.denomFloor) : p.denomFloor;

  // Contact enrichment: for each resolvable contig, its brightest distant
  // partner's block O/E.
  const enrichment = new Float32Array(ranges.length).fill(NaN);
  const bestPartner = new Int32Array(ranges.length).fill(-1);

  for (let c = 0; c < ranges.length; c++) {
    const h = ranges[c];
    if (h.end - h.start < p.minContigBins) continue; // unresolvable at overview

    let best = 0;
    let bestP = -1;
    for (let q = 0; q < ranges.length; q++) {
      if (Math.abs(q - c) < p.minPartnerSeparation) continue; // skip self + cis-proximal
      const pr = ranges[q];
      if (pr.end - pr.start < p.minContigBins) continue;

      let sum = 0;
      let n = 0;
      for (let i = h.start; i < h.end; i++) {
        for (let j = pr.start; j < pr.end; j++) {
          const d = Math.abs(i - j);
          sum += matrix[i * size + j] / expectedAt(d);
          n++;
        }
      }
      if (n === 0) continue;
      const oe = sum / n;
      if (oe > best) {
        best = oe;
        bestP = q;
      }
    }
    if (bestP >= 0) {
      enrichment[c] = best;
      bestPartner[c] = bestP;
    }
  }

  // Robust threshold from the assembly's own enrichment distribution.
  const scored: number[] = [];
  for (let c = 0; c < enrichment.length; c++) {
    if (!Number.isNaN(enrichment[c])) scored.push(enrichment[c]);
  }
  const med = median(scored);
  const mad = median(scored.map((v) => Math.abs(v - med)));
  const enrichmentThreshold = Math.max(p.enrichmentFloor, med + p.k * mad);

  const candidates: HaplotigCandidate[] = [];
  for (let c = 0; c < ranges.length; c++) {
    const e = enrichment[c];
    const resolvable = !Number.isNaN(e);
    const contactFlag = resolvable && e >= enrichmentThreshold;

    const ratio = covByOrder ? covByOrder[c] : NaN;
    const coverageConfirmed = !Number.isNaN(ratio) && ratio <= p.halfCoverageMax;

    if (!contactFlag && !coverageConfirmed) continue;

    let confidence: HaplotigConfidence;
    if (contactFlag && coverageConfirmed) confidence = 'high';
    else if (contactFlag && !coverageAvailable) confidence = 'medium';
    else if (!contactFlag && coverageConfirmed) confidence = 'medium';
    else confidence = 'low'; // bright block but coverage is present and normal

    candidates.push({
      orderIndex: c,
      originalIndex: originalOf(c),
      partnerOrderIndex: contactFlag ? bestPartner[c] : -1,
      contactEnrichment: e,
      coverageRatio: ratio,
      coverageConfirmed,
      confidence,
      flagged: true,
    });
  }

  // Most suspect first: high before medium before low, then by enrichment.
  const rank: Record<HaplotigConfidence, number> = { high: 0, medium: 1, low: 2 };
  candidates.sort((a, b) => {
    if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence];
    const ea = Number.isNaN(a.contactEnrichment) ? 0 : a.contactEnrichment;
    const eb = Number.isNaN(b.contactEnrichment) ? 0 : b.contactEnrichment;
    return eb - ea;
  });

  return { candidates, flaggedCount: candidates.length, coverageAvailable };
}
