/**
 * Benchmark runner — orchestrates load -> autoCut -> autoSort -> compare.
 */

import type { ContigInfo } from '../src/core/State';
import type { AutoCutParams, AutoCutResult, Breakpoint } from '../src/curation/AutoCut';
import type { AutoSortParams, AutoSortResult } from '../src/curation/AutoSort';
import { autoCut } from '../src/curation/AutoCut';
import { autoSort } from '../src/curation/AutoSort';
import { loadPretextFromDisk, type LoadedAssembly } from './loader';
import { extractGroundTruth, type GroundTruth } from './ground-truth';
import { computeBreakpointMetrics, aggregateBreakpointMetrics, type BreakpointMetrics } from './metrics/autocut-metrics';
import { computeSortMetrics, type SortMetrics } from './metrics/autosort-metrics';
import { computeChromosomeCompleteness, type ChromosomeCompletenessResult } from './metrics/chromosome-metrics';
import type { SpecimenResult } from './metrics/summary';

export interface BenchmarkResult extends SpecimenResult {}

export interface RunOptions {
  autoCutParams?: Partial<AutoCutParams>;
  autoSortParams?: Partial<AutoSortParams>;
}

/**
 * Apply breakpoints to a loaded assembly, splitting contigs into _L/_R fragments.
 *
 * Replicates CurationEngine.cut() (lines 68-118) as a pure function
 * without state management. Processes breakpoints right-to-left within
 * each contig for index stability.
 */
export function applyBreakpoints(
  contigs: ContigInfo[],
  contigOrder: number[],
  cutResult: AutoCutResult,
): { contigs: ContigInfo[]; contigOrder: number[] } {
  // Clone to avoid mutation
  const newContigs = [...contigs];
  let newOrder = [...contigOrder];

  // Process breakpoints in reverse contigOrder index for index stability
  const sortedIndices = [...cutResult.breakpoints.keys()].sort((a, b) => b - a);

  for (const orderIdx of sortedIndices) {
    const breakpoints = cutResult.breakpoints.get(orderIdx)!;
    // Sort breakpoints right-to-left within this contig
    const sortedBps = [...breakpoints].sort((a, b) => b.offset - a.offset);

    for (const bp of sortedBps) {
      const contigId = newOrder[orderIdx];
      const contig = newContigs[contigId];
      const contigPixelLength = contig.pixelEnd - contig.pixelStart;

      if (bp.offset <= 0 || bp.offset >= contigPixelLength) continue;

      // Calculate proportional split for base-pair length
      const fraction = bp.offset / contigPixelLength;
      const leftBpLength = Math.round(contig.length * fraction);
      const rightBpLength = contig.length - leftBpLength;

      const leftContig: ContigInfo = {
        name: `${contig.name}_L`,
        originalIndex: contig.originalIndex,
        length: leftBpLength,
        pixelStart: contig.pixelStart,
        pixelEnd: contig.pixelStart + bp.offset,
        inverted: contig.inverted,
        scaffoldId: contig.scaffoldId,
      };

      const rightContig: ContigInfo = {
        name: `${contig.name}_R`,
        originalIndex: contig.originalIndex,
        length: rightBpLength,
        pixelStart: contig.pixelStart + bp.offset,
        pixelEnd: contig.pixelEnd,
        inverted: contig.inverted,
        scaffoldId: contig.scaffoldId,
      };

      // Handle inverted naming convention
      if (contig.inverted) {
        leftContig.name = `${contig.name}_R`;
        rightContig.name = `${contig.name}_L`;
      }

      const leftId = newContigs.length;
      const rightId = newContigs.length + 1;
      newContigs.push(leftContig, rightContig);

      // Replace original in order
      newOrder = [...newOrder];
      newOrder.splice(orderIdx, 1, leftId, rightId);
    }
  }

  return { contigs: newContigs, contigOrder: newOrder };
}

/**
 * Run the full benchmark pipeline for a single specimen.
 *
 * @param preCurationPath - Path to the pre-curation .pretext file.
 * @param postCurationPath - Path to the post-curation (curated) .pretext file.
 * @param species - Species name for labeling.
 * @param options - Optional algorithm parameters.
 */
export async function runBenchmark(
  preCurationPath: string,
  postCurationPath: string,
  species: string,
  options: RunOptions = {},
): Promise<BenchmarkResult> {
  const t0 = performance.now();

  // Step 1: Load pre-curation assembly
  const preAssembly = await loadPretextFromDisk(preCurationPath);
  const tLoad = performance.now();

  // Step 2: Load post-curation assembly and extract ground truth
  const postAssembly = await loadPretextFromDisk(postCurationPath);
  const groundTruth = extractGroundTruth(postAssembly);

  // Step 3: Run autoCut on pre-curation map
  const cutResult = autoCut(
    preAssembly.contactMap,
    preAssembly.overviewSize,
    preAssembly.contigs,
    preAssembly.contigOrder,
    preAssembly.textureSize,
    options.autoCutParams,
  );
  const tCut = performance.now();

  // Step 4: Apply breakpoints to get post-cut state
  const postCut = applyBreakpoints(
    preAssembly.contigs,
    preAssembly.contigOrder,
    cutResult,
  );

  // Step 5: Run autoSort on post-cut state
  const sortResult = autoSort(
    preAssembly.contactMap,
    preAssembly.overviewSize,
    postCut.contigs,
    postCut.contigOrder,
    preAssembly.textureSize,
    options.autoSortParams,
  );
  const tSort = performance.now();

  // Step 6: Compute metrics

  // Build ground truth breakpoint positions from splits
  const gtBreakpoints: number[] = [];
  for (const [baseName, split] of groundTruth.splits) {
    const leftContig = groundTruth.contigs.find(c => c.name === split.leftName);
    if (leftContig) {
      gtBreakpoints.push(leftContig.pixelEnd - leftContig.pixelStart);
    }
  }

  // Flatten detected breakpoints
  const detectedBreakpoints: number[] = [];
  for (const bps of cutResult.breakpoints.values()) {
    for (const bp of bps) {
      detectedBreakpoints.push(bp.offset);
    }
  }

  const breakpointMetrics = computeBreakpointMetrics(
    detectedBreakpoints,
    gtBreakpoints,
    preAssembly.textureSize,
  );

  // Build ground truth inversions map
  const gtInversions = new Map<number, boolean>();
  // In ground truth, all contigs in the curated file are in their correct orientation
  for (let i = 0; i < groundTruth.contigOrder.length; i++) {
    gtInversions.set(i, false);
  }

  const sortMetrics = computeSortMetrics(
    sortResult.chains,
    groundTruth.contigOrder,
    groundTruth.chromosomeAssignments,
    gtInversions,
  );

  const chromosomeCompleteness = computeChromosomeCompleteness(
    sortResult.chains,
    postCut.contigs,
    postCut.contigOrder,
    groundTruth.chromosomeAssignments,
  );

  const tEnd = performance.now();

  return {
    species,
    numContigs: preAssembly.contigs.length,
    breakpointMetrics,
    sortMetrics,
    chromosomeCompleteness,
    timingMs: {
      load: tLoad - t0,
      autoCut: tCut - tLoad,
      autoSort: tSort - tCut,
      total: tEnd - t0,
    },
  };
}
