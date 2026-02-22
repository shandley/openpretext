/**
 * HealthScore — Composite assembly quality score (0–100).
 *
 * Combines five quality dimensions: contiguity (N50), P(s) decay exponent,
 * misassembly count, compartment eigenvalue, and library quality (cis/trans)
 * into a single score.
 *
 * Pure algorithm — no side effects or state mutations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthScoreInput {
  n50: number;
  totalLength: number;
  contigCount: number;
  /** P(s) decay exponent. Null if not computed. */
  decayExponent: number | null;
  /** R-squared of P(s) fit. Null if not computed. */
  decayRSquared: number | null;
  /** Number of flagged misassemblies. */
  misassemblyCount: number;
  /** First eigenvalue from compartment analysis. Null if not computed. */
  eigenvalue: number | null;
  /** Cis/trans ratio from Hi-C quality metrics. Null if not computed. */
  cisTransRatio: number | null;
}

export interface HealthScoreResult {
  /** Composite score 0–100. */
  overall: number;
  /** Individual component scores, each 0–100. */
  components: {
    contiguity: number;
    decayQuality: number;
    integrity: number;
    compartments: number;
    libraryQuality: number;
  };
}

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

/**
 * Contiguity: N50 as a fraction of total length.
 * A single-contig assembly (N50 = totalLength) scores 100.
 * Uses a log-scaled approach so the score degrades gracefully:
 *   score = 100 * (1 + log10(N50/totalLength)) / 1
 * N50/total = 1.0 → 100, N50/total = 0.1 → 0, N50/total < 0.1 → 0
 */
function scoreContiguity(n50: number, totalLength: number, _contigCount: number): number {
  if (totalLength <= 0 || n50 <= 0) return 0;
  const ratio = n50 / totalLength;
  if (ratio >= 1) return 100;
  if (ratio <= 0.1) return 0;
  // log10(0.1) = -1, log10(1) = 0 → maps to [0, 100]
  const score = (1 + Math.log10(ratio)) * 100;
  return Math.max(0, Math.min(100, score));
}

/**
 * Decay quality: P(s) exponent should be in [-1.5, -0.8] for well-assembled Hi-C.
 * Score based on distance from ideal center (-1.15).
 */
function scoreDecayQuality(exponent: number | null): number {
  if (exponent === null) return 50;
  const ideal = -1.15;
  const maxDeviation = 0.85;
  const distance = Math.abs(exponent - ideal);
  return Math.max(0, Math.min(100, 100 - (distance / maxDeviation) * 100));
}

/**
 * Integrity: Penalty for detected misassemblies.
 * Each misassembly costs 10 points from a base of 100.
 */
function scoreIntegrity(misassemblyCount: number): number {
  return Math.max(0, Math.min(100, 100 - misassemblyCount * 10));
}

/**
 * Compartments: Eigenvalue indicates A/B compartment separation strength.
 * Higher eigenvalue = better signal.
 */
function scoreCompartments(eigenvalue: number | null): number {
  if (eigenvalue === null) return 50;
  return Math.max(0, Math.min(100, eigenvalue * 200));
}

/**
 * Library quality: Cis/trans ratio indicates Hi-C library quality.
 * Good libraries have cis ratio >= 0.7 (70% intra-chromosomal).
 */
function scoreLibraryQuality(cisTransRatio: number | null): number {
  if (cisTransRatio === null) return 50;
  return Math.max(0, Math.min(100, (cisTransRatio / 0.7) * 100));
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute a composite assembly health score (0–100).
 *
 * Five weighted components:
 * - Contiguity (20%): N50 relative to total assembly length
 * - Decay quality (25%): P(s) exponent proximity to ideal Hi-C range
 * - Integrity (20%): Penalty for detected misassemblies
 * - Compartments (15%): A/B compartment eigenvalue strength
 * - Library quality (20%): Cis/trans ratio
 */
export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const contiguity = scoreContiguity(input.n50, input.totalLength, input.contigCount);
  const decayQuality = scoreDecayQuality(input.decayExponent);
  const integrity = scoreIntegrity(input.misassemblyCount);
  const compartments = scoreCompartments(input.eigenvalue);
  const libraryQuality = scoreLibraryQuality(input.cisTransRatio);

  const overall = Math.round(
    contiguity * 0.20 +
    decayQuality * 0.25 +
    integrity * 0.20 +
    compartments * 0.15 +
    libraryQuality * 0.20,
  );

  return {
    overall: Math.max(0, Math.min(100, overall)),
    components: { contiguity, decayQuality, integrity, compartments, libraryQuality },
  };
}
