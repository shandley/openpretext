import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData, type AppState } from '../../src/core/State';

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
});
