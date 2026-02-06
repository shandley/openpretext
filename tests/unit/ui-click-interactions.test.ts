import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
      selectedContigs: new Set(),
    })),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectSingle: vi.fn(),
    selectToggle: vi.fn(),
    selectRange: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedIndices: vi.fn(() => []),
  },
}));

import { setupClickInteractions, getContigNameAt } from '../../src/ui/ClickInteractions';
import { state } from '../../src/core/State';
import { SelectionManager } from '../../src/curation/SelectionManager';

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
    currentMode: 'navigate',
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
    dragReorder: {
      onMouseDown: vi.fn(),
      onMouseUp: vi.fn(),
      isActive: vi.fn(() => false),
    } as any,
    scaffoldManager: {
      paintContigs: vi.fn(),
      getActiveScaffoldId: vi.fn(() => null),
      getScaffold: vi.fn(() => null),
    } as any,
    waypointManager: {
      addWaypoint: vi.fn(() => ({ id: 1, mapX: 0.5, mapY: 0.5, label: 'WP1' })),
      removeWaypoint: vi.fn(),
      getAllWaypoints: vi.fn(() => []),
    } as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: create a mock canvas with captured event handlers
// ---------------------------------------------------------------------------

interface MockCanvas {
  handlers: Record<string, ((e: any) => void)[]>;
  addEventListener: ReturnType<typeof vi.fn>;
}

function createMockCanvas(): MockCanvas {
  const handlers: Record<string, ((e: any) => void)[]> = {};
  return {
    handlers,
    addEventListener: vi.fn((event: string, handler: any) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
  };
}

function fireMouseDown(canvas: MockCanvas, opts: {
  clientX?: number;
  clientY?: number;
} = {}) {
  const event = {
    clientX: opts.clientX ?? 100,
    clientY: opts.clientY ?? 100,
  };
  for (const handler of (canvas.handlers['mousedown'] ?? [])) {
    handler(event);
  }
  return event;
}

function fireMouseUp(canvas: MockCanvas, opts: {
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
} = {}) {
  const event = {
    clientX: opts.clientX ?? 100,
    clientY: opts.clientY ?? 100,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
  };
  for (const handler of (canvas.handlers['mouseup'] ?? [])) {
    handler(event);
  }
  return event;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClickInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // getContigNameAt
  // =========================================================================
  describe('getContigNameAt', () => {
    it('should return empty string when map is null', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
      });

      expect(getContigNameAt(0)).toBe('');
    });

    it('should return empty string when orderIndex is -1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [{ name: 'chr1' }] },
        contigOrder: [0],
      });

      expect(getContigNameAt(-1)).toBe('');
    });

    it('should return empty string when orderIndex is beyond contigOrder length', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [{ name: 'chr1' }] },
        contigOrder: [0],
      });

      expect(getContigNameAt(5)).toBe('');
    });

    it('should return the correct contig name for a valid order index', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            { name: 'chr1' },
            { name: 'chr2' },
            { name: 'chr3' },
          ],
        },
        contigOrder: [2, 0, 1],
      });

      // orderIndex 0 -> contigId 2 -> name 'chr3'
      expect(getContigNameAt(0)).toBe('chr3');
    });

    it('should return the correct contig name at a middle index', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            { name: 'alpha' },
            { name: 'beta' },
            { name: 'gamma' },
          ],
        },
        contigOrder: [1, 2, 0],
      });

      // orderIndex 1 -> contigId 2 -> name 'gamma'
      expect(getContigNameAt(1)).toBe('gamma');
    });

    it('should return empty string when contig entry has no name (undefined)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [{}],  // no name property
        },
        contigOrder: [0],
      });

      expect(getContigNameAt(0)).toBe('');
    });

    it('should return empty string when contigId references undefined contig', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [{ name: 'chr1' }],
        },
        contigOrder: [5], // index 5 does not exist in contigs
      });

      expect(getContigNameAt(0)).toBe('');
    });
  });

  // =========================================================================
  // setupClickInteractions
  // =========================================================================
  describe('setupClickInteractions', () => {
    it('should add mousedown and mouseup event listeners on canvas', () => {
      const ctx = createMockCtx();
      const canvas = createMockCanvas();

      setupClickInteractions(ctx, canvas as any);

      expect(canvas.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(canvas.addEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    // -----------------------------------------------------------------------
    // mousedown: drag reorder initiation
    // -----------------------------------------------------------------------
    describe('mousedown', () => {
      it('should initiate drag reorder in edit mode when hovering a contig', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 3 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 200, clientY: 150 });

        expect(ctx.dragReorder.onMouseDown).toHaveBeenCalledWith(200, 150, 3);
      });

      it('should NOT initiate drag reorder in edit mode when hoveredContigIndex is -1', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 200, clientY: 150 });

        expect(ctx.dragReorder.onMouseDown).not.toHaveBeenCalled();
      });

      it('should NOT initiate drag reorder in navigate mode', () => {
        const ctx = createMockCtx({ currentMode: 'navigate', hoveredContigIndex: 3 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 200, clientY: 150 });

        expect(ctx.dragReorder.onMouseDown).not.toHaveBeenCalled();
      });

      it('should NOT initiate drag reorder in scaffold mode', () => {
        const ctx = createMockCtx({ currentMode: 'scaffold', hoveredContigIndex: 3 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas);

        expect(ctx.dragReorder.onMouseDown).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // mouseup: drag end handling
    // -----------------------------------------------------------------------
    describe('mouseup - drag end', () => {
      it('should call dragReorder.onMouseUp and return early when drag is active', () => {
        const ctx = createMockCtx({
          currentMode: 'edit',
          hoveredContigIndex: 2,
          dragReorder: {
            onMouseDown: vi.fn(),
            onMouseUp: vi.fn(),
            isActive: vi.fn(() => true),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        // Setup state so edit mode click would normally fire
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 100, clientY: 100 });
        fireMouseUp(canvas, { clientX: 100, clientY: 100 });

        expect(ctx.dragReorder.onMouseUp).toHaveBeenCalled();
        // Should NOT have called selection because early return
        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // mouseup: click threshold (drag detection)
    // -----------------------------------------------------------------------
    describe('mouseup - drag threshold', () => {
      it('should ignore mouseup when mouse moved more than 5px in X', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 100, clientY: 100 });
        fireMouseUp(canvas, { clientX: 106, clientY: 100 });

        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
      });

      it('should ignore mouseup when mouse moved more than 5px in Y', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 100, clientY: 100 });
        fireMouseUp(canvas, { clientX: 100, clientY: 106 });

        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
      });

      it('should process click when mouse moved exactly 5px', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 100, clientY: 100 });
        fireMouseUp(canvas, { clientX: 105, clientY: 100 });

        expect(SelectionManager.selectSingle).toHaveBeenCalledWith(0);
      });
    });

    // -----------------------------------------------------------------------
    // Edit mode clicks
    // -----------------------------------------------------------------------
    describe('edit mode', () => {
      it('should call selectSingle on plain click', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 2 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
          contigOrder: [0, 1, 2],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(SelectionManager.selectSingle).toHaveBeenCalledWith(2);
      });

      it('should call selectRange on shift+click', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 4 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }] },
          contigOrder: [0, 1, 2, 3, 4],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(SelectionManager.selectRange).toHaveBeenCalledWith(4);
        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
        expect(SelectionManager.selectToggle).not.toHaveBeenCalled();
      });

      it('should call selectToggle on meta+click (Cmd)', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 1 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }] },
          contigOrder: [0, 1],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, metaKey: true });

        expect(SelectionManager.selectToggle).toHaveBeenCalledWith(1);
        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
        expect(SelectionManager.selectRange).not.toHaveBeenCalled();
      });

      it('should call selectToggle on ctrl+click', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 1 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }] },
          contigOrder: [0, 1],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, ctrlKey: true });

        expect(SelectionManager.selectToggle).toHaveBeenCalledWith(1);
      });

      it('should update sidebar contig list after selection', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      });

      it('should show toast with selected contig name', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'MyContig' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.showToast).toHaveBeenCalledWith('Selected: MyContig');
      });

      it('should NOT select when hoveredContigIndex is -1', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
        expect(SelectionManager.selectToggle).not.toHaveBeenCalled();
        expect(SelectionManager.selectRange).not.toHaveBeenCalled();
        expect(ctx.updateSidebarContigList).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Scaffold mode clicks
    // -----------------------------------------------------------------------
    describe('scaffold mode', () => {
      it('should paint contig to active scaffold on plain click', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 2,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 42),
            getScaffold: vi.fn(() => ({ name: 'Scaffold_1' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
          contigOrder: [0, 1, 2],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.scaffoldManager.paintContigs).toHaveBeenCalledWith([2], 42);
      });

      it('should show toast with painted contig and scaffold name', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 1),
            getScaffold: vi.fn(() => ({ name: 'MyScaffold' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.showToast).toHaveBeenCalledWith('Painted: chr1 → MyScaffold');
      });

      it('should show toast when no active scaffold and plain click', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => null),
            getScaffold: vi.fn(() => null),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.scaffoldManager.paintContigs).not.toHaveBeenCalled();
        expect(ctx.showToast).toHaveBeenCalledWith('No active scaffold. Press N to create one.');
      });

      it('should unpaint contig on shift+click', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 1,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 5),
            getScaffold: vi.fn(() => ({ name: 'Scaffold_1' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'a' }, { name: 'b' }] },
          contigOrder: [0, 1],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(ctx.scaffoldManager.paintContigs).toHaveBeenCalledWith([1], null);
      });

      it('should show unpainted toast on shift+click', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 5),
            getScaffold: vi.fn(() => ({ name: 'Scaffold_1' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(ctx.showToast).toHaveBeenCalledWith('Unpainted: chr1');
      });

      it('should update sidebar contig list and scaffold list after scaffold click', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => null),
            getScaffold: vi.fn(() => null),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.updateSidebarContigList).toHaveBeenCalled();
        expect(ctx.updateSidebarScaffoldList).toHaveBeenCalled();
      });

      it('should NOT enter scaffold mode logic when hoveredContigIndex is -1', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: -1,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 1),
            getScaffold: vi.fn(() => ({ name: 'S' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.scaffoldManager.paintContigs).not.toHaveBeenCalled();
        expect(ctx.scaffoldManager.getActiveScaffoldId).not.toHaveBeenCalled();
        expect(ctx.updateSidebarContigList).not.toHaveBeenCalled();
      });

      it('should handle scaffold with no name gracefully (null coalescence)', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 10),
            getScaffold: vi.fn(() => null),  // scaffold returns null
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        // sc?.name is undefined since sc is null, so ?? '' gives ''
        expect(ctx.showToast).toHaveBeenCalledWith('Painted: chr1 → ');
      });
    });

    // -----------------------------------------------------------------------
    // Waypoint mode clicks
    // -----------------------------------------------------------------------
    describe('waypoint mode', () => {
      it('should add waypoint on plain click within bounds', () => {
        const addedWaypoint = { id: 7, mapX: 0.5, mapY: 0.3, label: 'WP7' };
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: 0.3 },
          waypointManager: {
            addWaypoint: vi.fn(() => addedWaypoint),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(0.5, 0.3);
        expect(ctx.currentWaypointId).toBe(7);
        expect(ctx.showToast).toHaveBeenCalledWith('Placed: WP7');
      });

      it('should remove nearest waypoint on shift+click', () => {
        const waypoints = [
          { id: 1, mapX: 0.1, mapY: 0.1, label: 'WP1' },
          { id: 2, mapX: 0.5, mapY: 0.5, label: 'WP2' },
          { id: 3, mapX: 0.9, mapY: 0.9, label: 'WP3' },
        ];
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.48, y: 0.52 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => waypoints),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        // nearest to (0.48, 0.52) is WP2 at (0.5, 0.5)
        expect(ctx.waypointManager.removeWaypoint).toHaveBeenCalledWith(2);
        expect(ctx.showToast).toHaveBeenCalledWith('Removed waypoint: WP2');
      });

      it('should set currentWaypointId to null when removing the current waypoint', () => {
        const waypoints = [
          { id: 5, mapX: 0.5, mapY: 0.5, label: 'WP5' },
        ];
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: 0.5 },
          currentWaypointId: 5,
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => waypoints),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(ctx.currentWaypointId).toBeNull();
      });

      it('should NOT set currentWaypointId to null when removing a different waypoint', () => {
        const waypoints = [
          { id: 5, mapX: 0.5, mapY: 0.5, label: 'WP5' },
        ];
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: 0.5 },
          currentWaypointId: 99,  // different from 5
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => waypoints),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(ctx.currentWaypointId).toBe(99);
      });

      it('should do nothing on shift+click when there are no waypoints', () => {
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: 0.5 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        expect(ctx.waypointManager.removeWaypoint).not.toHaveBeenCalled();
        expect(ctx.showToast).not.toHaveBeenCalled();
      });

      it('should NOT add waypoint when mouse is outside map bounds (x < 0)', () => {
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: -0.1, y: 0.5 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).not.toHaveBeenCalled();
      });

      it('should NOT add waypoint when mouse is outside map bounds (x > 1)', () => {
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 1.1, y: 0.5 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).not.toHaveBeenCalled();
      });

      it('should NOT add waypoint when mouse is outside map bounds (y < 0)', () => {
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: -0.01 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).not.toHaveBeenCalled();
      });

      it('should NOT add waypoint when mouse is outside map bounds (y > 1)', () => {
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.5, y: 1.5 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).not.toHaveBeenCalled();
      });

      it('should allow waypoint at exact boundary (0,0)', () => {
        const addedWaypoint = { id: 1, mapX: 0, mapY: 0, label: 'WP_origin' };
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0, y: 0 },
          waypointManager: {
            addWaypoint: vi.fn(() => addedWaypoint),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(0, 0);
      });

      it('should allow waypoint at exact boundary (1,1)', () => {
        const addedWaypoint = { id: 2, mapX: 1, mapY: 1, label: 'WP_corner' };
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 1, y: 1 },
          waypointManager: {
            addWaypoint: vi.fn(() => addedWaypoint),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(1, 1);
      });

      it('should remove nearest waypoint correctly among multiple', () => {
        const waypoints = [
          { id: 1, mapX: 0.0, mapY: 0.0, label: 'WP1' },
          { id: 2, mapX: 0.3, mapY: 0.3, label: 'WP2' },
          { id: 3, mapX: 0.7, mapY: 0.7, label: 'WP3' },
        ];
        const ctx = createMockCtx({
          currentMode: 'waypoint',
          mouseMapPos: { x: 0.28, y: 0.32 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => waypoints),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50, shiftKey: true });

        // WP2 at (0.3, 0.3) is nearest to (0.28, 0.32)
        expect(ctx.waypointManager.removeWaypoint).toHaveBeenCalledWith(2);
        expect(ctx.showToast).toHaveBeenCalledWith('Removed waypoint: WP2');
      });
    });

    // -----------------------------------------------------------------------
    // Navigate mode (no special click behavior)
    // -----------------------------------------------------------------------
    describe('navigate mode', () => {
      it('should NOT trigger edit selection logic in navigate mode', () => {
        const ctx = createMockCtx({ currentMode: 'navigate', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
        expect(ctx.updateSidebarContigList).not.toHaveBeenCalled();
      });

      it('should NOT trigger scaffold logic in navigate mode', () => {
        const ctx = createMockCtx({
          currentMode: 'navigate',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 1),
            getScaffold: vi.fn(() => ({ name: 'S' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.scaffoldManager.paintContigs).not.toHaveBeenCalled();
      });

      it('should NOT trigger waypoint logic in navigate mode', () => {
        const ctx = createMockCtx({
          currentMode: 'navigate',
          mouseMapPos: { x: 0.5, y: 0.5 },
          waypointManager: {
            addWaypoint: vi.fn(),
            removeWaypoint: vi.fn(),
            getAllWaypoints: vi.fn(() => []),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(ctx.waypointManager.addWaypoint).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Multiple modes in a single click (edit + scaffold boundary)
    // -----------------------------------------------------------------------
    describe('mode isolation', () => {
      it('should not trigger scaffold logic when in edit mode', () => {
        const ctx = createMockCtx({
          currentMode: 'edit',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => 1),
            getScaffold: vi.fn(() => ({ name: 'S' })),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        // Edit mode logic should fire
        expect(SelectionManager.selectSingle).toHaveBeenCalledWith(0);
        // Scaffold mode logic should NOT fire
        expect(ctx.scaffoldManager.paintContigs).not.toHaveBeenCalled();
      });

      it('should not trigger edit logic when in scaffold mode', () => {
        const ctx = createMockCtx({
          currentMode: 'scaffold',
          hoveredContigIndex: 0,
          scaffoldManager: {
            paintContigs: vi.fn(),
            getActiveScaffoldId: vi.fn(() => null),
            getScaffold: vi.fn(() => null),
          } as any,
        });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        // Edit mode logic should NOT fire
        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Multiple clicks (statefulness of mouseDownPos)
    // -----------------------------------------------------------------------
    describe('multiple clicks', () => {
      it('should handle multiple sequential clicks correctly', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        // First click
        fireMouseDown(canvas, { clientX: 50, clientY: 50 });
        fireMouseUp(canvas, { clientX: 50, clientY: 50 });

        expect(SelectionManager.selectSingle).toHaveBeenCalledTimes(1);

        // Second click at a different position
        fireMouseDown(canvas, { clientX: 200, clientY: 200 });
        fireMouseUp(canvas, { clientX: 200, clientY: 200 });

        expect(SelectionManager.selectSingle).toHaveBeenCalledTimes(2);
      });

      it('should use latest mousedown position for drag threshold', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
        const canvas = createMockCanvas();
        setupClickInteractions(ctx, canvas as any);

        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'chr1' }] },
          contigOrder: [0],
        });

        // mousedown at 100,100
        fireMouseDown(canvas, { clientX: 100, clientY: 100 });
        // mouseup at 200,200 (>5px away) - should be treated as drag, not click
        fireMouseUp(canvas, { clientX: 200, clientY: 200 });

        expect(SelectionManager.selectSingle).not.toHaveBeenCalled();

        // Now new mousedown at 200,200 and mouseup nearby
        fireMouseDown(canvas, { clientX: 200, clientY: 200 });
        fireMouseUp(canvas, { clientX: 202, clientY: 201 });

        expect(SelectionManager.selectSingle).toHaveBeenCalledTimes(1);
      });
    });
  });
});
