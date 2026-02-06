import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { events } from '../../src/core/EventBus';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { SelectionManager } from '../../src/curation/SelectionManager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal MapData with the given contigs for testing.
 */
function makeTestMap(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test.pretext',
    textureSize: 1024,
    numMipMaps: 1,
    contigs,
    textures: [new Float32Array(0)],
    extensions: new Map(),
  };
}

/**
 * Create a simple contig for testing purposes.
 */
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

/**
 * Set up a standard test state with 4 contigs of 100 pixels each.
 */
function setupStandardState(): void {
  const contigs = [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
    makeContig('chr3', 2, 200, 300, 6000),
    makeContig('chr4', 3, 300, 400, 4000),
  ];
  const map = makeTestMap(contigs);
  state.update({
    map,
    contigOrder: [0, 1, 2, 3],
  });
}

/**
 * Collect emitted events into an array for assertions.
 */
function collectEvents(eventName: keyof import('../../src/core/EventBus').AppEvents) {
  const collected: any[] = [];
  const unsub = events.on(eventName, (data: any) => collected.push(data));
  return { collected, unsub };
}

// ---------------------------------------------------------------------------
// CurationEngine tests
// ---------------------------------------------------------------------------

describe('CurationEngine', () => {
  beforeEach(() => {
    state.reset();
  });

  // -----------------------------------------------------------------------
  // CUT
  // -----------------------------------------------------------------------
  describe('cut', () => {
    it('should split a contig into two at the given pixel offset', () => {
      setupStandardState();

      CurationEngine.cut(0, 50);

      const s = state.get();
      // Original 4 contigs + 2 new = 6 contigs total in map
      expect(s.map!.contigs.length).toBe(6);
      // Order now has 5 entries (replaced 1 with 2)
      expect(s.contigOrder.length).toBe(5);

      // The first two entries should be the new contigs
      const leftId = s.contigOrder[0];
      const rightId = s.contigOrder[1];
      const left = s.map!.contigs[leftId];
      const right = s.map!.contigs[rightId];

      expect(left.name).toBe('chr1_L');
      expect(right.name).toBe('chr1_R');
      expect(left.pixelStart).toBe(0);
      expect(left.pixelEnd).toBe(50);
      expect(right.pixelStart).toBe(50);
      expect(right.pixelEnd).toBe(100);
    });

    it('should correctly split base pair length proportionally', () => {
      setupStandardState();

      CurationEngine.cut(0, 50); // 50% split of 100-pixel contig

      const s = state.get();
      const leftId = s.contigOrder[0];
      const rightId = s.contigOrder[1];
      const left = s.map!.contigs[leftId];
      const right = s.map!.contigs[rightId];

      // Original chr1 has 10000 bp, split at 50%
      expect(left.length + right.length).toBe(10000);
      expect(left.length).toBe(5000);
      expect(right.length).toBe(5000);
    });

    it('should record operation on the undo stack', () => {
      setupStandardState();

      CurationEngine.cut(1, 30);

      const s = state.get();
      expect(s.undoStack.length).toBe(1);
      expect(s.undoStack[0].type).toBe('cut');
      expect(s.redoStack.length).toBe(0);
    });

    it('should emit curation:cut and render:request events', () => {
      setupStandardState();
      const { collected: cutEvents, unsub: unsub1 } = collectEvents('curation:cut');
      const { collected: renderEvents, unsub: unsub2 } = collectEvents('render:request');

      CurationEngine.cut(0, 50);

      expect(cutEvents.length).toBe(1);
      expect(cutEvents[0]).toEqual({ contigIndex: 0, position: 50 });
      expect(renderEvents.length).toBe(1);

      unsub1();
      unsub2();
    });

    it('should throw when no map is loaded', () => {
      expect(() => CurationEngine.cut(0, 50)).toThrow('No map loaded');
    });

    it('should throw for invalid contig index', () => {
      setupStandardState();
      expect(() => CurationEngine.cut(-1, 50)).toThrow('Invalid contigIndex');
      expect(() => CurationEngine.cut(4, 50)).toThrow('Invalid contigIndex');
      expect(() => CurationEngine.cut(1.5, 50)).toThrow('Invalid contigIndex');
    });

    it('should throw for pixel offset at boundary (0)', () => {
      setupStandardState();
      expect(() => CurationEngine.cut(0, 0)).toThrow('Invalid pixelOffset');
    });

    it('should throw for pixel offset at boundary (full length)', () => {
      setupStandardState();
      // chr1 is 100 pixels, offset 100 is at the boundary
      expect(() => CurationEngine.cut(0, 100)).toThrow('Invalid pixelOffset');
    });

    it('should throw for non-integer pixel offset', () => {
      setupStandardState();
      expect(() => CurationEngine.cut(0, 50.5)).toThrow('Invalid pixelOffset');
    });

    it('should swap L/R naming for inverted contigs', () => {
      setupStandardState();
      // First invert chr1, then cut it
      CurationEngine.invert(0);
      CurationEngine.cut(0, 50);

      const s = state.get();
      const leftId = s.contigOrder[0];
      const rightId = s.contigOrder[1];
      // For inverted contig, display-left = genome-right
      expect(s.map!.contigs[leftId].name).toBe('chr1_R');
      expect(s.map!.contigs[rightId].name).toBe('chr1_L');
    });

    it('should preserve remaining contig order', () => {
      setupStandardState();

      CurationEngine.cut(1, 30); // cut chr2

      const s = state.get();
      // Order should be: [chr1, chr2_L, chr2_R, chr3, chr4]
      expect(s.contigOrder.length).toBe(5);
      expect(s.contigOrder[0]).toBe(0); // chr1 unchanged
      expect(s.contigOrder[3]).toBe(2); // chr3 unchanged
      expect(s.contigOrder[4]).toBe(3); // chr4 unchanged
    });
  });

  // -----------------------------------------------------------------------
  // JOIN
  // -----------------------------------------------------------------------
  describe('join', () => {
    it('should merge two adjacent contigs', () => {
      setupStandardState();

      CurationEngine.join(1); // join chr2 and chr3

      const s = state.get();
      expect(s.contigOrder.length).toBe(3);
      expect(s.map!.contigs.length).toBe(5); // 4 original + 1 merged

      const mergedId = s.contigOrder[1];
      const merged = s.map!.contigs[mergedId];
      expect(merged.name).toBe('chr2+chr3');
      expect(merged.length).toBe(8000 + 6000);
      expect(merged.pixelStart).toBe(100);
      expect(merged.pixelEnd).toBe(300);
    });

    it('should preserve surrounding contig order', () => {
      setupStandardState();

      CurationEngine.join(1);

      const s = state.get();
      expect(s.contigOrder[0]).toBe(0); // chr1
      expect(s.contigOrder[2]).toBe(3); // chr4
    });

    it('should record operation on the undo stack', () => {
      setupStandardState();

      CurationEngine.join(0);

      const s = state.get();
      expect(s.undoStack.length).toBe(1);
      expect(s.undoStack[0].type).toBe('join');
    });

    it('should emit curation:join event', () => {
      setupStandardState();
      const { collected, unsub } = collectEvents('curation:join');

      CurationEngine.join(0);

      expect(collected.length).toBe(1);
      expect(collected[0]).toEqual({ contigIndex: 0 });

      unsub();
    });

    it('should throw when joining the last contig (no right neighbor)', () => {
      setupStandardState();
      expect(() => CurationEngine.join(3)).toThrow('no adjacent contig');
    });

    it('should throw for invalid index', () => {
      setupStandardState();
      expect(() => CurationEngine.join(-1)).toThrow('Invalid contigIndex');
      expect(() => CurationEngine.join(4)).toThrow('Invalid contigIndex');
    });

    it('should throw when no map is loaded', () => {
      expect(() => CurationEngine.join(0)).toThrow('No map loaded');
    });

    it('should handle joining first two contigs', () => {
      setupStandardState();

      CurationEngine.join(0);

      const s = state.get();
      const mergedId = s.contigOrder[0];
      const merged = s.map!.contigs[mergedId];
      expect(merged.name).toBe('chr1+chr2');
      expect(merged.length).toBe(10000 + 8000);
    });
  });

  // -----------------------------------------------------------------------
  // INVERT
  // -----------------------------------------------------------------------
  describe('invert', () => {
    it('should toggle the inverted flag', () => {
      setupStandardState();

      CurationEngine.invert(0);

      const s = state.get();
      const contigId = s.contigOrder[0];
      expect(s.map!.contigs[contigId].inverted).toBe(true);
    });

    it('should toggle back on second invert', () => {
      setupStandardState();

      CurationEngine.invert(0);
      CurationEngine.invert(0);

      const s = state.get();
      const contigId = s.contigOrder[0];
      expect(s.map!.contigs[contigId].inverted).toBe(false);
    });

    it('should record operation on the undo stack', () => {
      setupStandardState();

      CurationEngine.invert(2);

      const s = state.get();
      expect(s.undoStack.length).toBe(1);
      expect(s.undoStack[0].type).toBe('invert');
      expect(s.undoStack[0].data.previousInverted).toBe(false);
    });

    it('should emit curation:invert event', () => {
      setupStandardState();
      const { collected, unsub } = collectEvents('curation:invert');

      CurationEngine.invert(1);

      expect(collected.length).toBe(1);
      expect(collected[0]).toEqual({ contigIndex: 1 });

      unsub();
    });

    it('should throw for invalid index', () => {
      setupStandardState();
      expect(() => CurationEngine.invert(-1)).toThrow('Invalid contigIndex');
      expect(() => CurationEngine.invert(99)).toThrow('Invalid contigIndex');
    });

    it('should throw when no map is loaded', () => {
      expect(() => CurationEngine.invert(0)).toThrow('No map loaded');
    });

    it('should not affect other contigs', () => {
      setupStandardState();

      CurationEngine.invert(1);

      const s = state.get();
      expect(s.map!.contigs[0].inverted).toBe(false);
      expect(s.map!.contigs[2].inverted).toBe(false);
      expect(s.map!.contigs[3].inverted).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // MOVE
  // -----------------------------------------------------------------------
  describe('move', () => {
    it('should move a contig forward in the order', () => {
      setupStandardState();

      CurationEngine.move(0, 2); // move chr1 from index 0 to index 2

      const s = state.get();
      // After removing index 0: [chr2, chr3, chr4]
      // Insert at index 2-1=1: [chr2, chr1, chr3, chr4]
      expect(s.contigOrder).toEqual([1, 0, 2, 3]);
    });

    it('should move a contig backward in the order', () => {
      setupStandardState();

      CurationEngine.move(3, 1); // move chr4 from index 3 to index 1

      const s = state.get();
      // After removing index 3: [chr1, chr2, chr3]
      // Insert at index 1: [chr1, chr4, chr2, chr3]
      expect(s.contigOrder).toEqual([0, 3, 1, 2]);
    });

    it('should handle move to beginning', () => {
      setupStandardState();

      CurationEngine.move(2, 0); // move chr3 to front

      const s = state.get();
      expect(s.contigOrder).toEqual([2, 0, 1, 3]);
    });

    it('should handle move to end', () => {
      setupStandardState();

      CurationEngine.move(0, 3); // move chr1 to end

      const s = state.get();
      // After removing index 0: [chr2, chr3, chr4]
      // Insert at index 3-1=2: [chr2, chr3, chr1, chr4]
      // Wait - toIndex=3 means position 3 in the original array.
      // Remove from 0 -> [1,2,3], insert at 3-1=2 -> [1,2,0,3]
      expect(s.contigOrder).toEqual([1, 2, 0, 3]);
    });

    it('should be a no-op when moving to the same position', () => {
      setupStandardState();

      CurationEngine.move(1, 1);

      const s = state.get();
      expect(s.contigOrder).toEqual([0, 1, 2, 3]);
      // No operation should be pushed
      expect(s.undoStack.length).toBe(0);
    });

    it('should record operation on the undo stack', () => {
      setupStandardState();

      CurationEngine.move(0, 2);

      const s = state.get();
      expect(s.undoStack.length).toBe(1);
      expect(s.undoStack[0].type).toBe('move');
    });

    it('should emit curation:move event', () => {
      setupStandardState();
      const { collected, unsub } = collectEvents('curation:move');

      CurationEngine.move(1, 3);

      expect(collected.length).toBe(1);
      expect(collected[0]).toEqual({ fromIndex: 1, toIndex: 3 });

      unsub();
    });

    it('should throw for invalid fromIndex', () => {
      setupStandardState();
      expect(() => CurationEngine.move(-1, 2)).toThrow('Invalid fromIndex');
      expect(() => CurationEngine.move(4, 2)).toThrow('Invalid fromIndex');
    });

    it('should throw for invalid toIndex', () => {
      setupStandardState();
      expect(() => CurationEngine.move(0, -1)).toThrow('Invalid toIndex');
      expect(() => CurationEngine.move(0, 4)).toThrow('Invalid toIndex');
    });

    it('should throw when no map is loaded', () => {
      expect(() => CurationEngine.move(0, 1)).toThrow('No map loaded');
    });
  });

  // -----------------------------------------------------------------------
  // UNDO / REDO
  // -----------------------------------------------------------------------
  describe('undo', () => {
    it('should return false when undo stack is empty', () => {
      expect(CurationEngine.undo()).toBe(false);
    });

    it('should undo a cut operation', () => {
      setupStandardState();
      const originalOrder = [...state.get().contigOrder];

      CurationEngine.cut(0, 50);
      expect(state.get().contigOrder.length).toBe(5);

      CurationEngine.undo();
      expect(state.get().contigOrder).toEqual(originalOrder);
    });

    it('should undo a join operation', () => {
      setupStandardState();
      const originalOrder = [...state.get().contigOrder];

      CurationEngine.join(1);
      expect(state.get().contigOrder.length).toBe(3);

      CurationEngine.undo();
      expect(state.get().contigOrder).toEqual(originalOrder);
    });

    it('should undo an invert operation', () => {
      setupStandardState();

      CurationEngine.invert(2);
      expect(state.get().map!.contigs[2].inverted).toBe(true);

      CurationEngine.undo();
      expect(state.get().map!.contigs[2].inverted).toBe(false);
    });

    it('should undo a move operation', () => {
      setupStandardState();
      const originalOrder = [...state.get().contigOrder];

      CurationEngine.move(0, 3);
      expect(state.get().contigOrder).not.toEqual(originalOrder);

      CurationEngine.undo();
      expect(state.get().contigOrder).toEqual(originalOrder);
    });

    it('should move operation to redo stack', () => {
      setupStandardState();

      CurationEngine.invert(0);
      expect(state.get().undoStack.length).toBe(1);

      CurationEngine.undo();
      expect(state.get().undoStack.length).toBe(0);
      expect(state.get().redoStack.length).toBe(1);
    });

    it('should emit curation:undo event', () => {
      setupStandardState();
      CurationEngine.invert(0);

      const { collected, unsub } = collectEvents('curation:undo');
      CurationEngine.undo();

      expect(collected.length).toBe(1);
      unsub();
    });

    it('should handle multiple sequential undos', () => {
      setupStandardState();
      const originalOrder = [...state.get().contigOrder];

      CurationEngine.invert(0);
      CurationEngine.move(1, 3);
      CurationEngine.invert(2);

      CurationEngine.undo(); // undo invert(2)
      CurationEngine.undo(); // undo move(1,3)
      CurationEngine.undo(); // undo invert(0)

      expect(state.get().contigOrder).toEqual(originalOrder);
      expect(state.get().map!.contigs[0].inverted).toBe(false);
      expect(state.get().map!.contigs[2].inverted).toBe(false);
    });
  });

  describe('redo', () => {
    it('should return false when redo stack is empty', () => {
      expect(CurationEngine.redo()).toBe(false);
    });

    it('should redo an undone invert', () => {
      setupStandardState();

      CurationEngine.invert(1);
      CurationEngine.undo();
      expect(state.get().map!.contigs[1].inverted).toBe(false);

      CurationEngine.redo();
      expect(state.get().map!.contigs[1].inverted).toBe(true);
    });

    it('should redo an undone move', () => {
      setupStandardState();

      CurationEngine.move(0, 3);
      const afterMoveOrder = [...state.get().contigOrder];

      CurationEngine.undo();
      CurationEngine.redo();

      expect(state.get().contigOrder).toEqual(afterMoveOrder);
    });

    it('should redo an undone cut', () => {
      setupStandardState();

      CurationEngine.cut(0, 50);
      const afterCutOrder = [...state.get().contigOrder];

      CurationEngine.undo();
      expect(state.get().contigOrder.length).toBe(4);

      CurationEngine.redo();
      expect(state.get().contigOrder).toEqual(afterCutOrder);
    });

    it('should redo an undone join', () => {
      setupStandardState();

      CurationEngine.join(1);
      const afterJoinOrder = [...state.get().contigOrder];

      CurationEngine.undo();
      expect(state.get().contigOrder.length).toBe(4);

      CurationEngine.redo();
      expect(state.get().contigOrder).toEqual(afterJoinOrder);
    });

    it('should emit curation:redo event', () => {
      setupStandardState();
      CurationEngine.invert(0);
      CurationEngine.undo();

      const { collected, unsub } = collectEvents('curation:redo');
      CurationEngine.redo();

      expect(collected.length).toBe(1);
      unsub();
    });

    it('should clear redo stack when a new operation is performed', () => {
      setupStandardState();

      CurationEngine.invert(0);
      CurationEngine.undo();
      expect(state.get().redoStack.length).toBe(1);

      CurationEngine.invert(1); // new operation clears redo
      expect(state.get().redoStack.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Combined operations
  // -----------------------------------------------------------------------
  describe('combined operations', () => {
    it('should handle cut followed by join to restore original', () => {
      setupStandardState();
      const originalOrder = [...state.get().contigOrder];

      CurationEngine.cut(0, 50);
      expect(state.get().contigOrder.length).toBe(5);

      // Join the two halves back together
      CurationEngine.join(0);
      expect(state.get().contigOrder.length).toBe(4);
    });

    it('should handle invert then move', () => {
      setupStandardState();

      CurationEngine.invert(0);
      CurationEngine.move(0, 2);

      const s = state.get();
      // chr1 (inverted) should now be at position 1
      const chr1Id = 0;
      expect(s.map!.contigs[chr1Id].inverted).toBe(true);
      expect(s.contigOrder[1]).toBe(chr1Id);
    });

    it('should undo multiple operations in reverse order', () => {
      setupStandardState();
      const original = {
        order: [...state.get().contigOrder],
        inverted: state.get().map!.contigs.map(c => c.inverted),
      };

      CurationEngine.invert(0);
      CurationEngine.move(0, 3);
      CurationEngine.cut(0, 30);

      // Undo all three
      CurationEngine.undo();
      CurationEngine.undo();
      CurationEngine.undo();

      const s = state.get();
      expect(s.contigOrder).toEqual(original.order);
      // Check that original contigs have correct inverted state
      for (let i = 0; i < 4; i++) {
        expect(s.map!.contigs[i].inverted).toBe(original.inverted[i]);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// SelectionManager tests
// ---------------------------------------------------------------------------

describe('SelectionManager', () => {
  beforeEach(() => {
    state.reset();
  });

  function setupSelectionState(): void {
    const contigs = [
      makeContig('chr1', 0, 0, 100),
      makeContig('chr2', 1, 100, 200),
      makeContig('chr3', 2, 200, 300),
      makeContig('chr4', 3, 300, 400),
    ];
    const map = makeTestMap(contigs);
    state.update({
      map,
      contigOrder: [0, 1, 2, 3],
    });
  }

  describe('selectSingle', () => {
    it('should select a single contig and clear previous selection', () => {
      setupSelectionState();

      SelectionManager.selectSingle(1);
      expect(SelectionManager.getSelectedIndices()).toEqual([1]);

      SelectionManager.selectSingle(2);
      expect(SelectionManager.getSelectedIndices()).toEqual([2]);
    });

    it('should emit contig:selected event', () => {
      setupSelectionState();
      const { collected, unsub } = collectEvents('contig:selected');

      SelectionManager.selectSingle(0);

      expect(collected.length).toBe(1);
      expect(collected[0]).toEqual({ index: 0, name: 'chr1' });
      unsub();
    });

    it('should ignore invalid index', () => {
      setupSelectionState();

      SelectionManager.selectSingle(-1);
      expect(SelectionManager.getSelectedIndices()).toEqual([]);

      SelectionManager.selectSingle(99);
      expect(SelectionManager.getSelectedIndices()).toEqual([]);
    });

    it('should do nothing when no map is loaded', () => {
      SelectionManager.selectSingle(0);
      expect(SelectionManager.getSelectedIndices()).toEqual([]);
    });
  });

  describe('selectToggle', () => {
    it('should add a contig to existing selection', () => {
      setupSelectionState();

      SelectionManager.selectSingle(0);
      SelectionManager.selectToggle(2);

      expect(SelectionManager.getSelectedIndices()).toEqual([0, 2]);
    });

    it('should remove a contig if already selected', () => {
      setupSelectionState();

      SelectionManager.selectSingle(1);
      SelectionManager.selectToggle(2);
      SelectionManager.selectToggle(1);

      expect(SelectionManager.getSelectedIndices()).toEqual([2]);
    });

    it('should emit deselected event when toggling off', () => {
      setupSelectionState();
      SelectionManager.selectSingle(0);

      const { collected, unsub } = collectEvents('contig:deselected');
      SelectionManager.selectToggle(0);

      expect(collected.length).toBe(1);
      unsub();
    });
  });

  describe('selectRange', () => {
    it('should select contiguous range from anchor to target', () => {
      setupSelectionState();

      SelectionManager.selectSingle(1); // anchor
      SelectionManager.selectRange(3);

      expect(SelectionManager.getSelectedIndices()).toEqual([1, 2, 3]);
    });

    it('should handle backward ranges', () => {
      setupSelectionState();

      SelectionManager.selectSingle(3); // anchor
      SelectionManager.selectRange(1);

      expect(SelectionManager.getSelectedIndices()).toEqual([1, 2, 3]);
    });

    it('should behave like selectSingle when nothing is selected', () => {
      setupSelectionState();

      SelectionManager.selectRange(2);

      expect(SelectionManager.getSelectedIndices()).toEqual([2]);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selections', () => {
      setupSelectionState();

      SelectionManager.selectSingle(0);
      SelectionManager.selectToggle(1);
      SelectionManager.clearSelection();

      expect(SelectionManager.getSelectedIndices()).toEqual([]);
    });

    it('should emit contig:deselected event', () => {
      setupSelectionState();
      SelectionManager.selectSingle(0);

      const { collected, unsub } = collectEvents('contig:deselected');
      SelectionManager.clearSelection();

      expect(collected.length).toBe(1);
      unsub();
    });
  });

  describe('selectAll', () => {
    it('should select all contigs', () => {
      setupSelectionState();

      SelectionManager.selectAll();

      expect(SelectionManager.getSelectedIndices()).toEqual([0, 1, 2, 3]);
    });
  });

  describe('getSelectedContigs', () => {
    it('should return ContigInfo objects for selected contigs', () => {
      setupSelectionState();

      SelectionManager.selectSingle(1);
      SelectionManager.selectToggle(3);

      const selected = SelectionManager.getSelectedContigs();
      expect(selected.length).toBe(2);
      expect(selected[0].name).toBe('chr2');
      expect(selected[1].name).toBe('chr4');
    });

    it('should return empty array when nothing is selected', () => {
      setupSelectionState();
      expect(SelectionManager.getSelectedContigs()).toEqual([]);
    });

    it('should return empty array when no map is loaded', () => {
      expect(SelectionManager.getSelectedContigs()).toEqual([]);
    });
  });

  describe('hitTestContig', () => {
    it('should find the correct contig at a given pixel position', () => {
      setupSelectionState();

      const result = SelectionManager.hitTestContig(150);

      expect(result).not.toBeNull();
      expect(result!.orderIndex).toBe(1);
      expect(result!.contig.name).toBe('chr2');
      expect(result!.pixelOffset).toBe(50);
    });

    it('should return the first contig for position 0', () => {
      setupSelectionState();

      const result = SelectionManager.hitTestContig(0);

      expect(result).not.toBeNull();
      expect(result!.orderIndex).toBe(0);
      expect(result!.contig.name).toBe('chr1');
      expect(result!.pixelOffset).toBe(0);
    });

    it('should return null for positions beyond total span', () => {
      setupSelectionState();

      const result = SelectionManager.hitTestContig(500);

      expect(result).toBeNull();
    });

    it('should return null when no map is loaded', () => {
      const result = SelectionManager.hitTestContig(50);
      expect(result).toBeNull();
    });

    it('should handle contig boundaries correctly', () => {
      setupSelectionState();

      // Position 100 is the start of chr2 (end of chr1)
      const result = SelectionManager.hitTestContig(100);

      expect(result).not.toBeNull();
      expect(result!.orderIndex).toBe(1);
      expect(result!.contig.name).toBe('chr2');
      expect(result!.pixelOffset).toBe(0);
    });
  });

  describe('getTotalPixelSpan', () => {
    it('should return total pixel span of all contigs', () => {
      setupSelectionState();

      expect(SelectionManager.getTotalPixelSpan()).toBe(400);
    });

    it('should return 0 when no map is loaded', () => {
      expect(SelectionManager.getTotalPixelSpan()).toBe(0);
    });
  });
});
