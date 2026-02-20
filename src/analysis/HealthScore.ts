/**
 * HealthScore — Composite assembly quality score (0–100).
 *
 * Combines four quality dimensions: contiguity (N50), P(s) decay exponent,
 * misassembly count, and compartment eigenvalue into a single score.
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
  };
}

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

/**
 * Contiguity: N50 relative to total length, scaled by contig count.
 * If N50 = totalLength (single contig), score = 100.
 */
function scoreContiguity(n50: number, totalLength: number, contigCount: number): number {
  if (totalLength <= 0 || contigCount <= 0) return 0;
  const ratio = n50 / totalLength;
  const score = ratio * contigCount * 100;
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

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute a composite assembly health score (0–100).
 *
 * Four equally-weighted components (25% each):
 * - Contiguity: N50 relative to total assembly length
 * - Decay quality: P(s) exponent proximity to ideal Hi-C range
 * - Integrity: Penalty for detected misassemblies
 * - Compartments: A/B compartment eigenvalue strength
 */
export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const contiguity = scoreContiguity(input.n50, input.totalLength, input.contigCount);
  const decayQuality = scoreDecayQuality(input.decayExponent);
  const integrity = scoreIntegrity(input.misassemblyCount);
  const compartments = scoreCompartments(input.eigenvalue);

  const overall = Math.round(
    (contiguity + decayQuality + integrity + compartments) / 4,
  );

  return {
    overall: Math.max(0, Math.min(100, overall)),
    components: { contiguity, decayQuality, integrity, compartments },
  };
}
