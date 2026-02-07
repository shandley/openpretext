/**
 * Extract ground truth contig ordering from curated .pretext files.
 *
 * A curated file has contigs already arranged in the correct order,
 * potentially with splits (indicated by _L/_R suffixes) and joins.
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

/**
 * Detect chromosome boundaries by analyzing signal drops between
 * adjacent contigs in the contact map.
 *
 * A chromosome boundary is detected when the off-diagonal signal
 * between two adjacent contigs drops significantly below the
 * average intra-chromosome signal.
 */
export function detectChromosomeBoundaries(
  assembly: LoadedAssembly,
  dropThreshold: number = 0.5,
): number[] {
  const { contactMap, overviewSize, contigs, contigOrder, textureSize } = assembly;
  const boundaries: number[] = [0]; // First chromosome always starts at 0

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

  // Compute adjacent pair signal strengths
  const pairSignals: number[] = [];
  for (let i = 0; i < ranges.length - 1; i++) {
    const rangeA = ranges[i];
    const rangeB = ranges[i + 1];

    // Sample the off-diagonal block between adjacent contigs
    let sum = 0;
    let count = 0;
    const sampleSize = Math.min(10, Math.min(rangeA.end - rangeA.start, rangeB.end - rangeB.start));

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

    pairSignals.push(count > 0 ? sum / count : 0);
  }

  if (pairSignals.length === 0) return boundaries;

  // Compute median signal as baseline
  const sorted = [...pairSignals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median <= 0) return boundaries;

  // Detect boundaries where signal drops below threshold
  for (let i = 0; i < pairSignals.length; i++) {
    if (pairSignals[i] < median * dropThreshold) {
      boundaries.push(i + 1);
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
 */
export function extractGroundTruth(assembly: LoadedAssembly): GroundTruth {
  const { contigs, contigOrder } = assembly;

  const contigNames = contigOrder.map(idx => contigs[idx].name);
  const splits = detectSplits(contigs);
  const chromosomeBoundaries = detectChromosomeBoundaries(assembly);
  const chromosomeAssignments = buildChromosomeAssignments(
    contigOrder.length,
    chromosomeBoundaries,
  );

  return {
    contigNames,
    contigOrder: [...contigOrder],
    chromosomeBoundaries,
    chromosomeAssignments,
    splits,
    contigs: [...contigs],
  };
}
