/**
 * TelomereDetector — Telomere repeat sequence detection and density profiling.
 *
 * Scans FASTA sequences for telomere repeat motifs (default TTAGGG / CCCTAA)
 * at contig ends, computes genome-wide density profiles, and produces
 * visualization tracks.
 *
 * Pure algorithm — no DOM dependencies or side effects.
 */

import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelomereParams {
  /** Forward repeat motif. Default: 'TTAGGG' */
  forwardMotif: string;
  /** Window size in base pairs for density calculation. Default: 10000 */
  windowSize: number;
  /** Minimum density (fraction of window) to call telomere presence. Default: 0.3 */
  minDensity: number;
}

export interface TelomereHit {
  contigIndex: number;
  contigName: string;
  end: '5p' | '3p';
  density: number;
  windowBp: number;
}

export interface TelomereResult {
  /** Per-window telomere density across the genome. */
  densityProfile: Float32Array;
  /** Total number of windows. */
  windowCount: number;
  /** Detected telomere hits at contig ends. */
  hits: TelomereHit[];
  /** Forward motif used. */
  forwardMotif: string;
  /** Reverse complement motif used. */
  reverseMotif: string;
}

const DEFAULT_PARAMS: TelomereParams = {
  forwardMotif: 'TTAGGG',
  windowSize: 10000,
  minDensity: 0.3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  T: 'A',
  C: 'G',
  G: 'C',
};

/** Reverse complement a DNA sequence (A<>T, C<>G). Handles uppercase. */
export function reverseComplement(seq: string): string {
  const upper = seq.toUpperCase();
  let rc = '';
  for (let i = upper.length - 1; i >= 0; i--) {
    rc += COMPLEMENT[upper[i]] ?? upper[i];
  }
  return rc;
}

/** Count non-overlapping occurrences of motif in sequence (case-insensitive). */
export function countMotifOccurrences(sequence: string, motif: string): number {
  if (motif.length === 0) return 0;
  const seqUpper = sequence.toUpperCase();
  const motifUpper = motif.toUpperCase();
  let count = 0;
  let pos = 0;
  while (pos <= seqUpper.length - motifUpper.length) {
    const idx = seqUpper.indexOf(motifUpper, pos);
    if (idx === -1) break;
    count++;
    pos = idx + motifUpper.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Detect telomere repeats in FASTA sequences and build a genome-wide density profile.
 *
 * For each contig, checks the first `windowSize` bp (5' end) and last `windowSize` bp
 * (3' end) for telomere repeat density. Both forward and reverse complement motifs are
 * tested at each end; the higher density is used. A hit is recorded when density >= minDensity.
 *
 * The genome-wide density profile divides the concatenated genome into windows and computes
 * telomere motif density (forward + reverse) in each.
 */
export function detectTelomeres(
  sequences: Map<string, string>,
  contigNames: string[],
  contigLengths: number[],
  params?: Partial<TelomereParams>,
): TelomereResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const fwd = p.forwardMotif.toUpperCase();
  const rev = reverseComplement(fwd);
  const motifLen = fwd.length;

  const hits: TelomereHit[] = [];

  // --- End detection ---
  for (let i = 0; i < contigNames.length; i++) {
    const name = contigNames[i];
    const seq = sequences.get(name);
    if (!seq) continue;

    const len = contigLengths[i];
    const actualLen = Math.min(seq.length, len);

    // 5' end
    const win5 = Math.min(p.windowSize, actualLen);
    if (win5 > 0) {
      const region5 = seq.substring(0, win5);
      const fwdCount5 = countMotifOccurrences(region5, fwd);
      const revCount5 = countMotifOccurrences(region5, rev);
      const density5 = Math.max(
        (fwdCount5 * motifLen) / win5,
        (revCount5 * motifLen) / win5,
      );
      if (density5 >= p.minDensity) {
        hits.push({
          contigIndex: i,
          contigName: name,
          end: '5p',
          density: density5,
          windowBp: win5,
        });
      }
    }

    // 3' end
    const win3 = Math.min(p.windowSize, actualLen);
    if (win3 > 0) {
      const region3 = seq.substring(Math.max(0, actualLen - win3), actualLen);
      const fwdCount3 = countMotifOccurrences(region3, fwd);
      const revCount3 = countMotifOccurrences(region3, rev);
      const density3 = Math.max(
        (fwdCount3 * motifLen) / win3,
        (revCount3 * motifLen) / win3,
      );
      if (density3 >= p.minDensity) {
        hits.push({
          contigIndex: i,
          contigName: name,
          end: '3p',
          density: density3,
          windowBp: win3,
        });
      }
    }
  }

  // --- Genome-wide density profile ---
  const totalBp = contigLengths.reduce((a, b) => a + b, 0);
  const windowCount = totalBp > 0 ? Math.max(1, Math.ceil(totalBp / p.windowSize)) : 0;
  const densityProfile = new Float32Array(windowCount);

  if (windowCount > 0 && totalBp > 0) {
    let genomicOffset = 0;

    for (let i = 0; i < contigNames.length; i++) {
      const name = contigNames[i];
      const seq = sequences.get(name);
      const len = contigLengths[i];
      if (!seq) {
        genomicOffset += len;
        continue;
      }

      const actualLen = Math.min(seq.length, len);

      // Walk through windows that overlap this contig
      const contigStart = genomicOffset;
      const contigEnd = genomicOffset + len;

      const firstWindow = Math.floor(contigStart / p.windowSize);
      const lastWindow = Math.min(
        Math.ceil(contigEnd / p.windowSize) - 1,
        windowCount - 1,
      );

      for (let w = firstWindow; w <= lastWindow; w++) {
        const winStart = w * p.windowSize;
        const winEnd = Math.min((w + 1) * p.windowSize, totalBp);

        // Overlap between this window and this contig
        const overlapStart = Math.max(winStart, contigStart);
        const overlapEnd = Math.min(winEnd, contigEnd);
        if (overlapStart >= overlapEnd) continue;

        // Map to sequence coordinates
        const seqStart = overlapStart - contigStart;
        const seqEnd = Math.min(overlapEnd - contigStart, actualLen);
        if (seqStart >= seqEnd) continue;

        const region = seq.substring(seqStart, seqEnd);
        const fwdCount = countMotifOccurrences(region, fwd);
        const revCount = countMotifOccurrences(region, rev);
        const regionLen = seqEnd - seqStart;

        // Add density contribution (weighted by fraction of window this region covers)
        const windowLen = winEnd - winStart;
        const coverage = (fwdCount + revCount) * motifLen;
        densityProfile[w] += coverage / windowLen;
      }

      genomicOffset += len;
    }

    // Clamp to [0, 1]
    for (let i = 0; i < windowCount; i++) {
      if (densityProfile[i] > 1) densityProfile[i] = 1;
    }
  }

  return {
    densityProfile,
    windowCount,
    hits,
    forwardMotif: fwd,
    reverseMotif: rev,
  };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/** Convert telomere density profile to a visualization track. */
export function telomereToTrack(
  result: TelomereResult,
  totalPixels: number,
): TrackConfig {
  const data = new Float32Array(totalPixels);
  const { densityProfile, windowCount } = result;

  if (windowCount > 0) {
    for (let tp = 0; tp < totalPixels; tp++) {
      const wp = Math.min(
        Math.floor((tp / totalPixels) * windowCount),
        windowCount - 1,
      );
      data[tp] = densityProfile[wp];
    }
  }

  return {
    name: 'Telomere Repeats',
    type: 'line',
    data,
    color: '#00e676',
    height: 30,
    visible: true,
  };
}
