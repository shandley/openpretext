/**
 * PatternDetector — Algorithmic detection of inversions and translocations
 * from the Hi-C contact map.
 *
 * Inversions appear as anti-diagonal (butterfly) signals within a contig.
 * Translocations appear as off-diagonal contact enrichment between
 * non-adjacent contigs.
 *
 * Pure algorithm — no DOM dependencies.
 */

import type { ContigRange } from '../curation/AutoSort';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
  /** Pattern type. */
  type: 'inversion' | 'translocation';
  /** Primary region in overview bins. */
  region: { startBin: number; endBin: number };
  /** Second region (for translocations). */
  region2?: { startBin: number; endBin: number };
  /** Signal strength (0-1 normalized). */
  strength: number;
  /** Human-readable description. */
  description: string;
}

// ---------------------------------------------------------------------------
// Inversion detection
// ---------------------------------------------------------------------------

/**
 * Detect inversions by comparing anti-diagonal to diagonal signal
 * within each contig's block on the contact map.
 *
 * An inversion produces a characteristic "butterfly" pattern where
 * anti-diagonal contacts are elevated relative to the main diagonal.
 *
 * @param contactMap Row-major symmetric contact matrix.
 * @param mapSize Dimension of the square matrix.
 * @param contigRanges Bin ranges for each contig.
 * @param threshold Min anti/diagonal ratio to flag (default 0.6).
 */
export function detectInversions(
  contactMap: Float32Array,
  mapSize: number,
  contigRanges: ContigRange[],
  threshold = 2.0,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const range of contigRanges) {
    const span = range.end - range.start;
    if (span < 4) continue; // too small

    // Compare contacts at large genomic distances:
    // - "diagonal baseline": mean contact at distance >= span/3 from diagonal
    // - "anti-diagonal": mean contact along the block anti-diagonal at those same distances
    // An inversion elevates anti-diagonal contacts at large distances.
    const minDist = Math.max(2, Math.ceil(span / 3));

    let diagSum = 0;
    let diagCount = 0;
    let antiDiagSum = 0;
    let antiDiagCount = 0;

    // Sample contacts at large distances from diagonal (background)
    for (let i = range.start; i < range.end; i++) {
      for (let d = minDist; d < span; d++) {
        const j = i + d;
        if (j >= range.end) break;
        const val = contactMap[i * mapSize + j];
        diagSum += val;
        diagCount++;
      }
    }

    // Sample contacts along the anti-diagonal of the block (at large distances)
    // Anti-diagonal: j = (range.start + range.end - 1) - i
    for (let i = range.start; i < range.end; i++) {
      const antiJ = (range.start + range.end - 1) - i;
      if (antiJ <= i || antiJ >= range.end || antiJ < range.start) continue;
      const dist = antiJ - i;
      if (dist < minDist) continue; // only large-distance contacts
      const val = contactMap[i * mapSize + antiJ];
      antiDiagSum += val;
      antiDiagCount++;
    }

    const diagMean = diagCount > 0 ? diagSum / diagCount : 0;
    const antiDiagMean = antiDiagCount > 0 ? antiDiagSum / antiDiagCount : 0;

    if (diagMean <= 0) continue;
    const ratio = antiDiagMean / diagMean;

    if (ratio >= threshold) {
      const strength = Math.min(1, (ratio - threshold) / (threshold * 2));
      patterns.push({
        type: 'inversion',
        region: { startBin: range.start, endBin: range.end },
        strength,
        description: `Inversion signal in contig at bins ${range.start}-${range.end} (ratio: ${ratio.toFixed(2)})`,
      });
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Translocation detection
// ---------------------------------------------------------------------------

/**
 * Detect translocations by looking for elevated contact frequency
 * between non-adjacent contig pairs.
 *
 * Adjacent contigs naturally have high contact; translocations produce
 * elevated contacts between contigs separated by >= 2 positions.
 *
 * @param contactMap Row-major symmetric contact matrix.
 * @param mapSize Dimension of the square matrix.
 * @param contigRanges Bin ranges for each contig.
 * @param threshold Min observed/expected ratio to flag (default 2.0).
 */
export function detectTranslocations(
  contactMap: Float32Array,
  mapSize: number,
  contigRanges: ContigRange[],
  threshold = 2.0,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  if (contigRanges.length < 3) return patterns;

  // Compute genome-wide background contact rate at various distances
  let totalContact = 0;
  let totalPixels = 0;
  for (let i = 0; i < mapSize; i++) {
    for (let j = i + 1; j < mapSize; j++) {
      const v = contactMap[i * mapSize + j];
      if (v > 0) {
        totalContact += v;
        totalPixels++;
      }
    }
  }
  const bgRate = totalPixels > 0 ? totalContact / totalPixels : 0;
  if (bgRate <= 0) return patterns;

  // Check all pairs of non-adjacent contigs
  for (let a = 0; a < contigRanges.length; a++) {
    for (let b = a + 2; b < contigRanges.length; b++) {
      const rA = contigRanges[a];
      const rB = contigRanges[b];
      const spanA = rA.end - rA.start;
      const spanB = rB.end - rB.start;
      if (spanA < 2 || spanB < 2) continue;

      // Compute mean contact in the off-diagonal block
      let blockSum = 0;
      let blockCount = 0;
      for (let i = rA.start; i < rA.end; i++) {
        for (let j = rB.start; j < rB.end; j++) {
          const v = contactMap[i * mapSize + j];
          if (v > 0) {
            blockSum += v;
            blockCount++;
          }
        }
      }

      if (blockCount === 0) continue;
      const blockMean = blockSum / blockCount;
      const oeRatio = blockMean / bgRate;

      if (oeRatio >= threshold) {
        const strength = Math.min(1, (oeRatio - threshold) / (threshold * 2));
        patterns.push({
          type: 'translocation',
          region: { startBin: rA.start, endBin: rA.end },
          region2: { startBin: rB.start, endBin: rB.end },
          strength,
          description: `Translocation: contigs at ${rA.start}-${rA.end} and ${rB.start}-${rB.end} (O/E: ${oeRatio.toFixed(2)})`,
        });
      }
    }
  }

  // Sort by strength descending
  patterns.sort((a, b) => b.strength - a.strength);
  return patterns;
}
