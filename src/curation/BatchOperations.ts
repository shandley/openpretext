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
import { autoCut, type AutoCutParams } from './AutoCut';
import { autoSort, autoSortCore, type AutoSortParams } from './AutoSort';
import type { ScaffoldManager } from './ScaffoldManager';

export interface BatchResult {
  operationsPerformed: number;
  description: string;
  batchId?: string;
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

/**
 * Auto cut: detect misassembly breakpoints using Hi-C diagonal signal
 * analysis and apply cuts via CurationEngine.
 *
 * Groups breakpoints by contigOrderIndex, processes highest index first
 * (right-to-left). Within each contig, cuts rightmost breakpoint first
 * so earlier offsets stay valid.
 *
 * Each cut creates its own undo record.
 *
 * @param params - Algorithm parameters (optional, uses defaults).
 * @returns A BatchResult describing how many operations were performed.
 */
export function autoCutContigs(params?: Partial<AutoCutParams>): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const map = s.map;
  if (!map.contactMap) {
    return { operationsPerformed: 0, description: 'No contact map available' };
  }

  const batchId = 'autocut-' + Date.now();
  const resolvedParams = { ...{ cutThreshold: 0.20, windowSize: 8, minFragmentSize: 16 }, ...params };
  state.setBatchContext(batchId, { algorithm: 'autocut', algorithmParams: resolvedParams });

  const result = autoCut(
    map.contactMap,
    map.contactMap.length === map.textureSize * map.textureSize ? map.textureSize : Math.round(Math.sqrt(map.contactMap.length)),
    map.contigs,
    s.contigOrder,
    map.textureSize,
    params,
  );

  if (result.totalBreakpoints === 0) {
    return { operationsPerformed: 0, description: 'No breakpoints detected' };
  }

  // Sort contig indices descending (right-to-left) for index stability
  const contigIndices = Array.from(result.breakpoints.keys()).sort((a, b) => b - a);

  let cutCount = 0;
  for (const orderIdx of contigIndices) {
    const bps = result.breakpoints.get(orderIdx)!;
    // Sort breakpoints descending by offset (cut rightmost first)
    const sortedBps = [...bps].sort((a, b) => b.offset - a.offset);

    for (const bp of sortedBps) {
      // Re-read state since each cut changes contig order
      const currentS = state.get();
      // After previous cuts on this same contig, the index shifts by
      // the number of cuts already made at this index.
      // But since we process right-to-left across contigs and
      // rightmost-first within a contig, the orderIdx for earlier
      // breakpoints within the same original contig needs adjustment.
      // Each cut at orderIdx replaces one contig with two, shifting
      // later indices by 1. Since we process descending, the orderIdx
      // for this contig doesn't change.
      const adjustedIdx = orderIdx + cutCount - (contigIndices.indexOf(orderIdx) > 0 ? 0 : 0);

      // Validate the cut is still in bounds
      if (adjustedIdx >= currentS.contigOrder.length) continue;
      const contigId = currentS.contigOrder[orderIdx];
      const contig = currentS.map!.contigs[contigId];
      const pixelLength = contig.pixelEnd - contig.pixelStart;

      if (bp.offset > 0 && bp.offset < pixelLength) {
        CurationEngine.cut(orderIdx, bp.offset);
        cutCount++;
      }
    }
  }

  state.clearBatchContext();

  return {
    operationsPerformed: cutCount,
    description: `Auto cut: ${cutCount} breakpoint(s) detected and applied`,
    batchId,
  };
}

/**
 * Auto sort: reorder contigs using Hi-C link scoring and Union Find
 * chaining. Applies inversions first (where proposed orientation
 * differs from current), then reorders via selection sort using
 * CurationEngine.move().
 *
 * Each operation creates its own undo record.
 *
 * @param params - Algorithm parameters (optional, uses defaults).
 * @returns A BatchResult describing how many operations were performed.
 */
export function autoSortContigs(params?: Partial<AutoSortParams>): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const map = s.map;
  if (!map.contactMap) {
    return { operationsPerformed: 0, description: 'No contact map available' };
  }

  const batchId = 'autosort-' + Date.now();
  const resolvedParams = { ...{ maxDiagonalDistance: 50, signalCutoff: 0.05, hardThreshold: 0.2 }, ...params };
  state.setBatchContext(batchId, { algorithm: 'autosort', algorithmParams: resolvedParams });

  const result = autoSort(
    map.contactMap,
    map.contactMap.length === map.textureSize * map.textureSize ? map.textureSize : Math.round(Math.sqrt(map.contactMap.length)),
    map.contigs,
    s.contigOrder,
    map.textureSize,
    params,
  );

  // Build the proposed order from chains (largest chain first)
  const proposedOrder: Array<{ orderIndex: number; inverted: boolean }> = [];
  for (const chain of result.chains) {
    for (const entry of chain) {
      proposedOrder.push(entry);
    }
  }

  if (proposedOrder.length === 0) {
    return { operationsPerformed: 0, description: 'Auto sort produced no ordering' };
  }

  let opCount = 0;

  // Phase 1: Apply inversions where proposed differs from current
  for (const entry of proposedOrder) {
    const contigId = s.contigOrder[entry.orderIndex];
    const contig = map.contigs[contigId];
    if (entry.inverted !== contig.inverted) {
      // Find the current position of this contig in the live order
      const currentOrder = state.get().contigOrder;
      const currentIdx = currentOrder.indexOf(contigId);
      if (currentIdx >= 0) {
        CurationEngine.invert(currentIdx);
        opCount++;
      }
    }
  }

  // Phase 2: Apply reordering via selection sort (same pattern as sortByLength)
  // Build the desired contig ID order
  const desiredOrder = proposedOrder.map(entry => s.contigOrder[entry.orderIndex]);
  const working = [...state.get().contigOrder];
  const n = working.length;

  for (let i = 0; i < n; i++) {
    const desired = desiredOrder[i];
    if (desired === undefined) continue;
    const currentPos = working.indexOf(desired);

    if (currentPos !== i && currentPos >= 0) {
      CurationEngine.move(currentPos, i);
      working.splice(currentPos, 1);
      working.splice(i, 0, desired);
      opCount++;
    }
  }

  state.clearBatchContext();

  return {
    operationsPerformed: opCount,
    description: `Auto sort: ${opCount} operation(s) (${result.chains.length} chain(s))`,
    batchId,
  };
}

/**
 * Sort contigs within each scaffold independently, preserving scaffold
 * boundaries. Falls back to global autoSort when no scaffolds exist.
 *
 * For each scaffold with >= 3 contigs, runs the AutoSort core algorithm
 * on just that scaffold's contigs. Contigs in small scaffolds (< 3) and
 * unscaffolded contigs are left in place.
 */
export function scaffoldAwareAutoSort(
  scaffoldManager: ScaffoldManager,
  params?: Partial<AutoSortParams>,
): BatchResult {
  const s = state.get();
  if (!s.map) {
    return { operationsPerformed: 0, description: 'No map loaded' };
  }

  const map = s.map;
  if (!map.contactMap) {
    return { operationsPerformed: 0, description: 'No contact map available' };
  }

  const scaffolds = scaffoldManager.getAllScaffolds();
  if (scaffolds.length < 2) {
    return autoSortContigs(params);
  }

  const overviewSize = map.contactMap.length === map.textureSize * map.textureSize
    ? map.textureSize
    : Math.round(Math.sqrt(map.contactMap.length));

  const batchId = 'scaffold-autosort-' + Date.now();
  const resolvedParams = { maxDiagonalDistance: 50, signalCutoff: 0.05, hardThreshold: 0.2, ...params };
  state.setBatchContext(batchId, { algorithm: 'scaffold-autosort', algorithmParams: resolvedParams });

  // Build per-scaffold proposed orderings
  // Map from global order-index → { contigId, inverted }
  const proposedAt = new Map<number, { contigId: number; inverted: boolean }>();
  let scaffoldsSorted = 0;

  // Collect unscaffolded contigs
  const unscaffolded: number[] = [];
  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    if (map.contigs[contigId].scaffoldId === null) {
      unscaffolded.push(i);
    }
  }

  // Process each scaffold + unscaffolded group
  const groups: Array<{ orderIndices: number[] }> = [];
  for (const scaffold of scaffolds) {
    const orderIndices = scaffoldManager.getContigsInScaffold(scaffold.id);
    groups.push({ orderIndices });
  }
  if (unscaffolded.length > 0) {
    groups.push({ orderIndices: unscaffolded });
  }

  for (const group of groups) {
    const { orderIndices } = group;
    if (orderIndices.length < 3) continue;

    // Build sub-order: contig IDs at these positions
    const subOrder = orderIndices.map(idx => s.contigOrder[idx]);

    // Run core sort on this subset
    const result = autoSortCore(
      map.contactMap, overviewSize, map.contigs, subOrder, map.textureSize, params,
    );

    // Flatten chains → proposed sub-order
    const proposed: Array<{ contigId: number; inverted: boolean }> = [];
    for (const chain of result.chains) {
      for (const entry of chain) {
        proposed.push({
          contigId: subOrder[entry.orderIndex],
          inverted: entry.inverted,
        });
      }
    }

    // Map back to global positions: sorted contigs fill the same slots
    const sortedPositions = [...orderIndices].sort((a, b) => a - b);
    for (let k = 0; k < sortedPositions.length; k++) {
      proposedAt.set(sortedPositions[k], proposed[k]);
    }
    scaffoldsSorted++;
  }

  // Build complete proposed order
  const desiredOrder: Array<{ contigId: number; inverted: boolean }> = [];
  for (let i = 0; i < s.contigOrder.length; i++) {
    const entry = proposedAt.get(i);
    if (entry) {
      desiredOrder.push(entry);
    } else {
      // Keep in place (small scaffold or unscaffolded singleton)
      desiredOrder.push({
        contigId: s.contigOrder[i],
        inverted: map.contigs[s.contigOrder[i]].inverted,
      });
    }
  }

  let opCount = 0;

  // Phase 1: Apply inversions
  for (const entry of desiredOrder) {
    const contig = map.contigs[entry.contigId];
    if (entry.inverted !== contig.inverted) {
      const currentOrder = state.get().contigOrder;
      const currentIdx = currentOrder.indexOf(entry.contigId);
      if (currentIdx >= 0) {
        CurationEngine.invert(currentIdx);
        opCount++;
      }
    }
  }

  // Phase 2: Reorder via selection sort
  const desiredContigIds = desiredOrder.map(e => e.contigId);
  const working = [...state.get().contigOrder];
  const n = working.length;

  for (let i = 0; i < n; i++) {
    const desired = desiredContigIds[i];
    if (desired === undefined) continue;
    const currentPos = working.indexOf(desired);

    if (currentPos !== i && currentPos >= 0) {
      CurationEngine.move(currentPos, i);
      working.splice(currentPos, 1);
      working.splice(i, 0, desired);
      opCount++;
    }
  }

  state.clearBatchContext();

  return {
    operationsPerformed: opCount,
    description: `Scaffold sort: ${opCount} operation(s) across ${scaffoldsSorted} group(s)`,
    batchId,
  };
}
