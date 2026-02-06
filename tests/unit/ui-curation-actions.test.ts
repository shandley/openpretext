import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/curation/CurationEngine', () => ({
  CurationEngine: {
    undo: vi.fn(),
    redo: vi.fn(),
    invert: vi.fn(),
    cut: vi.fn(),
    join: vi.fn(),
    move: vi.fn(),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    getSelectedIndices: vi.fn(() => []),
    clearSelection: vi.fn(),
  },
}));

vi.mock('../../src/curation/ContigExclusion', () => ({
  contigExclusion: {
    toggle: vi.fn(),
  },
}));

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
      selectedContigs: new Set(),
    })),
  },
}));

import {
  performUndo,
  performRedo,
  invertSelectedContigs,
  cutAtCursorPosition,
  joinSelectedContigs,
  toggleContigExclusion,
} from '../../src/ui/CurationActions';

import { CurationEngine } from '../../src/curation/CurationEngine';
import { SelectionManager } from '../../src/curation/SelectionManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { state } from '../../src/core/State';

import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// Helper: create a mock AppContext
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Partial<AppContext> = {}): AppContext {
  return {
    showToast: vi.fn(),
    refreshAfterCuration: vi.fn(),
    updateSidebarContigList: vi.fn(),
    updateSidebarScaffoldList: vi.fn(),
    updateStatsPanel: vi.fn(),
    updateTrackConfigPanel: vi.fn(),
    rebuildContigBoundaries: vi.fn(),
    setMode: vi.fn(),
    formatBp: vi.fn(),
    currentMode: 'edit',
    hoveredContigIndex: -1,
    contigBoundaries: [],
    mouseMapPos: { x: 0, y: 0 },
    currentColorMap: 'red-white',
    tracksVisible: false,
    currentWaypointId: null,
    animFrameId: 0,
    referenceSequences: null,
    comparisonSnapshot: null,
    comparisonVisible: false,
    renderer: {} as any,
    labelRenderer: {} as any,
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {} as any,
    dragReorder: {} as any,
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CurationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // performUndo
  // -------------------------------------------------------------------------
  describe('performUndo', () => {
    it('should call CurationEngine.undo and show toast when undo succeeds', () => {
      (CurationEngine.undo as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const ctx = createMockCtx();

      performUndo(ctx);

      expect(CurationEngine.undo).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Undo');
    });

    it('should call CurationEngine.undo and NOT show toast when undo fails', () => {
      (CurationEngine.undo as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const ctx = createMockCtx();

      performUndo(ctx);

      expect(CurationEngine.undo).toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // performRedo
  // -------------------------------------------------------------------------
  describe('performRedo', () => {
    it('should call CurationEngine.redo and show toast when redo succeeds', () => {
      (CurationEngine.redo as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const ctx = createMockCtx();

      performRedo(ctx);

      expect(CurationEngine.redo).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Redo');
    });

    it('should call CurationEngine.redo and NOT show toast when redo fails', () => {
      (CurationEngine.redo as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const ctx = createMockCtx();

      performRedo(ctx);

      expect(CurationEngine.redo).toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // invertSelectedContigs
  // -------------------------------------------------------------------------
  describe('invertSelectedContigs', () => {
    it('should show error toast when no contigs are selected', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx();

      invertSelectedContigs(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No contigs selected');
      expect(CurationEngine.invert).not.toHaveBeenCalled();
    });

    it('should invert a single selected contig', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([2]);
      const ctx = createMockCtx();

      invertSelectedContigs(ctx);

      expect(CurationEngine.invert).toHaveBeenCalledWith(2);
      expect(CurationEngine.invert).toHaveBeenCalledTimes(1);
      expect(ctx.showToast).toHaveBeenCalledWith('Inverted 1 contig(s)');
    });

    it('should invert multiple selected contigs', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([0, 1, 3]);
      const ctx = createMockCtx();

      invertSelectedContigs(ctx);

      expect(CurationEngine.invert).toHaveBeenCalledTimes(3);
      expect(CurationEngine.invert).toHaveBeenCalledWith(0);
      expect(CurationEngine.invert).toHaveBeenCalledWith(1);
      expect(CurationEngine.invert).toHaveBeenCalledWith(3);
      expect(ctx.showToast).toHaveBeenCalledWith('Inverted 3 contig(s)');
    });
  });

  // -------------------------------------------------------------------------
  // cutAtCursorPosition
  // -------------------------------------------------------------------------
  describe('cutAtCursorPosition', () => {
    it('should be a no-op when not in edit mode', () => {
      const ctx = createMockCtx({ currentMode: 'navigate' });

      cutAtCursorPosition(ctx);

      expect(ctx.showToast).not.toHaveBeenCalled();
      expect(CurationEngine.cut).not.toHaveBeenCalled();
    });

    it('should be a no-op when in scaffold mode', () => {
      const ctx = createMockCtx({ currentMode: 'scaffold' });

      cutAtCursorPosition(ctx);

      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should show toast when no map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null, contigOrder: [] });
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });

      cutAtCursorPosition(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Hover over a contig to cut');
    });

    it('should show toast when hoveredContigIndex is -1 (no hover)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [{ name: 'chr1', pixelStart: 0, pixelEnd: 100 }] },
        contigOrder: [0],
      });
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });

      cutAtCursorPosition(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Hover over a contig to cut');
    });

    it('should perform cut when in edit mode with valid hover', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 100 },
          ],
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx({
        currentMode: 'edit',
        hoveredContigIndex: 0,
        contigBoundaries: [100],
        mouseMapPos: { x: 50, y: 50 },
      });

      cutAtCursorPosition(ctx);

      expect(CurationEngine.cut).toHaveBeenCalledWith(0, 50);
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Cut: chr1 at offset 50');
    });

    it('should show toast when cut position is at the edge of the contig', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 100 },
          ],
        },
        contigOrder: [0],
      });
      // mouseMapPos.x = 0 means fraction = 0, pixelOffset = 0
      const ctx = createMockCtx({
        currentMode: 'edit',
        hoveredContigIndex: 0,
        contigBoundaries: [100],
        mouseMapPos: { x: 0, y: 0 },
      });

      cutAtCursorPosition(ctx);

      expect(CurationEngine.cut).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Cannot cut at edge of contig');
    });
  });

  // -------------------------------------------------------------------------
  // joinSelectedContigs
  // -------------------------------------------------------------------------
  describe('joinSelectedContigs', () => {
    it('should be a no-op when not in edit mode', () => {
      const ctx = createMockCtx({ currentMode: 'navigate' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should show toast with 0 selected contigs', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Select 1 or 2 adjacent contigs to join');
    });

    it('should join with right neighbor when 1 contig is selected', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([1]);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        contigOrder: [0, 1, 2, 3],
      });
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).toHaveBeenCalledWith(1);
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Joined contigs');
    });

    it('should show toast when single selected contig has no right neighbor', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([3]);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        contigOrder: [0, 1, 2, 3],
      });
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('No right neighbor to join with');
    });

    it('should join 2 adjacent selected contigs', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([2, 3]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).toHaveBeenCalledWith(2);
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Joined contigs');
    });

    it('should sort 2 selected contigs before joining (reversed selection order)', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([5, 4]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      // Should call join with the lower index
      expect(CurationEngine.join).toHaveBeenCalledWith(4);
    });

    it('should show toast when 2 selected contigs are not adjacent', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([1, 3]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Selected contigs must be adjacent to join');
    });

    it('should show toast when 3+ contigs are selected', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([0, 1, 2]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      joinSelectedContigs(ctx);

      expect(CurationEngine.join).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Select 1 or 2 adjacent contigs to join');
    });
  });

  // -------------------------------------------------------------------------
  // toggleContigExclusion
  // -------------------------------------------------------------------------
  describe('toggleContigExclusion', () => {
    it('should be a no-op when not in edit mode', () => {
      const ctx = createMockCtx({ currentMode: 'navigate' });

      toggleContigExclusion(ctx);

      expect(contigExclusion.toggle).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should toggle exclusion for all selected contigs', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([0, 2, 4]);
      const ctx = createMockCtx({ currentMode: 'edit' });

      toggleContigExclusion(ctx);

      expect(contigExclusion.toggle).toHaveBeenCalledTimes(3);
      expect(contigExclusion.toggle).toHaveBeenCalledWith(0);
      expect(contigExclusion.toggle).toHaveBeenCalledWith(2);
      expect(contigExclusion.toggle).toHaveBeenCalledWith(4);
      expect(ctx.showToast).toHaveBeenCalledWith('Toggled exclusion on 3 contig(s)');
    });

    it('should toggle exclusion for hovered contig when none selected (excluded)', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (contigExclusion.toggle as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 3 });

      toggleContigExclusion(ctx);

      expect(contigExclusion.toggle).toHaveBeenCalledWith(3);
      expect(ctx.showToast).toHaveBeenCalledWith('Contig excluded');
    });

    it('should toggle exclusion for hovered contig when none selected (included)', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (contigExclusion.toggle as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 3 });

      toggleContigExclusion(ctx);

      expect(contigExclusion.toggle).toHaveBeenCalledWith(3);
      expect(ctx.showToast).toHaveBeenCalledWith('Contig included');
    });

    it('should show toast when nothing is selected and nothing is hovered', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });

      toggleContigExclusion(ctx);

      expect(contigExclusion.toggle).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Hover or select contigs to exclude');
    });

    it('should always update sidebar and stats panel', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });

      toggleContigExclusion(ctx);

      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateStatsPanel).toHaveBeenCalled();
    });

    it('should prefer selection over hover', () => {
      (SelectionManager.getSelectedIndices as ReturnType<typeof vi.fn>).mockReturnValue([1]);
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 5 });

      toggleContigExclusion(ctx);

      // Should toggle index 1 (selected), not 5 (hovered)
      expect(contigExclusion.toggle).toHaveBeenCalledWith(1);
      expect(contigExclusion.toggle).not.toHaveBeenCalledWith(5);
    });
  });
});
