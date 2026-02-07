/**
 * Parameter grid search for AutoCut and AutoSort algorithms.
 *
 * Caches loaded contact maps (same across parameter configurations)
 * and reports best params by F1, Kendall tau, and composite score.
 */

import type { AutoCutParams } from '../src/curation/AutoCut';
import type { AutoSortParams } from '../src/curation/AutoSort';
import { autoCut } from '../src/curation/AutoCut';
import { autoSort } from '../src/curation/AutoSort';
import { loadPretextFromDisk, type LoadedAssembly } from './loader';
import { extractGroundTruth, type GroundTruth } from './ground-truth';
import { applyBreakpoints } from './runner';
import { computeBreakpointMetrics, type BreakpointMetrics } from './metrics/autocut-metrics';
import { computeSortMetrics, type SortMetrics } from './metrics/autosort-metrics';

export interface SweepConfig {
  /** AutoCut parameter grid. */
  autoCut: {
    cutThreshold: number[];
    windowSize: number[];
    minFragmentSize: number[];
  };
  /** AutoSort parameter grid. */
  autoSort: {
    maxDiagonalDistance: number[];
    signalCutoff: number[];
    hardThreshold: number[];
  };
}

export interface SweepResult {
  autoCutParams: Partial<AutoCutParams>;
  autoSortParams: Partial<AutoSortParams>;
  breakpointMetrics: BreakpointMetrics;
  sortMetrics: SortMetrics;
  compositeScore: number;
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  autoCut: {
    cutThreshold: [0.10, 0.15, 0.20, 0.25, 0.30],
    windowSize: [4, 8, 12, 16],
    minFragmentSize: [8, 16, 24],
  },
  autoSort: {
    maxDiagonalDistance: [30, 50, 80],
    signalCutoff: [0.03, 0.05, 0.08],
    hardThreshold: [0.15, 0.20, 0.30],
  },
};

/**
 * Generate all parameter combinations from a grid.
 */
function* paramGrid<T extends Record<string, number[]>>(grid: T): Generator<Record<keyof T, number>> {
  const keys = Object.keys(grid) as Array<keyof T>;
  const values = keys.map(k => grid[k] as number[]);
  const indices = new Array(keys.length).fill(0);

  while (true) {
    const combo: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      combo[keys[i] as string] = values[i][indices[i]];
    }
    yield combo as Record<keyof T, number>;

    // Increment indices
    let carry = true;
    for (let i = keys.length - 1; i >= 0 && carry; i--) {
      indices[i]++;
      if (indices[i] < values[i].length) {
        carry = false;
      } else {
        indices[i] = 0;
      }
    }
    if (carry) break;
  }
}

/**
 * Run a parameter sweep across AutoCut and AutoSort parameters.
 *
 * @param preCurationPath - Path to pre-curation .pretext file.
 * @param postCurationPath - Path to post-curation .pretext file.
 * @param config - Sweep configuration with parameter grids.
 */
export async function runSweep(
  preCurationPath: string,
  postCurationPath: string,
  config: SweepConfig = DEFAULT_SWEEP_CONFIG,
): Promise<SweepResult[]> {
  // Load assemblies once (cached across all parameter combos)
  console.log('Loading assemblies...');
  const preAssembly = await loadPretextFromDisk(preCurationPath);
  const postAssembly = await loadPretextFromDisk(postCurationPath);
  const groundTruth = extractGroundTruth(postAssembly);

  // Build ground truth breakpoint positions
  const gtBreakpoints: number[] = [];
  for (const [, split] of groundTruth.splits) {
    const leftContig = groundTruth.contigs.find(c => c.name === split.leftName);
    if (leftContig) {
      gtBreakpoints.push(leftContig.pixelEnd - leftContig.pixelStart);
    }
  }

  const gtInversions = new Map<number, boolean>();
  for (let i = 0; i < groundTruth.contigOrder.length; i++) {
    gtInversions.set(i, false);
  }

  const results: SweepResult[] = [];
  const cutCombos = [...paramGrid(config.autoCut)];
  const sortCombos = [...paramGrid(config.autoSort)];
  const totalCombos = cutCombos.length * sortCombos.length;

  console.log(`Running ${totalCombos} parameter combinations (${cutCombos.length} cut x ${sortCombos.length} sort)...`);
  let completed = 0;

  for (const cutParams of cutCombos) {
    // Run autoCut once per cutParams
    const cutResult = autoCut(
      preAssembly.contactMap,
      preAssembly.overviewSize,
      preAssembly.contigs,
      preAssembly.contigOrder,
      preAssembly.textureSize,
      cutParams,
    );

    const postCut = applyBreakpoints(
      preAssembly.contigs,
      preAssembly.contigOrder,
      cutResult,
    );

    // Flatten detected breakpoints for metrics
    const detectedBreakpoints: number[] = [];
    for (const bps of cutResult.breakpoints.values()) {
      for (const bp of bps) detectedBreakpoints.push(bp.offset);
    }

    const breakpointMetrics = computeBreakpointMetrics(
      detectedBreakpoints,
      gtBreakpoints,
      preAssembly.textureSize,
    );

    for (const sortParams of sortCombos) {
      const sortResult = autoSort(
        preAssembly.contactMap,
        preAssembly.overviewSize,
        postCut.contigs,
        postCut.contigOrder,
        preAssembly.textureSize,
        sortParams,
      );

      const sortMetrics = computeSortMetrics(
        sortResult.chains,
        groundTruth.contigOrder,
        groundTruth.chromosomeAssignments,
        gtInversions,
      );

      // Composite score: weighted combination of F1 and Kendall tau
      const compositeScore =
        0.4 * breakpointMetrics.f1 +
        0.3 * sortMetrics.kendallTau +
        0.2 * sortMetrics.adjustedRandIndex +
        0.1 * sortMetrics.orientationAccuracy;

      results.push({
        autoCutParams: cutParams,
        autoSortParams: sortParams,
        breakpointMetrics,
        sortMetrics,
        compositeScore,
      });

      completed++;
      if (completed % 50 === 0 || completed === totalCombos) {
        console.log(`  ${completed}/${totalCombos} combinations completed`);
      }
    }
  }

  // Sort by composite score descending
  results.sort((a, b) => b.compositeScore - a.compositeScore);

  return results;
}

/**
 * Print top N sweep results.
 */
export function printSweepResults(results: SweepResult[], topN: number = 10): void {
  console.log(`\nTop ${Math.min(topN, results.length)} parameter combinations:`);
  console.log('='.repeat(80));

  for (let i = 0; i < Math.min(topN, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i + 1} (composite: ${r.compositeScore.toFixed(4)})`);
    console.log(`  AutoCut:  ${JSON.stringify(r.autoCutParams)}`);
    console.log(`  AutoSort: ${JSON.stringify(r.autoSortParams)}`);
    console.log(`  F1: ${r.breakpointMetrics.f1.toFixed(3)}, Tau: ${r.sortMetrics.kendallTau.toFixed(3)}, ARI: ${r.sortMetrics.adjustedRandIndex.toFixed(3)}`);
  }
}
