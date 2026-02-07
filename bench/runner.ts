/**
 * Benchmark runner — orchestrates load -> autoCut -> autoSort -> compare.
 *
 * Evaluates AutoCut and AutoSort on the **curated** assembly where ground
 * truth is known from contig names (SUPER_N, Super_Scaffold_N, chrN).
 *
 * Pre and post-curation .pretext files use completely different contig
 * naming systems (e.g., scaffold_1.H1 vs SUPER_2), making cross-file
 * contig mapping impossible. Instead, we:
 *
 * 1. Load the curated assembly (known-good ordering + chromosome labels)
 * 2. Run AutoCut on the curated contact map (should find few breakpoints
 *    since contigs are already at correct boundaries)
 * 3. Run AutoSort on the curated contact map (should recover the curated
 *    chromosome groupings from the Hi-C signal)
 * 4. Compare predictions against name-derived ground truth
 *
 * The pre-curation file is loaded for supplementary stats (contig count,
 * fragmentation level) but not used in metric computation.
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
 * Evaluates algorithms on the curated assembly where chromosome ground
 * truth is known from contig names. The pre-curation file provides
 * supplementary stats only.
 *
 * @param preCurationPath - Path to the pre-curation .pretext file (for stats).
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

  // Load pre-curation assembly (for supplementary stats)
  const preAssembly = await loadPretextFromDisk(preCurationPath);

  // Load curated assembly — this is both input and ground truth source
  const curatedAssembly = await loadPretextFromDisk(postCurationPath);
  const groundTruth = extractGroundTruth(curatedAssembly);
  const tLoad = performance.now();

  // Run AutoCut on the curated contact map
  const cutResult = autoCut(
    curatedAssembly.contactMap,
    curatedAssembly.overviewSize,
    curatedAssembly.contigs,
    curatedAssembly.contigOrder,
    curatedAssembly.textureSize,
    options.autoCutParams,
  );
  const tCut = performance.now();

  // Apply breakpoints to get post-cut state
  const postCut = applyBreakpoints(
    curatedAssembly.contigs,
    curatedAssembly.contigOrder,
    cutResult,
  );

  // Run AutoSort on the curated contact map with post-cut contigs
  const sortResult = autoSort(
    curatedAssembly.contactMap,
    curatedAssembly.overviewSize,
    postCut.contigs,
    postCut.contigOrder,
    curatedAssembly.textureSize,
    options.autoSortParams,
  );
  const tSort = performance.now();

  // ---- Compute metrics ----

  // Breakpoint metrics: compare detected breakpoints against ground truth splits
  const gtBreakpoints: number[] = [];
  for (const [baseName, split] of groundTruth.splits) {
    const leftContig = groundTruth.contigs.find(c => c.name === split.leftName);
    if (leftContig) {
      gtBreakpoints.push(leftContig.pixelEnd - leftContig.pixelStart);
    }
  }

  const detectedBreakpoints: number[] = [];
  for (const bps of cutResult.breakpoints.values()) {
    for (const bp of bps) {
      detectedBreakpoints.push(bp.offset);
    }
  }

  const breakpointMetrics = computeBreakpointMetrics(
    detectedBreakpoints,
    gtBreakpoints,
    curatedAssembly.textureSize,
  );

  // ---- Sort metrics via name-based ground truth ----
  //
  // Map each post-cut contig back to its ground truth chromosome and rank
  // using contig names (which are preserved or predictably derived via _L/_R).

  const gtNameMap = new Map<string, { rank: number; chromIdx: number }>();
  for (let pos = 0; pos < groundTruth.contigOrder.length; pos++) {
    const contigIdx = groundTruth.contigOrder[pos];
    const name = groundTruth.contigs[contigIdx].name;
    gtNameMap.set(name, {
      rank: pos,
      chromIdx: groundTruth.chromosomeAssignments[pos],
    });
  }

  // For post-cut contigs, map names back to ground truth.
  // If a contig was split (X -> X_L, X_R), look up the parent name.
  const mappedChromAssignments: number[] = [];
  const mappedGtRanks: number[] = [];
  const mappedInversions = new Map<number, boolean>();
  const unmappedChromIdx = new Set(groundTruth.chromosomeAssignments).size;

  for (let orderPos = 0; orderPos < postCut.contigOrder.length; orderPos++) {
    const contigId = postCut.contigOrder[orderPos];
    const contigName = postCut.contigs[contigId].name;

    // Try exact name match first, then parent name (strip _L/_R from autocut splits)
    let gt = gtNameMap.get(contigName);
    if (!gt) {
      const parentName = contigName.replace(/_[LR]$/, '');
      gt = gtNameMap.get(parentName);
    }

    if (gt) {
      mappedChromAssignments.push(gt.chromIdx);
      mappedGtRanks.push(gt.rank);
      mappedInversions.set(orderPos, false);
    } else {
      mappedChromAssignments.push(unmappedChromIdx);
      mappedGtRanks.push(-1);
      mappedInversions.set(orderPos, false);
    }
  }

  // Build ground truth ordering in post-cut index space
  const groundTruthOrderMapped = postCut.contigOrder
    .map((_, orderPos) => orderPos)
    .filter(orderPos => mappedGtRanks[orderPos] >= 0)
    .sort((a, b) => mappedGtRanks[a] - mappedGtRanks[b]);

  const sortMetrics = computeSortMetrics(
    sortResult.chains,
    groundTruthOrderMapped,
    mappedChromAssignments,
    mappedInversions,
  );

  const chromosomeCompleteness = computeChromosomeCompleteness(
    sortResult.chains,
    postCut.contigs,
    postCut.contigOrder,
    mappedChromAssignments,
  );

  const tEnd = performance.now();

  return {
    species,
    numContigs: curatedAssembly.contigs.length,
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
