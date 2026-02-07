/**
 * Extract ground truth contig ordering from curated .pretext files.
 *
 * A curated file has contigs already arranged in the correct order,
 * potentially with splits (indicated by _L/_R suffixes) and joins.
 *
 * Chromosome detection uses name-based identification (primary) since
 * GenomeArk curated assemblies follow consistent naming conventions:
 *   SUPER_N, Super_Scaffold_N, chrN  -> chromosome N
 *   SUPER_N_unloc_M                  -> unlocalized on chromosome N
 *   Scaffold_*, scaffold_*_ctg*      -> unplaced
 *
 * Falls back to signal-based detection when naming is ambiguous.
 */

import type { ContigInfo } from '../src/core/State';
import type { LoadedAssembly } from './loader';

export interface GroundTruth {
  /** Contig names in the curated order. */
  contigNames: string[];
  /** Contig order indices in the curated order. */
  contigOrder: number[];
  /** Detected chromosome boundaries (indices in contigOrder where a new chromosome starts). */
  chromosomeBoundaries: number[];
  /** Chromosome assignments: contigOrder index -> chromosome index. */
  chromosomeAssignments: number[];
  /** Detected splits: original contig name -> { leftName, rightName }. */
  splits: Map<string, { leftName: string; rightName: string }>;
  /** Contigs array from the curated assembly. */
  contigs: ContigInfo[];
}

/**
 * Detect _L/_R split pairs in a contig list.
 * Returns a map from base contig name to its left/right fragment names.
 */
export function detectSplits(contigs: ContigInfo[]): Map<string, { leftName: string; rightName: string }> {
  const splits = new Map<string, { leftName: string; rightName: string }>();
  const nameSet = new Set(contigs.map(c => c.name));

  for (const contig of contigs) {
    if (contig.name.endsWith('_L')) {
      const baseName = contig.name.slice(0, -2);
      const rightName = `${baseName}_R`;
      if (nameSet.has(rightName)) {
        splits.set(baseName, { leftName: contig.name, rightName });
      }
    }
  }

  return splits;
}

// Patterns for chromosome-level scaffold names in GenomeArk curated assemblies
const CHROM_PATTERNS: RegExp[] = [
  /^SUPER_(\w+?)(?:_unloc_\d+)?$/,       // SUPER_1, SUPER_Z, SUPER_1_unloc_3
  /^Super_Scaffold_(\w+)$/,               // Super_Scaffold_1, Super_Scaffold_Z
  /^chr(\w+)$/i,                          // chr1, chrZ, chrX
  /^chromosome[_-]?(\w+)$/i,             // Chromosome_1, Chromosome1
  /^LG[_-]?(\w+)$/i,                     // LG1, LG_1
  /^HiC_scaffold_(\d+)$/i,               // HiC_scaffold_1
];

/**
 * Extract chromosome identifier from a contig name using GenomeArk naming conventions.
 * Returns the chromosome label (e.g., "1", "Z", "1A") or null if not a chromosome.
 */
export function extractChromosomeLabel(name: string): string | null {
  for (const pattern of CHROM_PATTERNS) {
    const match = name.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Detect chromosome assignments by parsing contig names.
 *
 * In curated GenomeArk assemblies, chromosome-level scaffolds follow
 * naming conventions (SUPER_N, Super_Scaffold_N, chrN). Unlocalized
 * scaffolds (SUPER_N_unloc_M) are assigned to their parent chromosome.
 * Unplaced scaffolds get a shared "unplaced" chromosome group.
 */
export function detectChromosomesByName(
  contigs: ContigInfo[],
  contigOrder: number[],
): { assignments: number[]; boundaries: number[]; numNamed: number } {
  // Map each contig to its chromosome label
  // extractChromosomeLabel handles SUPER_N_unloc_M -> "N" via regex
  const labels: (string | null)[] = contigOrder.map(idx =>
    extractChromosomeLabel(contigs[idx].name),
  );

  // Build label -> chromosome index mapping (preserve order of first appearance)
  const labelToIdx = new Map<string, number>();
  let nextIdx = 0;
  for (const label of labels) {
    if (label !== null && !labelToIdx.has(label)) {
      labelToIdx.set(label, nextIdx++);
    }
  }

  const numNamed = labels.filter(l => l !== null).length;

  // Unplaced contigs get their own group index
  const unplacedIdx = nextIdx;

  // Assign chromosome indices
  const assignments = labels.map(label =>
    label !== null ? labelToIdx.get(label)! : unplacedIdx,
  );

  // Detect boundaries (where chromosome index changes)
  const boundaries: number[] = [0];
  for (let i = 1; i < assignments.length; i++) {
    if (assignments[i] !== assignments[i - 1]) {
      boundaries.push(i);
    }
  }

  return { assignments, boundaries, numNamed };
}

/**
 * Detect chromosome boundaries by analyzing signal drops between
 * adjacent contigs in the contact map.
 *
 * Improved version: merges tiny contigs into virtual ranges for signal
 * analysis, uses percentile-based adaptive thresholding, and applies
 * an aggressive fallback when too few boundaries are found.
 */
export function detectChromosomeBoundariesBySignal(
  assembly: LoadedAssembly,
  dropThreshold: number = 0.3,
): number[] {
  const { contactMap, overviewSize, contigs, contigOrder, textureSize } = assembly;
  const boundaries: number[] = [0];

  // Compute overview pixel ranges for each contig
  const ranges: Array<{ start: number; end: number }> = [];
  let accumulated = 0;
  for (const idx of contigOrder) {
    const contig = contigs[idx];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;
    const start = Math.round((accumulated / textureSize) * overviewSize);
    accumulated += contigPixelLength;
    const end = Math.round((accumulated / textureSize) * overviewSize);
    ranges.push({ start, end });
  }

  const MIN_CONTIG_PIXELS = 3;

  // Merge consecutive tiny contigs into virtual ranges for signal analysis.
  // This handles assemblies where many contigs are < MIN_CONTIG_PIXELS wide.
  const mergedRanges: Array<{ start: number; end: number; contigIndices: number[] }> = [];
  let currentRange: { start: number; end: number; contigIndices: number[] } | null = null;

  for (let i = 0; i < ranges.length; i++) {
    const width = ranges[i].end - ranges[i].start;
    if (width >= MIN_CONTIG_PIXELS) {
      // Large enough contig — flush any accumulated tiny contigs first
      if (currentRange) {
        mergedRanges.push(currentRange);
        currentRange = null;
      }
      mergedRanges.push({ start: ranges[i].start, end: ranges[i].end, contigIndices: [i] });
    } else {
      // Tiny contig — accumulate into current range
      if (!currentRange) {
        currentRange = { start: ranges[i].start, end: ranges[i].end, contigIndices: [i] };
      } else {
        currentRange.end = ranges[i].end;
        currentRange.contigIndices.push(i);
      }
      // If accumulated range is big enough, flush it
      if (currentRange.end - currentRange.start >= MIN_CONTIG_PIXELS) {
        mergedRanges.push(currentRange);
        currentRange = null;
      }
    }
  }
  if (currentRange && currentRange.end - currentRange.start >= MIN_CONTIG_PIXELS) {
    mergedRanges.push(currentRange);
  }

  // Compute adjacent pair signal strengths between merged ranges
  const pairSignals: { index: number; signal: number }[] = [];

  for (let i = 0; i < mergedRanges.length - 1; i++) {
    const rangeA = mergedRanges[i];
    const rangeB = mergedRanges[i + 1];
    const widthA = rangeA.end - rangeA.start;
    const widthB = rangeB.end - rangeB.start;

    let sum = 0;
    let count = 0;
    const sampleSize = Math.min(10, Math.min(widthA, widthB));

    for (let dy = 0; dy < sampleSize; dy++) {
      for (let dx = 0; dx < sampleSize; dx++) {
        const x = rangeB.start + dx;
        const y = rangeA.end - sampleSize + dy;
        if (x < overviewSize && y >= 0 && y < overviewSize) {
          sum += contactMap[y * overviewSize + x];
          count++;
        }
      }
    }

    pairSignals.push({ index: i, signal: count > 0 ? sum / count : 0 });
  }

  if (pairSignals.length === 0) return boundaries;

  // Use mean of non-zero signals as baseline (more robust than median when sparse)
  const nonZero = pairSignals.filter(p => p.signal > 0);
  if (nonZero.length === 0) return boundaries;

  const baseline = nonZero.reduce((s, p) => s + p.signal, 0) / nonZero.length;

  // Use percentile-based threshold: boundaries are where signal drops
  // below the 25th percentile of non-zero pair signals
  const sortedSignals = [...nonZero.map(p => p.signal)].sort((a, b) => a - b);
  const p25 = sortedSignals[Math.floor(sortedSignals.length * 0.25)] ?? 0;
  const threshold = Math.min(baseline * dropThreshold, p25);

  // Detect boundaries where signal drops below threshold
  for (const pair of pairSignals) {
    if (pair.signal < threshold) {
      // Map merged range index back to original contig index
      const nextRange = mergedRanges[pair.index + 1];
      if (nextRange) {
        boundaries.push(nextRange.contigIndices[0]);
      }
    }
  }

  // If signal analysis found very few boundaries, try more aggressive threshold
  if (boundaries.length <= 1 && pairSignals.length > 5) {
    const aggressiveThreshold = threshold * 2;
    for (const pair of pairSignals) {
      if (pair.signal < aggressiveThreshold) {
        const nextRange = mergedRanges[pair.index + 1];
        if (nextRange) {
          const mappedIndex = nextRange.contigIndices[0];
          if (!boundaries.includes(mappedIndex)) {
            boundaries.push(mappedIndex);
          }
        }
      }
    }
  }

  return boundaries;
}

/**
 * Build chromosome assignments from boundaries.
 * Each contig is assigned to a chromosome index based on which
 * boundary interval it falls into.
 */
export function buildChromosomeAssignments(
  numContigs: number,
  boundaries: number[],
): number[] {
  const assignments = new Array<number>(numContigs);
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  for (let i = 0; i < numContigs; i++) {
    let chromIdx = 0;
    for (let b = 1; b < sortedBoundaries.length; b++) {
      if (i >= sortedBoundaries[b]) {
        chromIdx = b;
      }
    }
    assignments[i] = chromIdx;
  }

  return assignments;
}

/**
 * Extract ground truth from a curated .pretext assembly.
 *
 * Uses name-based chromosome detection (primary) which recognizes
 * GenomeArk naming conventions (SUPER_N, Super_Scaffold_N, chrN).
 * Falls back to signal-based detection if fewer than 2 chromosomes
 * are identified by name.
 */
export function extractGroundTruth(assembly: LoadedAssembly): GroundTruth {
  const { contigs, contigOrder } = assembly;

  const contigNames = contigOrder.map(idx => contigs[idx].name);
  const splits = detectSplits(contigs);

  // Try name-based detection first
  const nameResult = detectChromosomesByName(contigs, contigOrder);

  let chromosomeBoundaries: number[];
  let chromosomeAssignments: number[];

  // Use name-based if it found at least 2 distinct chromosome labels.
  // No minimum named count — in GenomeArk assemblies, named SUPER/chr scaffolds
  // represent most of the genome by bp even when outnumbered by small fragments.
  const uniqueChromLabels = new Set(nameResult.assignments).size;
  if (uniqueChromLabels >= 3) {
    chromosomeBoundaries = nameResult.boundaries;
    chromosomeAssignments = nameResult.assignments;
  } else {
    // Fall back to improved signal-based detection
    chromosomeBoundaries = detectChromosomeBoundariesBySignal(assembly);
    chromosomeAssignments = buildChromosomeAssignments(
      contigOrder.length,
      chromosomeBoundaries,
    );
  }

  return {
    contigNames,
    contigOrder: [...contigOrder],
    chromosomeBoundaries,
    chromosomeAssignments,
    splits,
    contigs: [...contigs],
  };
}
