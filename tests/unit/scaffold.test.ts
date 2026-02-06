import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { events } from '../../src/core/EventBus';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';

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
  length = 1000,
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
// ScaffoldManager tests
// ---------------------------------------------------------------------------

describe('ScaffoldManager', () => {
  let mgr: ScaffoldManager;

  beforeEach(() => {
    state.reset();
    mgr = new ScaffoldManager();
  });

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------
  describe('createScaffold', () => {
    it('should create a scaffold with auto-generated name and color', () => {
      const id = mgr.createScaffold();

      expect(id).toBe(1);
      const scaffold = mgr.getScaffold(id);
      expect(scaffold).toBeDefined();
      expect(scaffold!.name).toBe('Scaffold 1');
      expect(scaffold!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('should create a scaffold with a custom name', () => {
      const id = mgr.createScaffold('Chromosome 1');

      const scaffold = mgr.getScaffold(id);
      expect(scaffold!.name).toBe('Chromosome 1');
    });

    it('should assign unique sequential ids', () => {
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();
      const id3 = mgr.createScaffold();

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });

    it('should assign distinct colors to multiple scaffolds', () => {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        ids.push(mgr.createScaffold());
      }
      const colors = ids.map(id => mgr.getScaffold(id)!.color);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------
  describe('deleteScaffold', () => {
    it('should remove the scaffold from the list', () => {
      const id = mgr.createScaffold();
      mgr.deleteScaffold(id);

      expect(mgr.getScaffold(id)).toBeUndefined();
      expect(mgr.getAllScaffolds().length).toBe(0);
    });

    it('should unassign contigs that belonged to the deleted scaffold', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 1], id);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.map!.contigs[1].scaffoldId).toBe(id);

      mgr.deleteScaffold(id);

      expect(s.map!.contigs[0].scaffoldId).toBeNull();
      expect(s.map!.contigs[1].scaffoldId).toBeNull();
    });

    it('should clear active scaffold if deleted scaffold was active', () => {
      const id = mgr.createScaffold();
      mgr.setActiveScaffoldId(id);
      expect(mgr.getActiveScaffoldId()).toBe(id);

      mgr.deleteScaffold(id);

      expect(mgr.getActiveScaffoldId()).toBeNull();
    });

    it('should not clear active scaffold if a different scaffold is deleted', () => {
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();
      mgr.setActiveScaffoldId(id1);

      mgr.deleteScaffold(id2);

      expect(mgr.getActiveScaffoldId()).toBe(id1);
    });

    it('should be a no-op for non-existent scaffold', () => {
      mgr.createScaffold();
      mgr.deleteScaffold(999);

      expect(mgr.getAllScaffolds().length).toBe(1);
    });

    it('should emit render:request event', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      const { collected, unsub } = collectEvents('render:request');

      mgr.deleteScaffold(id);

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });
  });

  // -----------------------------------------------------------------------
  // Rename
  // -----------------------------------------------------------------------
  describe('renameScaffold', () => {
    it('should update the scaffold name', () => {
      const id = mgr.createScaffold();
      mgr.renameScaffold(id, 'Chr1');

      expect(mgr.getScaffold(id)!.name).toBe('Chr1');
    });

    it('should be a no-op for non-existent scaffold', () => {
      mgr.renameScaffold(999, 'Ghost');
      // No error thrown
      expect(mgr.getScaffold(999)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Get all scaffolds
  // -----------------------------------------------------------------------
  describe('getAllScaffolds', () => {
    it('should return empty array when no scaffolds exist', () => {
      expect(mgr.getAllScaffolds()).toEqual([]);
    });

    it('should return all scaffolds sorted by id', () => {
      mgr.createScaffold('B');
      mgr.createScaffold('A');
      mgr.createScaffold('C');

      const all = mgr.getAllScaffolds();
      expect(all.length).toBe(3);
      expect(all[0].id).toBe(1);
      expect(all[1].id).toBe(2);
      expect(all[2].id).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Active scaffold
  // -----------------------------------------------------------------------
  describe('activeScaffold', () => {
    it('should start with no active scaffold', () => {
      expect(mgr.getActiveScaffoldId()).toBeNull();
    });

    it('should set and get active scaffold', () => {
      const id = mgr.createScaffold();
      mgr.setActiveScaffoldId(id);

      expect(mgr.getActiveScaffoldId()).toBe(id);
    });

    it('should allow clearing the active scaffold', () => {
      const id = mgr.createScaffold();
      mgr.setActiveScaffoldId(id);
      mgr.setActiveScaffoldId(null);

      expect(mgr.getActiveScaffoldId()).toBeNull();
    });

    it('should ignore setting active to a non-existent scaffold', () => {
      mgr.setActiveScaffoldId(999);
      expect(mgr.getActiveScaffoldId()).toBeNull();
    });

    it('should allow switching between scaffolds', () => {
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();

      mgr.setActiveScaffoldId(id1);
      expect(mgr.getActiveScaffoldId()).toBe(id1);

      mgr.setActiveScaffoldId(id2);
      expect(mgr.getActiveScaffoldId()).toBe(id2);
    });
  });

  // -----------------------------------------------------------------------
  // Paint contigs
  // -----------------------------------------------------------------------
  describe('paintContigs', () => {
    it('should assign scaffold id to contigs', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([0, 2], id);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.map!.contigs[1].scaffoldId).toBeNull();
      expect(s.map!.contigs[2].scaffoldId).toBe(id);
      expect(s.map!.contigs[3].scaffoldId).toBeNull();
    });

    it('should unassign contigs when scaffoldId is null', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 1, 2], id);

      mgr.paintContigs([1], null);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.map!.contigs[1].scaffoldId).toBeNull();
      expect(s.map!.contigs[2].scaffoldId).toBe(id);
    });

    it('should push a scaffold_paint operation onto the undo stack', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([0], id);

      const s = state.get();
      expect(s.undoStack.length).toBe(1);
      expect(s.undoStack[0].type).toBe('scaffold_paint');
      expect(s.undoStack[0].data.scaffoldId).toBe(id);
    });

    it('should record previous assignments for undo', () => {
      setupStandardState();
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();

      mgr.paintContigs([0], id1);
      mgr.paintContigs([0], id2);

      const s = state.get();
      const lastOp = s.undoStack[s.undoStack.length - 1];
      expect(lastOp.data.previousAssignments[0]).toBe(id1);
    });

    it('should not paint if no map is loaded', () => {
      const id = mgr.createScaffold();
      mgr.paintContigs([0], id);

      const s = state.get();
      expect(s.undoStack.length).toBe(0);
    });

    it('should not paint with a non-existent scaffold', () => {
      setupStandardState();
      mgr.paintContigs([0], 999);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBeNull();
      expect(s.undoStack.length).toBe(0);
    });

    it('should skip invalid contig indices gracefully', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([-1, 0, 99], id);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      // Only valid index was painted; operation was still recorded
      expect(s.undoStack.length).toBe(1);
    });

    it('should do nothing with an empty contig list', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([], id);

      const s = state.get();
      expect(s.undoStack.length).toBe(0);
    });

    it('should emit render:request event', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      const { collected, unsub } = collectEvents('render:request');

      mgr.paintContigs([0], id);

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });

    it('should allow reassigning from one scaffold to another', () => {
      setupStandardState();
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();

      mgr.paintContigs([0, 1], id1);
      mgr.paintContigs([0, 1], id2);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id2);
      expect(s.map!.contigs[1].scaffoldId).toBe(id2);
    });
  });

  // -----------------------------------------------------------------------
  // Get contigs in scaffold
  // -----------------------------------------------------------------------
  describe('getContigsInScaffold', () => {
    it('should return order-indices of contigs in the scaffold', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 2, 3], id);

      const indices = mgr.getContigsInScaffold(id);
      expect(indices).toEqual([0, 2, 3]);
    });

    it('should return empty array for scaffold with no contigs', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      expect(mgr.getContigsInScaffold(id)).toEqual([]);
    });

    it('should return empty array when no map is loaded', () => {
      expect(mgr.getContigsInScaffold(1)).toEqual([]);
    });

    it('should reflect changes after painting', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([0], id);
      expect(mgr.getContigsInScaffold(id)).toEqual([0]);

      mgr.paintContigs([1, 2], id);
      expect(mgr.getContigsInScaffold(id)).toEqual([0, 1, 2]);

      mgr.paintContigs([0], null); // unpaint
      expect(mgr.getContigsInScaffold(id)).toEqual([1, 2]);
    });
  });

  // -----------------------------------------------------------------------
  // Undo / Redo support
  // -----------------------------------------------------------------------
  describe('undoPaint', () => {
    it('should restore previous scaffold assignments', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 1], id);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.map!.contigs[1].scaffoldId).toBe(id);

      const op = s.undoStack[s.undoStack.length - 1];
      mgr.undoPaint(op);

      expect(s.map!.contigs[0].scaffoldId).toBeNull();
      expect(s.map!.contigs[1].scaffoldId).toBeNull();
    });

    it('should restore mixed previous assignments', () => {
      setupStandardState();
      const id1 = mgr.createScaffold();
      const id2 = mgr.createScaffold();

      mgr.paintContigs([0], id1);
      mgr.paintContigs([0, 1], id2);

      const s = state.get();
      const op = s.undoStack[s.undoStack.length - 1];
      mgr.undoPaint(op);

      // contig 0 should revert to id1, contig 1 should revert to null
      expect(s.map!.contigs[0].scaffoldId).toBe(id1);
      expect(s.map!.contigs[1].scaffoldId).toBeNull();
    });
  });

  describe('reapplyPaint', () => {
    it('should re-apply scaffold assignments', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 1], id);

      const s = state.get();
      const op = s.undoStack[s.undoStack.length - 1];

      // Simulate undo
      mgr.undoPaint(op);
      expect(s.map!.contigs[0].scaffoldId).toBeNull();

      // Reapply
      mgr.reapplyPaint(op);
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.map!.contigs[1].scaffoldId).toBe(id);
    });
  });

  // -----------------------------------------------------------------------
  // Color generation
  // -----------------------------------------------------------------------
  describe('color generation', () => {
    it('should cycle through palette colors', () => {
      // Create more scaffolds than palette colors (18) to test wrapping
      const ids: number[] = [];
      for (let i = 0; i < 20; i++) {
        ids.push(mgr.createScaffold());
      }

      // First 18 should have unique colors
      const first18Colors = ids.slice(0, 18).map(id => mgr.getScaffold(id)!.color);
      const uniqueFirst18 = new Set(first18Colors);
      expect(uniqueFirst18.size).toBe(18);

      // 19th scaffold should wrap to first color
      const color19 = mgr.getScaffold(ids[18])!.color;
      expect(color19).toBe(mgr.getScaffold(ids[0])!.color);
    });

    it('should produce valid hex colors', () => {
      for (let i = 0; i < 20; i++) {
        const id = mgr.createScaffold();
        const color = mgr.getScaffold(id)!.color;
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle creating scaffold after deleting one', () => {
      const id1 = mgr.createScaffold();
      mgr.deleteScaffold(id1);

      const id2 = mgr.createScaffold();
      expect(id2).toBe(2); // IDs are never reused
      expect(mgr.getAllScaffolds().length).toBe(1);
    });

    it('should handle painting all contigs then deleting scaffold', () => {
      setupStandardState();
      const id = mgr.createScaffold();
      mgr.paintContigs([0, 1, 2, 3], id);

      mgr.deleteScaffold(id);

      const s = state.get();
      for (const contig of s.map!.contigs) {
        expect(contig.scaffoldId).toBeNull();
      }
    });

    it('should handle multiple scaffolds on different contigs', () => {
      setupStandardState();
      const id1 = mgr.createScaffold('Scaffold A');
      const id2 = mgr.createScaffold('Scaffold B');

      mgr.paintContigs([0, 1], id1);
      mgr.paintContigs([2, 3], id2);

      expect(mgr.getContigsInScaffold(id1)).toEqual([0, 1]);
      expect(mgr.getContigsInScaffold(id2)).toEqual([2, 3]);

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id1);
      expect(s.map!.contigs[1].scaffoldId).toBe(id1);
      expect(s.map!.contigs[2].scaffoldId).toBe(id2);
      expect(s.map!.contigs[3].scaffoldId).toBe(id2);
    });

    it('should handle painting same contig multiple times', () => {
      setupStandardState();
      const id = mgr.createScaffold();

      mgr.paintContigs([0], id);
      mgr.paintContigs([0], id); // paint again with same scaffold

      const s = state.get();
      expect(s.map!.contigs[0].scaffoldId).toBe(id);
      expect(s.undoStack.length).toBe(2); // Both operations recorded
    });
  });
});
