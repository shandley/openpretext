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

vi.mock('../../src/ui/Tooltip', () => ({
  updateTooltip: vi.fn(),
  hideTooltip: vi.fn(),
}));

import {
  setupMouseTracking,
  updateCursor,
  setupDragReorder,
} from '../../src/ui/MouseTracking';

import { state } from '../../src/core/State';
import { updateTooltip, hideTooltip } from '../../src/ui/Tooltip';

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
    comparisonInvertedSnapshot: null,
    comparisonVisible: false,
    renderer: {
      canvasToMap: vi.fn(() => ({ x: 0.5, y: 0.5 })),
    } as any,
    labelRenderer: {} as any,
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {
      getState: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    } as any,
    dragReorder: {
      setup: vi.fn(),
      onMouseMove: vi.fn(() => false),
      onMouseDown: vi.fn(() => false),
      onMouseUp: vi.fn(() => false),
    } as any,
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: create a mock canvas element
// ---------------------------------------------------------------------------

function createMockCanvas() {
  const listeners: Record<string, Function[]> = {};
  return {
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    style: { cursor: '' },
    __listeners: listeners,
    __fire(event: string, payload: any) {
      if (listeners[event]) {
        for (const handler of listeners[event]) {
          handler(payload);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MouseTracking', () => {
  let mockStatusPositionEl: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStatusPositionEl = { textContent: '' };

    // Mock document.getElementById for status-position
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'status-position') return mockStatusPositionEl;
        return null;
      }),
    } as any;
  });

  afterEach(() => {
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // setupMouseTracking
  // -------------------------------------------------------------------------
  describe('setupMouseTracking', () => {
    it('should add mousemove and mouseleave event listeners on canvas', () => {
      const ctx = createMockCtx();
      const canvas = createMockCanvas();

      setupMouseTracking(ctx, canvas as any);

      expect(canvas.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(canvas.addEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    });

    // -----------------------------------------------------------------------
    // mousemove handler
    // -----------------------------------------------------------------------
    describe('mousemove handler', () => {
      it('should compute mouseMapPos from renderer.canvasToMap', () => {
        const ctx = createMockCtx();
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.3, y: 0.7 });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.camera.getState).toHaveBeenCalled();
        expect(ctx.renderer.canvasToMap).toHaveBeenCalledWith(100, 200, { x: 0, y: 0, zoom: 1 });
        expect(ctx.mouseMapPos).toEqual({ x: 0.3, y: 0.7 });
      });

      it('should short-circuit when dragReorder.onMouseMove returns true in edit mode', () => {
        const ctx = createMockCtx({ currentMode: 'edit' });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.5, y: 0.5 });
        (ctx.dragReorder.onMouseMove as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        // Should not update hoveredContigIndex or call updateTooltip
        expect(updateTooltip).not.toHaveBeenCalled();
      });

      it('should not call dragReorder.onMouseMove when not in edit mode', () => {
        const ctx = createMockCtx({ currentMode: 'navigate' });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.5, y: 0.5 });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.dragReorder.onMouseMove).not.toHaveBeenCalled();
      });

      it('should set hoveredContigIndex based on mouse position within contig boundaries', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.25, 0.5, 0.75, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.3, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'c1' }, { name: 'c2' }, { name: 'c3' }, { name: 'c4' }] },
          contigOrder: [0, 1, 2, 3],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        // x=0.3 is in [0.25, 0.5), so index = 1
        expect(ctx.hoveredContigIndex).toBe(1);
      });

      it('should set hoveredContigIndex to first contig when x is in first boundary range', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.1, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'c1' }, { name: 'c2' }] },
          contigOrder: [0, 1],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        // x=0.1 is in [0, 0.5), so index = 0
        expect(ctx.hoveredContigIndex).toBe(0);
      });

      it('should set hoveredContigIndex to -1 when mouse is outside [0, 1] range', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: -0.1, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'c1' }, { name: 'c2' }] },
          contigOrder: [0, 1],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.hoveredContigIndex).toBe(-1);
      });

      it('should set hoveredContigIndex to -1 when x > 1', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 1.5, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: [{ name: 'c1' }, { name: 'c2' }] },
          contigOrder: [0, 1],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.hoveredContigIndex).toBe(-1);
      });

      it('should set hoveredContigIndex to -1 when no map is loaded', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.3, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: null,
          contigOrder: [],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.hoveredContigIndex).toBe(-1);
      });

      it('should display contig name in status-position when hovering a contig', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.2, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: { 0: { name: 'chr1' }, 1: { name: 'chr2' } } },
          contigOrder: [0, 1],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(mockStatusPositionEl.textContent).toBe('chr1');
      });

      it('should display dash when hovering but contig is not found', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.2, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: {} },
          contigOrder: [99, 100],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        // hoveredContigIndex=0, contigOrder[0]=99, but contigs[99] is undefined
        expect(mockStatusPositionEl.textContent).toBe('\u2014');
      });

      it('should display dash in status-position when no contig is hovered', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: -1, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
          map: { contigs: { 0: { name: 'chr1' } } },
          contigOrder: [0],
        });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(mockStatusPositionEl.textContent).toBe('\u2014');
      });

      it('should call updateCursor with ctx and canvas', () => {
        const ctx = createMockCtx();
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.5, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null, contigOrder: [] });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        // updateCursor sets canvas.style.cursor based on mode
        // In navigate mode (default), should be 'grab'
        expect(canvas.style.cursor).toBe('grab');
      });

      it('should call updateTooltip with ctx and clientX, clientY', () => {
        const ctx = createMockCtx();
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.5, y: 0.5 });
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null, contigOrder: [] });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(updateTooltip).toHaveBeenCalledWith(ctx, 150, 250);
      });

      it('should pass correct dragReorder arguments in edit mode', () => {
        const ctx = createMockCtx({
          currentMode: 'edit',
          contigBoundaries: [0.5, 1.0],
        });
        (ctx.renderer.canvasToMap as ReturnType<typeof vi.fn>).mockReturnValue({ x: 0.3, y: 0.5 });
        (ctx.dragReorder.onMouseMove as ReturnType<typeof vi.fn>).mockReturnValue(false);
        (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null, contigOrder: [] });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mousemove', { offsetX: 100, offsetY: 200, clientX: 150, clientY: 250 });

        expect(ctx.dragReorder.onMouseMove).toHaveBeenCalledWith(150, 250, 0.3, [0.5, 1.0]);
      });
    });

    // -----------------------------------------------------------------------
    // mouseleave handler
    // -----------------------------------------------------------------------
    describe('mouseleave handler', () => {
      it('should reset hoveredContigIndex to -1', () => {
        const ctx = createMockCtx({ hoveredContigIndex: 5 });
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mouseleave', {});

        expect(ctx.hoveredContigIndex).toBe(-1);
      });

      it('should set status-position text to dash', () => {
        const ctx = createMockCtx();
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mouseleave', {});

        expect(mockStatusPositionEl.textContent).toBe('\u2014');
      });

      it('should call hideTooltip', () => {
        const ctx = createMockCtx();
        const canvas = createMockCanvas();

        setupMouseTracking(ctx, canvas as any);
        canvas.__fire('mouseleave', {});

        expect(hideTooltip).toHaveBeenCalled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // updateCursor
  // -------------------------------------------------------------------------
  describe('updateCursor', () => {
    it('should set cursor to "grab" in navigate mode', () => {
      const ctx = createMockCtx({ currentMode: 'navigate' });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('grab');
    });

    it('should set cursor to "pointer" in edit mode when hovering a contig', () => {
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 3 });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('pointer');
    });

    it('should set cursor to "crosshair" in edit mode when not hovering a contig', () => {
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('crosshair');
    });

    it('should set cursor to "cell" in scaffold mode', () => {
      const ctx = createMockCtx({ currentMode: 'scaffold' });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('cell');
    });

    it('should set cursor to "crosshair" in waypoint mode', () => {
      const ctx = createMockCtx({ currentMode: 'waypoint' });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('crosshair');
    });

    it('should set cursor to "default" for unknown mode', () => {
      const ctx = createMockCtx({ currentMode: 'select_sort' as any });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('default');
    });

    it('should set cursor to "pointer" in edit mode when hoveredContigIndex is 0', () => {
      const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 0 });
      const canvas = createMockCanvas();

      updateCursor(ctx, canvas as any);

      expect(canvas.style.cursor).toBe('pointer');
    });
  });

  // -------------------------------------------------------------------------
  // setupDragReorder
  // -------------------------------------------------------------------------
  describe('setupDragReorder', () => {
    it('should call dragReorder.setup with expected callback keys', () => {
      const ctx = createMockCtx();
      const canvas = createMockCanvas();

      setupDragReorder(ctx, canvas as any);

      expect(ctx.dragReorder.setup).toHaveBeenCalledWith({
        getContigAtPosition: expect.any(Function),
        onDragUpdate: expect.any(Function),
        onDragEnd: expect.any(Function),
      });
    });

    // -----------------------------------------------------------------------
    // getContigAtPosition callback
    // -----------------------------------------------------------------------
    describe('getContigAtPosition callback', () => {
      it('should return correct contig index for a given map position', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.25, 0.5, 0.75, 1.0],
        });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const getContigAtPosition = setupCall.getContigAtPosition;

        expect(getContigAtPosition(0.1)).toBe(0);
        expect(getContigAtPosition(0.3)).toBe(1);
        expect(getContigAtPosition(0.6)).toBe(2);
        expect(getContigAtPosition(0.9)).toBe(3);
      });

      it('should return -1 when position is beyond all boundaries', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const getContigAtPosition = setupCall.getContigAtPosition;

        // 1.5 is >= 1.0, so no boundary range matches
        expect(getContigAtPosition(1.5)).toBe(-1);
      });

      it('should return 0 for position at the start of first contig', () => {
        const ctx = createMockCtx({
          contigBoundaries: [0.5, 1.0],
        });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const getContigAtPosition = setupCall.getContigAtPosition;

        expect(getContigAtPosition(0)).toBe(0);
      });

      it('should return -1 when contigBoundaries is empty', () => {
        const ctx = createMockCtx({
          contigBoundaries: [],
        });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const getContigAtPosition = setupCall.getContigAtPosition;

        expect(getContigAtPosition(0.5)).toBe(-1);
      });
    });

    // -----------------------------------------------------------------------
    // onDragUpdate callback
    // -----------------------------------------------------------------------
    describe('onDragUpdate callback', () => {
      it('should set cursor to "grabbing" on drag update', () => {
        const ctx = createMockCtx();
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragUpdate = setupCall.onDragUpdate;

        onDragUpdate();

        expect(canvas.style.cursor).toBe('grabbing');
      });
    });

    // -----------------------------------------------------------------------
    // onDragEnd callback
    // -----------------------------------------------------------------------
    describe('onDragEnd callback', () => {
      it('should restore cursor via updateCursor when drag ends', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: 2 });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragEnd = setupCall.onDragEnd;

        // Set cursor to grabbing first to prove it changes
        canvas.style.cursor = 'grabbing';
        onDragEnd(false);

        // In edit mode with hovered contig, cursor should become pointer
        expect(canvas.style.cursor).toBe('pointer');
      });

      it('should call refreshAfterCuration and showToast when moved is true', () => {
        const ctx = createMockCtx({ currentMode: 'edit' });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragEnd = setupCall.onDragEnd;

        onDragEnd(true);

        expect(ctx.refreshAfterCuration).toHaveBeenCalled();
        expect(ctx.showToast).toHaveBeenCalledWith('Contig moved');
      });

      it('should NOT call refreshAfterCuration or showToast when moved is false', () => {
        const ctx = createMockCtx({ currentMode: 'edit' });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragEnd = setupCall.onDragEnd;

        onDragEnd(false);

        expect(ctx.refreshAfterCuration).not.toHaveBeenCalled();
        expect(ctx.showToast).not.toHaveBeenCalled();
      });

      it('should set cursor to crosshair in edit mode with no hovered contig after drag ends', () => {
        const ctx = createMockCtx({ currentMode: 'edit', hoveredContigIndex: -1 });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragEnd = setupCall.onDragEnd;

        onDragEnd(false);

        expect(canvas.style.cursor).toBe('crosshair');
      });

      it('should set cursor to grab in navigate mode after drag ends', () => {
        const ctx = createMockCtx({ currentMode: 'navigate' });
        const canvas = createMockCanvas();

        setupDragReorder(ctx, canvas as any);

        const setupCall = (ctx.dragReorder.setup as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const onDragEnd = setupCall.onDragEnd;

        onDragEnd(false);

        expect(canvas.style.cursor).toBe('grab');
      });
    });
  });
});
