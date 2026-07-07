/**
 * MisassemblyDetector — Detect potential misassemblies using 3D genomics signals.
 *
 * TAD boundaries and compartment sign-changes that fall inside a contig
 * (not at contig edges) suggest the contig may be chimeric. This module
 * identifies such internal signals and flags the affected contigs.
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';
import type { InsulationResult } from './InsulationScore';
import type { CompartmentResult } from './CompartmentAnalysis';
import type { ContigRange } from '../curation/AutoSort';
import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MisassemblyReason = 'tad_boundary' | 'compartment_switch' | 'both';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface CutConfidence {
  /** Composite score from 0 to 1. */
  score: number;
  /** Discretized level: high >= 0.7, medium >= 0.4, low < 0.4. */
  level: ConfidenceLevel;
  /** Per-component scores (each 0-1). */
  components: { tad: number; compartment: number };
}

export interface MisassemblyFlag {
  /** Position in contigOrder array. */
  orderIndex: number;
  /** Overview pixel where the signal fires. */
  overviewPixel: number;
  /** What triggered the flag. */
  reason: MisassemblyReason;
  /** Signal strength (boundary prominence or eigenvector delta). */
  strength: number;
}

export interface MisassemblyResult {
  /** All individual flags across all contigs. */
  flags: MisassemblyFlag[];
  /** Set of orderIndices with at least one flag. */
  flaggedContigs: Set<number>;
  /** Summary counts by reason. */
  summary: {
    tadOnly: number;
    compartmentOnly: number;
    both: number;
    total: number;
  };
}

export interface MisassemblyParams {
  /** Min pixels from contig edge to consider a signal internal. Default: 2. */
  edgeMargin: number;
  /** Max pixel distance to merge a TAD boundary and compartment switch. Default: 3. */
  mergeRadius: number;
  /** Contigs spanning fewer than this many overview pixels are flagged only when
   *  a TAD boundary and a compartment switch agree (merged 'both'). Guards
   *  microchromosome / fragmented assemblies from single-signal false positives.
   *  Default: 10. */
  smallContigSpan: number;
  /** Minimum eigenvector delta at a sign change, as a fraction of the largest
   *  |eigenvector| value, for a compartment switch to count. Suppresses the
   *  noisy near-zero sign oscillations that dominate weak/fragmented genomes.
   *  Default: 0.25. */
  compartmentDeltaFrac: number;
}

const DEFAULT_PARAMS: MisassemblyParams = {
  edgeMargin: 2,
  mergeRadius: 3,
  smallContigSpan: 10,
  compartmentDeltaFrac: 0.25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findOwningContig(pixel: number, ranges: ContigRange[]): ContigRange | null {
  for (const r of ranges) {
    if (pixel >= r.start && pixel < r.end) return r;
  }
  return null;
}

function isInternal(pixel: number, range: ContigRange, margin: number): boolean {
  return (pixel - range.start) >= margin && (range.end - pixel) > margin;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect potential misassemblies from insulation and compartment results.
 *
 * Signals that fall inside a contig (beyond the edge margin) are flagged.
 * If a TAD boundary and compartment switch are within mergeRadius of each
 * other in the same contig, they are merged into a single 'both' flag.
 */
export function detectMisassemblies(
  insulation: InsulationResult,
  compartments: CompartmentResult,
  contigRanges: ContigRange[],
  params?: Partial<MisassemblyParams>,
): MisassemblyResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const minContigSpan = 2 * p.edgeMargin + 1;

  // Filter to contigs large enough to have internal signals
  const validRanges = contigRanges.filter(r => (r.end - r.start) >= minContigSpan);

  // Collect raw signals: { pixel, orderIndex, type, strength }
  interface RawSignal {
    pixel: number;
    orderIndex: number;
    type: 'tad' | 'compartment';
    strength: number;
  }
  const signals: RawSignal[] = [];

  // Internal TAD boundaries
  for (let i = 0; i < insulation.boundaries.length; i++) {
    const b = insulation.boundaries[i];
    const range = findOwningContig(b, validRanges);
    if (range && isInternal(b, range, p.edgeMargin)) {
      signals.push({
        pixel: b,
        orderIndex: range.orderIndex,
        type: 'tad',
        strength: insulation.boundaryStrengths[i],
      });
    }
  }

  // Internal compartment sign-changes. Gate on delta magnitude relative to the
  // eigenvector's own scale: on fragmented / low-coverage genomes the eigenvector
  // barely departs from its alternating power-iteration seed and flips sign at
  // nearly every pixel with vanishing deltas — noise, not real A/B transitions.
  const ev = compartments.eigenvector;
  let maxAbsEV = 0;
  for (let i = 0; i < ev.length; i++) {
    const a = Math.abs(ev[i]);
    if (a > maxAbsEV) maxAbsEV = a;
  }
  const minDelta = maxAbsEV * p.compartmentDeltaFrac;
  for (let i = 1; i < ev.length; i++) {
    if (ev[i] * ev[i - 1] < 0) {
      const delta = Math.abs(ev[i] - ev[i - 1]);
      if (delta < minDelta) continue; // skip weak/noisy sign flips
      const range = findOwningContig(i, validRanges);
      if (range && isInternal(i, range, p.edgeMargin)) {
        signals.push({
          pixel: i,
          orderIndex: range.orderIndex,
          type: 'compartment',
          strength: delta,
        });
      }
    }
  }

  // Merge nearby TAD + compartment signals in the same contig
  const flags: MisassemblyFlag[] = [];
  const merged = new Set<number>(); // indices into signals that were merged

  for (let a = 0; a < signals.length; a++) {
    if (merged.has(a)) continue;
    const sa = signals[a];

    // Look for a partner of different type in same contig within mergeRadius
    let bestPartner = -1;
    let bestDist = Infinity;
    for (let b = 0; b < signals.length; b++) {
      if (b === a || merged.has(b)) continue;
      const sb = signals[b];
      if (sb.orderIndex !== sa.orderIndex) continue;
      if (sb.type === sa.type) continue;
      const dist = Math.abs(sb.pixel - sa.pixel);
      if (dist <= p.mergeRadius && dist < bestDist) {
        bestPartner = b;
        bestDist = dist;
      }
    }

    if (bestPartner >= 0) {
      merged.add(a);
      merged.add(bestPartner);
      const sb = signals[bestPartner];
      flags.push({
        orderIndex: sa.orderIndex,
        overviewPixel: Math.round((sa.pixel + sb.pixel) / 2),
        reason: 'both',
        strength: sa.strength + sb.strength,
      });
    } else {
      flags.push({
        orderIndex: sa.orderIndex,
        overviewPixel: sa.pixel,
        reason: sa.type === 'tad' ? 'tad_boundary' : 'compartment_switch',
        strength: sa.strength,
      });
    }
  }

  // Small contigs cannot reliably localize an internal break from a single
  // signal; require corroborating TAD + compartment agreement ('both') before
  // flagging them. Large contigs still flag on either signal alone, so genuine
  // chimeras survive.
  const spanByOrder = new Map<number, number>();
  for (const r of validRanges) spanByOrder.set(r.orderIndex, r.end - r.start);
  const keptFlags = flags.filter(
    f => f.reason === 'both' || (spanByOrder.get(f.orderIndex) ?? 0) >= p.smallContigSpan,
  );

  // Build summary
  const flaggedContigs = new Set<number>();
  let tadOnly = 0, compartmentOnly = 0, both = 0;
  for (const f of keptFlags) {
    flaggedContigs.add(f.orderIndex);
    if (f.reason === 'tad_boundary') tadOnly++;
    else if (f.reason === 'compartment_switch') compartmentOnly++;
    else both++;
  }

  return {
    flags: keptFlags,
    flaggedContigs,
    summary: { tadOnly, compartmentOnly, both, total: keptFlags.length },
  };
}

// ---------------------------------------------------------------------------
// Track generation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cut suggestions
// ---------------------------------------------------------------------------

export interface CutSuggestion {
  /** Position in contigOrder array. */
  orderIndex: number;
  /** Index into map.contigs array. */
  contigId: number;
  /** Human-readable contig name. */
  contigName: string;
  /** Texture-space pixel offset within the contig (parameter for CurationEngine.cut). */
  pixelOffset: number;
  /** Overview-pixel position of the originating flag (for confidence scoring). */
  overviewPixel: number;
  /** What triggered this suggestion. */
  reason: MisassemblyReason;
  /** Signal strength / confidence. */
  strength: number;
  /** Composite confidence from multiple signals (populated by scoreCutConfidence). */
  confidence?: CutConfidence;
}

/**
 * Convert misassembly flags to actionable cut suggestions.
 *
 * Each flag's overview pixel is converted to a texture-space pixel offset
 * within the owning contig, suitable for passing to `CurationEngine.cut()`.
 * Results are sorted by orderIndex descending for right-to-left batch execution.
 */
export function buildCutSuggestions(
  flags: MisassemblyFlag[],
  contigRanges: ContigRange[],
  contigs: ContigInfo[],
  contigOrder: number[],
): CutSuggestion[] {
  const rangeByOrder = new Map<number, ContigRange>();
  for (const r of contigRanges) {
    rangeByOrder.set(r.orderIndex, r);
  }

  const suggestions: CutSuggestion[] = [];

  for (const flag of flags) {
    const range = rangeByOrder.get(flag.orderIndex);
    if (!range) continue;

    const rangeSpan = range.end - range.start;
    if (rangeSpan <= 0) continue;

    const contigId = contigOrder[flag.orderIndex];
    if (contigId == null) continue;
    const contig = contigs[contigId];
    if (!contig) continue;

    const contigPixelLength = contig.pixelEnd - contig.pixelStart;
    if (contigPixelLength <= 1) continue;

    // Convert overview pixel to fractional position within contig
    const fraction = (flag.overviewPixel - range.start) / rangeSpan;
    let pixelOffset = Math.round(fraction * contigPixelLength);

    // Clamp to valid range for cut() — must be > 0 and < contigPixelLength
    pixelOffset = Math.max(1, Math.min(pixelOffset, contigPixelLength - 1));

    suggestions.push({
      orderIndex: flag.orderIndex,
      contigId,
      contigName: contig.name,
      pixelOffset,
      overviewPixel: flag.overviewPixel,
      reason: flag.reason,
      strength: flag.strength,
    });
  }

  // Sort descending by orderIndex for right-to-left batch execution
  suggestions.sort((a, b) => b.orderIndex - a.orderIndex);

  return suggestions;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Compute composite confidence scores for cut suggestions by fusing TAD
 * boundary strength and compartment eigenvector delta at each suggestion's own
 * overview pixel.
 *
 * Weights: TAD 0.6, compartment 0.4 (each normalized to 0-1 before weighting).
 *
 * A third "local P(s) decay anomaly" component was removed: there was no real
 * per-pixel decay signal to feed it (the caller had been passing the insulation
 * profile as a proxy), and it added no independent information. The confidence
 * is now honestly the fusion of the two signals that actually vary.
 *
 * Mutates each suggestion's `confidence` field in-place.
 */
export function scoreCutConfidence(
  suggestions: CutSuggestion[],
  flags: MisassemblyFlag[],
  eigenvector: Float32Array | null,
): void {
  if (suggestions.length === 0) return;

  // Find max flag strength for normalizing the TAD component.
  let maxStrength = 0;
  for (const f of flags) {
    if (f.strength > maxStrength) maxStrength = f.strength;
  }
  if (maxStrength === 0) maxStrength = 1;

  for (const suggestion of suggestions) {
    const overviewPixel = suggestion.overviewPixel;

    // TAD component: this suggestion's normalized boundary strength.
    const tadScore = Math.min(1, Math.max(0, suggestion.strength / maxStrength));

    // Compartment component: eigenvector delta at the suggestion's own pixel.
    let compScore = 0;
    if (eigenvector && overviewPixel > 0 && overviewPixel < eigenvector.length) {
      const delta = Math.abs(eigenvector[overviewPixel] - eigenvector[overviewPixel - 1]);
      // Typical deltas range 0-2; tanh gives soft saturation.
      compScore = Math.tanh(delta * 2);
    }

    const score = Math.min(1, Math.max(0, 0.6 * tadScore + 0.4 * compScore));
    suggestion.confidence = {
      score,
      level: confidenceLevel(score),
      components: { tad: tadScore, compartment: compScore },
    };
  }
}

// ---------------------------------------------------------------------------
// Track generation
// ---------------------------------------------------------------------------

/**
 * Convert misassembly flags to a marker track for display.
 */
export function misassemblyToTrack(
  result: MisassemblyResult,
  overviewSize: number,
  textureSize: number,
): TrackConfig {
  const data = new Float32Array(textureSize);

  for (const flag of result.flags) {
    const tp = Math.round((flag.overviewPixel / overviewSize) * textureSize);
    if (tp >= 0 && tp < textureSize) {
      data[tp] = 1;
    }
  }

  return {
    name: 'Misassembly Flags',
    type: 'marker',
    data,
    color: '#ffa500',
    height: 20,
    visible: true,
  };
}
