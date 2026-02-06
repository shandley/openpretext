/**
 * CurationEngine - Core curation operations for genome assembly.
 *
 * Implements cut, join, invert, and move operations on contigs.
 * Each operation validates inputs, modifies contig order/orientation in state,
 * records the operation for undo/redo, and emits events via the EventBus.
 *
 * All operations are reversible through the undo/redo system.
 */

import { state, ContigInfo, CurationOperation } from '../core/State';
import { events } from '../core/EventBus';
import type { ScaffoldManager } from './ScaffoldManager';

/**
 * Optional ScaffoldManager reference for scaffold_paint undo/redo.
 * Registered via setScaffoldManager() after the manager is created.
 */
let scaffoldManager: ScaffoldManager | null = null;

/**
 * Register the ScaffoldManager so CurationEngine can delegate
 * scaffold_paint undo/redo to it.
 */
export function setScaffoldManager(mgr: ScaffoldManager): void {
  scaffoldManager = mgr;
}

/**
 * Validates that the map is loaded and returns it, or throws.
 */
function requireMap() {
  const s = state.get();
  if (!s.map) {
    throw new Error('No map loaded');
  }
  return s.map;
}

/**
 * Validates that a contig index is within the current contig order bounds.
 */
function requireValidIndex(index: number, label = 'contigIndex'): void {
  const s = state.get();
  if (!Number.isInteger(index) || index < 0 || index >= s.contigOrder.length) {
    throw new Error(
      `Invalid ${label}: ${index}. Must be an integer in [0, ${s.contigOrder.length - 1}]`
    );
  }
}

// ---------------------------------------------------------------------------
// CUT
// ---------------------------------------------------------------------------

/**
 * Cut splits a contig at a given pixel position into two new contigs.
 *
 * The pixel position is relative to the contig's own pixel span
 * (i.e. an offset from pixelStart). The contig at `contigOrderIndex`
 * is replaced by two new contigs whose pixel ranges partition the
 * original span at `pixelOffset`.
 *
 * @param contigOrderIndex - Index in the current contigOrder array.
 * @param pixelOffset - Pixel offset within the contig at which to cut.
 *   Must be > 0 and < contig pixel length.
 */
export function cut(contigOrderIndex: number, pixelOffset: number): void {
  requireMap();
  requireValidIndex(contigOrderIndex);

  const s = state.get();
  const map = s.map!;
  const contigId = s.contigOrder[contigOrderIndex];
  const contig = map.contigs[contigId];

  const contigPixelLength = contig.pixelEnd - contig.pixelStart;

  if (!Number.isInteger(pixelOffset) || pixelOffset <= 0 || pixelOffset >= contigPixelLength) {
    throw new Error(
      `Invalid pixelOffset: ${pixelOffset}. Must be an integer in (0, ${contigPixelLength})`
    );
  }

  // Calculate the proportional split for base-pair length
  const fraction = pixelOffset / contigPixelLength;
  const leftBpLength = Math.round(contig.length * fraction);
  const rightBpLength = contig.length - leftBpLength;

  // Create two new contigs
  const leftContig: ContigInfo = {
    name: `${contig.name}_L`,
    originalIndex: contig.originalIndex,
    length: leftBpLength,
    pixelStart: contig.pixelStart,
    pixelEnd: contig.pixelStart + pixelOffset,
    inverted: contig.inverted,
    scaffoldId: contig.scaffoldId,
  };

  const rightContig: ContigInfo = {
    name: `${contig.name}_R`,
    originalIndex: contig.originalIndex,
    length: rightBpLength,
    pixelStart: contig.pixelStart + pixelOffset,
    pixelEnd: contig.pixelEnd,
    inverted: contig.inverted,
    scaffoldId: contig.scaffoldId,
  };

  // If the original contig was inverted, the left/right halves in display
  // order correspond to the right/left halves in genome order, so we swap
  // the naming convention (but keep pixelStart/End as-is since they refer
  // to texture coordinates).
  if (contig.inverted) {
    leftContig.name = `${contig.name}_R`;
    rightContig.name = `${contig.name}_L`;
  }

  // Assign new indices in the contigs array (immutable append)
  const leftId = map.contigs.length;
  const rightId = map.contigs.length + 1;
  state.appendContigs(leftContig, rightContig);

  // Replace the original contig in the order
  const newOrder = [...s.contigOrder];
  newOrder.splice(contigOrderIndex, 1, leftId, rightId);

  // Record the operation for undo
  const op: CurationOperation = {
    type: 'cut',
    timestamp: Date.now(),
    description: `Cut contig "${contig.name}" at pixel offset ${pixelOffset}`,
    data: {
      contigOrderIndex,
      pixelOffset,
      originalContigId: contigId,
      leftId,
      rightId,
      previousOrder: [...s.contigOrder],
    },
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(op);
  events.emit('curation:cut', { contigIndex: contigOrderIndex, position: pixelOffset });
  events.emit('render:request', {});
}

/**
 * Undo a cut operation: remove the two child contigs from the order and
 * restore the original contig.
 */
export function undoCut(op: CurationOperation): void {
  const previousOrder = op.data.previousOrder as number[];
  state.update({ contigOrder: [...previousOrder] });
  events.emit('render:request', {});
}

// ---------------------------------------------------------------------------
// JOIN
// ---------------------------------------------------------------------------

/**
 * Join merges two adjacent contigs into one.
 *
 * The contig at `contigOrderIndex` is merged with the contig at
 * `contigOrderIndex + 1`. The resulting contig spans the combined
 * pixel range and base-pair length.
 *
 * @param contigOrderIndex - Index of the first of the two adjacent contigs.
 */
export function join(contigOrderIndex: number): void {
  requireMap();
  requireValidIndex(contigOrderIndex);

  const s = state.get();
  const map = s.map!;

  if (contigOrderIndex + 1 >= s.contigOrder.length) {
    throw new Error(
      `Cannot join contig at index ${contigOrderIndex}: no adjacent contig to the right`
    );
  }

  const firstId = s.contigOrder[contigOrderIndex];
  const secondId = s.contigOrder[contigOrderIndex + 1];
  const first = map.contigs[firstId];
  const second = map.contigs[secondId];

  // Create merged contig
  const merged: ContigInfo = {
    name: `${first.name}+${second.name}`,
    originalIndex: first.originalIndex,
    length: first.length + second.length,
    pixelStart: Math.min(first.pixelStart, second.pixelStart),
    pixelEnd: Math.max(first.pixelEnd, second.pixelEnd),
    inverted: false,
    scaffoldId: first.scaffoldId,
  };

  const mergedId = map.contigs.length;
  state.appendContigs(merged);

  // Replace the pair in the order
  const newOrder = [...s.contigOrder];
  newOrder.splice(contigOrderIndex, 2, mergedId);

  const op: CurationOperation = {
    type: 'join',
    timestamp: Date.now(),
    description: `Joined contigs "${first.name}" and "${second.name}"`,
    data: {
      contigOrderIndex,
      firstId,
      secondId,
      mergedId,
      previousOrder: [...s.contigOrder],
    },
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(op);
  events.emit('curation:join', { contigIndex: contigOrderIndex });
  events.emit('render:request', {});
}

/**
 * Undo a join operation: restore the two original contigs.
 */
export function undoJoin(op: CurationOperation): void {
  const previousOrder = op.data.previousOrder as number[];
  state.update({ contigOrder: [...previousOrder] });
  events.emit('render:request', {});
}

// ---------------------------------------------------------------------------
// INVERT
// ---------------------------------------------------------------------------

/**
 * Invert flips the orientation of a contig. This toggles the `inverted`
 * flag on the contig, representing a reverse-complement operation.
 *
 * @param contigOrderIndex - Index in the current contigOrder array.
 */
export function invert(contigOrderIndex: number): void {
  requireMap();
  requireValidIndex(contigOrderIndex);

  const s = state.get();
  const map = s.map!;
  const contigId = s.contigOrder[contigOrderIndex];
  const contig = map.contigs[contigId];

  const previousInverted = contig.inverted;
  const newInverted = !contig.inverted;
  state.updateContig(contigId, { inverted: newInverted });

  const op: CurationOperation = {
    type: 'invert',
    timestamp: Date.now(),
    description: `Inverted contig "${contig.name}" (now ${newInverted ? 'inverted' : 'normal'})`,
    data: {
      contigOrderIndex,
      contigId,
      previousInverted,
    },
  };

  state.pushOperation(op);
  events.emit('curation:invert', { contigIndex: contigOrderIndex });
  events.emit('render:request', {});
}

/**
 * Undo an invert operation: restore the previous inverted state.
 */
export function undoInvert(op: CurationOperation): void {
  const map = state.get().map;
  if (!map) return;

  const contigId = op.data.contigId as number;
  state.updateContig(contigId, { inverted: op.data.previousInverted as boolean });
  events.emit('render:request', {});
}

// ---------------------------------------------------------------------------
// MOVE
// ---------------------------------------------------------------------------

/**
 * Move relocates a contig from one position to another in the ordering.
 *
 * @param fromIndex - Current position in contigOrder.
 * @param toIndex - Target position in contigOrder (after removal of the element).
 */
export function move(fromIndex: number, toIndex: number): void {
  requireMap();
  requireValidIndex(fromIndex, 'fromIndex');

  const s = state.get();

  // toIndex is validated against the length after removal, so it can be
  // [0, length-1] inclusive.
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= s.contigOrder.length) {
    throw new Error(
      `Invalid toIndex: ${toIndex}. Must be an integer in [0, ${s.contigOrder.length - 1}]`
    );
  }

  if (fromIndex === toIndex) {
    // No-op, but still valid
    return;
  }

  const previousOrder = [...s.contigOrder];
  const newOrder = [...s.contigOrder];
  const [removed] = newOrder.splice(fromIndex, 1);

  // After removal the target position may need adjustment
  // toIndex refers to the desired position in the final array
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
  newOrder.splice(insertAt, 0, removed);

  const op: CurationOperation = {
    type: 'move',
    timestamp: Date.now(),
    description: `Moved contig from position ${fromIndex} to ${toIndex}`,
    data: {
      fromIndex,
      toIndex,
      previousOrder,
    },
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(op);
  events.emit('curation:move', { fromIndex, toIndex });
  events.emit('render:request', {});
}

/**
 * Undo a move operation: restore the previous ordering.
 */
export function undoMove(op: CurationOperation): void {
  const previousOrder = op.data.previousOrder as number[];
  state.update({ contigOrder: [...previousOrder] });
  events.emit('render:request', {});
}

// ---------------------------------------------------------------------------
// UNDO / REDO
// ---------------------------------------------------------------------------

const undoHandlers: Record<CurationOperation['type'], (op: CurationOperation) => void> = {
  cut: undoCut,
  join: undoJoin,
  invert: undoInvert,
  move: undoMove,
  scaffold_paint: (op) => {
    if (scaffoldManager) {
      scaffoldManager.undoPaint(op);
    }
  },
};

/**
 * Undo the most recent curation operation.
 */
export function undo(): boolean {
  const s = state.get();
  if (s.undoStack.length === 0) return false;

  const op = s.undoStack[s.undoStack.length - 1];
  const newUndoStack = s.undoStack.slice(0, -1);
  const newRedoStack = [...s.redoStack, op];

  // Update stacks first so the handler sees the correct state
  state.update({
    undoStack: newUndoStack,
    redoStack: newRedoStack,
  });

  const handler = undoHandlers[op.type];
  if (handler) {
    handler(op);
  }

  events.emit('curation:undo', {});
  return true;
}

/**
 * Redo the most recently undone curation operation.
 *
 * Redo works by re-executing the operation with its stored parameters.
 */
export function redo(): boolean {
  const s = state.get();
  if (s.redoStack.length === 0) return false;

  const op = s.redoStack[s.redoStack.length - 1];
  const newRedoStack = s.redoStack.slice(0, -1);

  // Update redo stack before re-executing (the operation will push to undo)
  state.update({ redoStack: newRedoStack });

  // Re-execute the operation
  switch (op.type) {
    case 'cut':
      reapplyCut(op);
      break;
    case 'join':
      reapplyJoin(op);
      break;
    case 'invert':
      reapplyInvert(op);
      break;
    case 'move':
      reapplyMove(op);
      break;
    case 'scaffold_paint':
      if (scaffoldManager) {
        scaffoldManager.reapplyPaint(op);
      }
      break;
    default:
      break;
  }

  events.emit('curation:redo', {});
  return true;
}

/**
 * Undo all operations in a batch (by batchId).
 * Pops operations from the undo stack while the top matches the batchId.
 */
export function undoBatch(batchId: string): number {
  let count = 0;
  while (true) {
    const s = state.get();
    if (s.undoStack.length === 0) break;
    const top = s.undoStack[s.undoStack.length - 1];
    if (top.batchId !== batchId) break;
    undo();
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Redo helpers - re-apply an operation from stored data
// ---------------------------------------------------------------------------

function reapplyCut(op: CurationOperation): void {
  // For cut, we stored the resulting order implicitly. The simplest approach
  // is to figure out where the original contig ended up (if it's still present)
  // and re-cut it. But since the contigs were already created, we can
  // just restore the order that existed after the cut was originally applied.
  const s = state.get();
  const map = s.map!;
  const leftId = op.data.leftId as number;
  const rightId = op.data.rightId as number;
  const previousOrder = op.data.previousOrder as number[];
  const contigOrderIndex = op.data.contigOrderIndex as number;
  const originalContigId = op.data.originalContigId as number;

  // Rebuild the order: replace the original contig with the two halves
  const newOrder = [...previousOrder];
  const idx = newOrder.indexOf(originalContigId);
  if (idx !== -1) {
    newOrder.splice(idx, 1, leftId, rightId);
  }

  const newOp: CurationOperation = {
    ...op,
    timestamp: Date.now(),
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(newOp);
  events.emit('curation:cut', { contigIndex: contigOrderIndex, position: op.data.pixelOffset });
  events.emit('render:request', {});
}

function reapplyJoin(op: CurationOperation): void {
  const previousOrder = op.data.previousOrder as number[];
  const mergedId = op.data.mergedId as number;
  const contigOrderIndex = op.data.contigOrderIndex as number;

  // Replace the two original contigs with the merged one
  const newOrder = [...previousOrder];
  newOrder.splice(contigOrderIndex, 2, mergedId);

  const newOp: CurationOperation = {
    ...op,
    timestamp: Date.now(),
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(newOp);
  events.emit('curation:join', { contigIndex: contigOrderIndex });
  events.emit('render:request', {});
}

function reapplyInvert(op: CurationOperation): void {
  const map = state.get().map!;
  const contigId = op.data.contigId as number;
  const contig = map.contigs[contigId];

  // Toggle again (undone = back to previous, redo = toggle again)
  state.updateContig(contigId, { inverted: !contig.inverted });

  const newOp: CurationOperation = {
    ...op,
    timestamp: Date.now(),
  };

  state.pushOperation(newOp);
  events.emit('curation:invert', { contigIndex: op.data.contigOrderIndex });
  events.emit('render:request', {});
}

function reapplyMove(op: CurationOperation): void {
  const fromIndex = op.data.fromIndex as number;
  const toIndex = op.data.toIndex as number;
  const previousOrder = op.data.previousOrder as number[];

  const newOrder = [...previousOrder];
  const [removed] = newOrder.splice(fromIndex, 1);
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
  newOrder.splice(insertAt, 0, removed);

  const newOp: CurationOperation = {
    ...op,
    timestamp: Date.now(),
  };

  state.update({ contigOrder: newOrder });
  state.pushOperation(newOp);
  events.emit('curation:move', { fromIndex, toIndex });
  events.emit('render:request', {});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const CurationEngine = {
  cut,
  join,
  invert,
  move,
  undo,
  redo,
  undoBatch,
  setScaffoldManager,
};
