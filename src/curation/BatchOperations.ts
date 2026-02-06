/**
 * BatchOperations - Batch operations on sets of contigs.
 *
 * Provides utilities for selecting contigs by pattern or size, and for
 * performing bulk curation operations (cut, join, invert, sort) on
 * groups of contigs.
 *
 * When performing operations that modify indices (cut, join), processing
 * is done from right to left (highest index first) so that earlier
 * indices remain stable throughout the batch.
 */

import { CurationEngine } from './CurationEngine';
import { state } from '../core/State';
import type { ContigInfo } from '../core/State';

export interface BatchResult {
  operationsPerformed: number;
  description: string;
}

/**
 * Select contigs whose names match a glob-like pattern.
 * Supports * as a wildcard matching any sequence of characters.
 *
 * @param pattern - Glob pattern (e.g., "chr*", "*_L", "scaffold_1*").
 * @returns Array of contigOrder indices for matching contigs.
 */
export function selectByPattern(pattern: string): number[] {
  const s = state.get();
  if (!s.map) return [];

  // Convert glob pattern to regex: escape regex special chars, then replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexStr);

  const matches: number[] = [];
  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];
    if (regex.test(contig.name)) {
      matches.push(i);
    }
  }

  return matches;
}

/**
 * Select contigs that fall within a base-pair size range.
 *
 * @param minBp - Minimum length in base pairs (inclusive). Omit or undefined for no lower bound.
 * @param maxBp - Maximum length in base pairs (inclusive). Omit or undefined for no upper bound.
 * @returns Array of contigOrder indices for matching contigs.
 */
export function selectBySize(minBp?: number, maxBp?: number): number[] {
  const s = state.get();
  if (!s.map) return [];

  const matches: number[] = [];
  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];

    if (minBp !== undefined && contig.length < minBp) continue;
    if (maxBp !== undefined && contig.length > maxBp) continue;

    matches.push(i);
  }

  return matches;
}

/**
 * Batch cut: cut all contigs larger than a threshold at their midpoint.
 * Processes from right to left so that earlier indices remain stable.
 *
 * @param minLengthBp - Minimum contig length (in base pairs) to be cut.
 * @returns A BatchResult describing how many operations were performed.
 */
export function batchCutBySize(minLengthBp: number): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  // Collect indices of contigs to cut (those with length > threshold)
  const toCut: number[] = [];
  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];
    if (contig.length > minLengthBp) {
      toCut.push(i);
    }
  }

  // Process from right to left to keep earlier indices stable
  let count = 0;
  for (let j = toCut.length - 1; j >= 0; j--) {
    const orderIndex = toCut[j];
    const contigId = state.get().contigOrder[orderIndex];
    const contig = state.get().map!.contigs[contigId];
    const pixelLength = contig.pixelEnd - contig.pixelStart;
    const midPixel = Math.floor(pixelLength / 2);

    if (midPixel > 0 && midPixel < pixelLength) {
      CurationEngine.cut(orderIndex, midPixel);
      count++;
    }
  }

  return {
    operationsPerformed: count,
    description: `Cut ${count} contig(s) larger than ${minLengthBp} bp at their midpoints`,
  };
}

/**
 * Batch join: join all currently selected adjacent contig pairs.
 *
 * If selected contigs form one or more contiguous runs, each run is
 * joined into a single contig. Joins are processed from right to left
 * within each run so that earlier indices remain stable.
 *
 * @returns A BatchResult describing how many operations were performed.
 */
export function batchJoinSelected(): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const selected = Array.from(s.selectedContigs).sort((a, b) => a - b);
  if (selected.length < 2) {
    return { operationsPerformed: 0, description: 'Need at least 2 selected contigs to join' };
  }

  // Find contiguous runs within the selection
  const runs: number[][] = [];
  let currentRun: number[] = [selected[0]];

  for (let i = 1; i < selected.length; i++) {
    if (selected[i] === selected[i - 1] + 1) {
      currentRun.push(selected[i]);
    } else {
      if (currentRun.length >= 2) {
        runs.push(currentRun);
      }
      currentRun = [selected[i]];
    }
  }
  if (currentRun.length >= 2) {
    runs.push(currentRun);
  }

  if (runs.length === 0) {
    return { operationsPerformed: 0, description: 'No adjacent selected contigs to join' };
  }

  // Process runs from right to left (so joining doesn't shift earlier runs)
  let totalJoins = 0;
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    // Within a run, join from right to left. Joining at index i merges
    // contigs at i and i+1. For a run of length N, we need N-1 joins.
    // Start from the second-to-last element in the run going backward.
    for (let j = run.length - 2; j >= 0; j--) {
      CurationEngine.join(run[j]);
      totalJoins++;
    }
  }

  return {
    operationsPerformed: totalJoins,
    description: `Joined ${totalJoins} adjacent contig pair(s) across ${runs.length} contiguous run(s)`,
  };
}

/**
 * Batch invert: invert all currently selected contigs.
 *
 * @returns A BatchResult describing how many operations were performed.
 */
export function batchInvertSelected(): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const selected = Array.from(s.selectedContigs).sort((a, b) => a - b);
  if (selected.length === 0) {
    return { operationsPerformed: 0, description: 'No contigs selected' };
  }

  let count = 0;
  for (const orderIndex of selected) {
    CurationEngine.invert(orderIndex);
    count++;
  }

  return {
    operationsPerformed: count,
    description: `Inverted ${count} contig(s)`,
  };
}

/**
 * Sort contigs by length using a series of move operations.
 * Implements a simple selection sort: repeatedly find the next contig
 * that should be placed at position i and move it there.
 *
 * @param descending - If true, sort largest first. Defaults to false (ascending).
 * @returns A BatchResult describing how many operations were performed.
 */
export function sortByLength(descending = false): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const map = s.map;
  const order = [...s.contigOrder];
  const n = order.length;
  let moveCount = 0;

  // Build the desired sorted order
  const sorted = [...order].sort((a, b) => {
    const lenA = map.contigs[a].length;
    const lenB = map.contigs[b].length;
    return descending ? lenB - lenA : lenA - lenB;
  });

  // Apply moves to transform current order into sorted order.
  // We work through the sorted array: for position i, find where the
  // desired contig currently is and move it to position i.
  const working = [...order];
  for (let i = 0; i < n; i++) {
    const desired = sorted[i];
    const currentPos = working.indexOf(desired);

    if (currentPos !== i) {
      // Move from currentPos to i
      CurationEngine.move(currentPos, i);
      // Update our working copy to match
      working.splice(currentPos, 1);
      working.splice(i, 0, desired);
      moveCount++;
    }
  }

  const direction = descending ? 'descending' : 'ascending';
  return {
    operationsPerformed: moveCount,
    description: `Sorted ${n} contigs by length (${direction}), ${moveCount} move(s)`,
  };
}
