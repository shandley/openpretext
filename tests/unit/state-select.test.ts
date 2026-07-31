import { describe, it, expect, beforeEach } from 'vitest';
import { state, MAX_UNDO_DEPTH, type ContigInfo, type MapData, type AppState } from '../../src/core/State';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length = 1000
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

function makeTestMap(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test.pretext',
    textureSize: 1024,
    numMipMaps: 1,
    contigs,
    textures: [new Float32Array(0)],
    extensions: new Map(),
  } as MapData;
}

function setupStandardState(): void {
  const contigs = [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
  ];
  const map = makeTestMap(contigs);
  state.update({
    map,
    contigOrder: [0, 1],
  });
}

// ---------------------------------------------------------------------------
// state.select() tests
// ---------------------------------------------------------------------------

describe('state.select()', () => {
  beforeEach(() => {
    state.reset();
  });

  it('fires callback when selected field changes', () => {
    const values: number[] = [];
    state.select(
      (s: AppState) => s.gamma,
      (newVal) => values.push(newVal),
    );

    state.update({ gamma: 0.5 });
    state.update({ gamma: 0.8 });

    expect(values).toEqual([0.5, 0.8]);
  });

  it('does NOT fire callback when unrelated field changes', () => {
    const calls: number[] = [];
    state.select(
      (s: AppState) => s.gamma,
      (newVal) => calls.push(newVal),
    );

    state.update({ showGrid: false });
    state.update({ mode: 'edit' });

    expect(calls).toEqual([]);
  });

  it('unsubscribe stops notifications', () => {
    const calls: number[] = [];
    const unsub = state.select(
      (s: AppState) => s.gamma,
      (newVal) => calls.push(newVal),
    );

    state.update({ gamma: 0.5 });
    unsub();
    state.update({ gamma: 0.9 });

    expect(calls).toEqual([0.5]);
  });

  it('multiple selectors work independently', () => {
    const gammaValues: number[] = [];
    const gridValues: boolean[] = [];

    state.select(
      (s: AppState) => s.gamma,
      (newVal) => gammaValues.push(newVal),
    );
    state.select(
      (s: AppState) => s.showGrid,
      (newVal) => gridValues.push(newVal),
    );

    state.update({ gamma: 0.5 });
    expect(gammaValues).toEqual([0.5]);
    expect(gridValues).toEqual([]);

    state.update({ showGrid: false });
    expect(gammaValues).toEqual([0.5]);
    expect(gridValues).toEqual([false]);
  });

  it('Object.is comparison works correctly with cloned contigOrder', () => {
    setupStandardState();
    const orderChanges: number[][] = [];
    state.select(
      (s: AppState) => s.contigOrder,
      (newVal) => orderChanges.push([...newVal]),
    );

    // Same reference = no change
    const s = state.get();
    state.update({ gamma: 0.5 }); // unrelated change
    expect(orderChanges).toEqual([]);

    // New array = change detected
    state.update({ contigOrder: [1, 0] });
    expect(orderChanges).toEqual([[1, 0]]);
  });

  it('provides old and new values to callback', () => {
    const transitions: Array<{ from: number; to: number }> = [];
    state.select(
      (s: AppState) => s.gamma,
      (newVal, oldVal) => transitions.push({ from: oldVal, to: newVal }),
    );

    state.update({ gamma: 0.5 });
    state.update({ gamma: 0.8 });

    expect(transitions).toEqual([
      { from: 0.35, to: 0.5 },
      { from: 0.5, to: 0.8 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Immutability tests (Phase 1 verification)
// ---------------------------------------------------------------------------

describe('state immutability', () => {
  beforeEach(() => {
    state.reset();
  });

  it('updateContig produces a new contigs array reference', () => {
    setupStandardState();
    const before = state.get().map!.contigs;

    state.updateContig(0, { inverted: true });

    const after = state.get().map!.contigs;
    expect(before).not.toBe(after);
    // Original reference unchanged
    expect(before[0].inverted).toBe(false);
    // New state has the change
    expect(after[0].inverted).toBe(true);
  });

  it('appendContigs produces a new contigs array reference', () => {
    setupStandardState();
    const before = state.get().map!.contigs;
    const beforeLength = before.length;

    const newContig = makeContig('chr3', 2, 200, 300);
    const startIdx = state.appendContigs(newContig);

    const after = state.get().map!.contigs;
    expect(before).not.toBe(after);
    expect(startIdx).toBe(beforeLength);
    expect(after.length).toBe(beforeLength + 1);
    expect(before.length).toBe(beforeLength); // original unchanged
  });

  it('pushOperation clones the undo stack', () => {
    const stackBefore = state.get().undoStack;

    state.pushOperation({
      type: 'invert',
      timestamp: Date.now(),
      description: 'test',
      data: {},
    });

    const stackAfter = state.get().undoStack;
    expect(stackBefore).not.toBe(stackAfter);
    expect(stackBefore.length).toBe(0);
    expect(stackAfter.length).toBe(1);
  });

  it('updateContigs applies multiple changes in a single clone', () => {
    setupStandardState();
    const before = state.get().map!.contigs;

    state.updateContigs([
      { id: 0, changes: { inverted: true } },
      { id: 1, changes: { scaffoldId: 5 } },
    ]);

    const after = state.get().map!.contigs;
    expect(before).not.toBe(after);
    expect(after[0].inverted).toBe(true);
    expect(after[1].scaffoldId).toBe(5);
    // Originals unchanged
    expect(before[0].inverted).toBe(false);
    expect(before[1].scaffoldId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Batch context tests
// ---------------------------------------------------------------------------

describe('batch context', () => {
  beforeEach(() => {
    state.reset();
  });

  it('auto-merges batchId into pushed operations', () => {
    state.setBatchContext('batch-1');

    state.pushOperation({
      type: 'invert',
      timestamp: Date.now(),
      description: 'test',
      data: {},
    });

    const op = state.get().undoStack[0];
    expect(op.batchId).toBe('batch-1');
  });

  it('auto-merges metadata into pushed operations', () => {
    state.setBatchContext('batch-1', { algorithm: 'autocut', threshold: 0.2 });

    state.pushOperation({
      type: 'cut',
      timestamp: Date.now(),
      description: 'test',
      data: { pixelOffset: 50 },
    });

    const op = state.get().undoStack[0];
    expect(op.batchId).toBe('batch-1');
    expect(op.data.algorithm).toBe('autocut');
    expect(op.data.threshold).toBe(0.2);
    expect(op.data.pixelOffset).toBe(50); // original data preserved
  });

  it('clearBatchContext stops merging', () => {
    state.setBatchContext('batch-1');
    state.clearBatchContext();

    state.pushOperation({
      type: 'invert',
      timestamp: Date.now(),
      description: 'test',
      data: {},
    });

    const op = state.get().undoStack[0];
    expect(op.batchId).toBeUndefined();
  });

  it('reset clears batch context', () => {
    state.setBatchContext('batch-1');
    state.reset();

    state.pushOperation({
      type: 'invert',
      timestamp: Date.now(),
      description: 'test',
      data: {},
    });

    const op = state.get().undoStack[0];
    expect(op.batchId).toBeUndefined();
  });

  it('caps undoStack at MAX_UNDO_DEPTH and retains most recent op', () => {
    state.reset();

    const total = MAX_UNDO_DEPTH + 50;
    for (let i = 0; i < total; i++) {
      state.pushOperation({
        type: 'invert',
        timestamp: i,
        description: `op-${i}`,
        data: { seq: i },
      });
    }

    const undoStack = state.get().undoStack;
    expect(undoStack.length).toBe(MAX_UNDO_DEPTH);
    // Most recent op must remain at the end (undo pops from the end).
    expect(undoStack[undoStack.length - 1].description).toBe(`op-${total - 1}`);
    // Oldest retained op is the one at depth boundary; older ones dropped.
    expect(undoStack[0].description).toBe(`op-${total - MAX_UNDO_DEPTH}`);
    expect(state.undoDroppedCount()).toBe(total - MAX_UNDO_DEPTH);
  });
});

// ---------------------------------------------------------------------------
// Undo-stack trimming rules
//
// The cap bounds memory, but it must never cost reversibility: a batched action
// is undone as one unit by undoBatch, so dropping the front of a batch would
// strand the assembly in a state no undo can restore. These pin the two
// exceptions that make the cap safe (see MAX_UNDO_DEPTH in State.ts).
// ---------------------------------------------------------------------------

describe('undo stack trimming', () => {
  beforeEach(() => {
    state.reset();
  });

  /** Push `count` operations, optionally under a batch context. */
  function push(count: number, prefix: string, batchId?: string): void {
    if (batchId) state.setBatchContext(batchId);
    for (let i = 0; i < count; i++) {
      state.pushOperation({
        type: 'invert',
        timestamp: i,
        description: `${prefix}-${i}`,
        data: { seq: i },
      });
    }
    if (batchId) state.clearBatchContext();
  }

  it('does not drop anything at exactly MAX_UNDO_DEPTH', () => {
    push(MAX_UNDO_DEPTH, 'op');

    expect(state.get().undoStack.length).toBe(MAX_UNDO_DEPTH);
    expect(state.undoDroppedCount()).toBe(0);
    expect(state.get().undoStack[0].description).toBe('op-0');
  });

  it('drops exactly one op at MAX_UNDO_DEPTH + 1', () => {
    push(MAX_UNDO_DEPTH + 1, 'op');

    const stack = state.get().undoStack;
    expect(stack.length).toBe(MAX_UNDO_DEPTH);
    expect(state.undoDroppedCount()).toBe(1);
    expect(stack[0].description).toBe('op-1'); // op-0 dropped
    expect(stack[stack.length - 1].description).toBe(`op-${MAX_UNDO_DEPTH}`);
  });

  it('ages out a whole batch rather than part of one', () => {
    push(10, 'a', 'batch-a');
    push(MAX_UNDO_DEPTH, 'u');

    const stack = state.get().undoStack;
    expect(stack.length).toBe(MAX_UNDO_DEPTH);
    expect(state.undoDroppedCount()).toBe(10);
    // No fragment of batch-a survives, and the front is not mid-batch.
    expect(stack.some((op) => op.batchId === 'batch-a')).toBe(false);
    expect(stack[0].description).toBe('u-0');
  });

  it('keeps a batch bigger than the cap whole, exceeding the cap', () => {
    push(5, 'old');
    push(MAX_UNDO_DEPTH, 'b', 'batch-b'); // batch alone fills the cap

    // The 5 unbatched ops are droppable; the batch is not split to reach the cap.
    expect(state.undoDroppedCount()).toBe(5);
    expect(state.get().undoStack.length).toBe(MAX_UNDO_DEPTH);

    push(1, 'newer'); // nothing left to drop except the middle of batch-b
    const stack = state.get().undoStack;
    expect(stack.length).toBe(MAX_UNDO_DEPTH + 1); // soft cap: batch kept whole
    expect(state.undoDroppedCount()).toBe(5); // nothing further dropped
    expect(stack.filter((op) => op.batchId === 'batch-b').length).toBe(MAX_UNDO_DEPTH);
    expect(stack[0].description).toBe('b-0'); // front is the batch's first op
  });

  it('suspends trimming while an atomic action is open, then trims once', () => {
    state.beginAtomicAction();
    push(MAX_UNDO_DEPTH + 50, 'op');

    // Nothing may be dropped mid-action: a script stamps its batchId only after
    // running, so its ops are unprotected by the batch rule until then.
    expect(state.get().undoStack.length).toBe(MAX_UNDO_DEPTH + 50);
    expect(state.undoDroppedCount()).toBe(0);

    state.endAtomicAction();

    const stack = state.get().undoStack;
    expect(stack.length).toBe(MAX_UNDO_DEPTH);
    expect(state.undoDroppedCount()).toBe(50);
    expect(stack[stack.length - 1].description).toBe(`op-${MAX_UNDO_DEPTH + 49}`);
  });

  it('nested atomic actions only trim when the outermost closes', () => {
    state.beginAtomicAction();
    state.beginAtomicAction();
    push(MAX_UNDO_DEPTH + 10, 'op');
    state.endAtomicAction();

    expect(state.get().undoStack.length).toBe(MAX_UNDO_DEPTH + 10);

    state.endAtomicAction();
    expect(state.get().undoStack.length).toBe(MAX_UNDO_DEPTH);
  });

  it('assignBatchId stamps by mark, so trimming cannot shift the range', () => {
    push(MAX_UNDO_DEPTH, 'old');
    const mark = state.undoMark();
    push(5, 'new'); // pushes 5 out of the front, shifting every index by 5

    expect(state.undoDroppedCount()).toBe(5);

    state.assignBatchId(mark, 'script-1');

    const stack = state.get().undoStack;
    const stamped = stack.filter((op) => op.batchId === 'script-1');
    expect(stamped.length).toBe(5);
    expect(stamped.map((op) => op.description)).toEqual([
      'new-0', 'new-1', 'new-2', 'new-3', 'new-4',
    ]);
  });

  it('reset clears the dropped-op counter', () => {
    push(MAX_UNDO_DEPTH + 5, 'op');
    expect(state.undoDroppedCount()).toBe(5);

    state.reset();
    expect(state.undoDroppedCount()).toBe(0);
    expect(state.undoMark()).toBe(0);
  });
});
