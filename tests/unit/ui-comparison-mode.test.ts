import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
    })),
  },
}));

import {
  toggleComparisonMode,
  renderComparisonOverlay,
} from '../../src/ui/ComparisonMode';

import { state } from '../../src/core/State';
import type { AppContext } from '../../src/ui/AppContext';
import type { CameraState } from '../../src/renderer/Camera';

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
    setMode: vi.fn(),
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
// Helper: create a mock CanvasRenderingContext2D
// ---------------------------------------------------------------------------

function createMockCanvasCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComparisonMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // toggleComparisonMode
  // -------------------------------------------------------------------------
  describe('toggleComparisonMode', () => {
    it('should show toast when no map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
      });
      const ctx = createMockCtx();

      toggleComparisonMode(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No data loaded');
      expect(ctx.comparisonVisible).toBe(false);
    });

    it('should show toast when no comparison snapshot is available', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000 },
      });
      const ctx = createMockCtx({ comparisonSnapshot: null });

      toggleComparisonMode(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No comparison snapshot available');
      expect(ctx.comparisonVisible).toBe(false);
    });

    it('should toggle comparisonVisible to true and show ON toast', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000 },
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [0, 1, 2],
        comparisonVisible: false,
      });

      toggleComparisonMode(ctx);

      expect(ctx.comparisonVisible).toBe(true);
      expect(ctx.showToast).toHaveBeenCalledWith('Comparison: ON');
    });

    it('should toggle comparisonVisible to false and show OFF toast', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000 },
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [0, 1, 2],
        comparisonVisible: true,
      });

      toggleComparisonMode(ctx);

      expect(ctx.comparisonVisible).toBe(false);
      expect(ctx.showToast).toHaveBeenCalledWith('Comparison: OFF');
    });

    it('should not toggle if map is missing even if snapshot exists', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [0, 1],
        comparisonVisible: false,
      });

      toggleComparisonMode(ctx);

      expect(ctx.comparisonVisible).toBe(false);
      expect(ctx.showToast).toHaveBeenCalledWith('No data loaded');
    });
  });

  // -------------------------------------------------------------------------
  // renderComparisonOverlay
  // -------------------------------------------------------------------------
  describe('renderComparisonOverlay', () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const canvasWidth = 800;
    const canvasHeight = 600;

    it('should return early when comparisonVisible is false', () => {
      const ctx = createMockCtx({ comparisonVisible: false, comparisonSnapshot: [0] });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).not.toHaveBeenCalled();
    });

    it('should return early when comparisonSnapshot is null', () => {
      const ctx = createMockCtx({ comparisonVisible: true, comparisonSnapshot: null });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).not.toHaveBeenCalled();
    });

    it('should return early when map is not loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null });
      const ctx = createMockCtx({ comparisonVisible: true, comparisonSnapshot: [0] });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).not.toHaveBeenCalled();
    });

    it('should call save and restore when rendering', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500 },
            1: { pixelStart: 500, pixelEnd: 1000 },
          },
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalledTimes(1);
      expect(canvasCtx.restore).toHaveBeenCalledTimes(1);
    });

    it('should set dashed line style for overlay', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500 },
          },
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0],
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.setLineDash).toHaveBeenCalledWith([4, 4]);
      expect(canvasCtx.strokeStyle).toBe('rgba(52, 152, 219, 0.5)');
      expect(canvasCtx.lineWidth).toBe(1);
    });

    it('should draw boundary lines for contigs in snapshot', () => {
      // Two contigs, each 500px. totalPixels = 1000
      // After first contig: boundary at 500/1000 = 0.5
      // After second contig: boundary at 1000/1000 = 1.0
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500 },
            1: { pixelStart: 500, pixelEnd: 1000 },
          },
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
      });
      const canvasCtx = createMockCanvasCtx();

      // cam at center, zoom=1: screenX = (boundary - 0) * 1 * 800 + 400
      // boundary=0.5: screenX = 0.5 * 800 + 400 = 800 (at edge, not > 0 && < 800? 800 < 800 is false, so no vertical line)
      // boundary=1.0: screenX = 1.0 * 800 + 400 = 1200 (outside)
      // Let's use cam that makes boundaries visible
      const testCam: CameraState = { x: 0.5, y: 0.5, zoom: 1 };

      renderComparisonOverlay(ctx, canvasCtx, testCam, canvasWidth, canvasHeight);

      // boundary=0.5: screenX = (0.5 - 0.5) * 1 * 800 + 400 = 400 (visible)
      // boundary=1.0: screenX = (1.0 - 0.5) * 1 * 800 + 400 = 800 (not < 800, so not drawn vertically)
      // boundary=0.5: screenY = (0.5 - 0.5) * 1 * 600 + 300 = 300 (visible)
      // boundary=1.0: screenY = (1.0 - 0.5) * 1 * 600 + 300 = 600 (not < 600, so not drawn horizontally)
      expect(canvasCtx.beginPath).toHaveBeenCalled();
      expect(canvasCtx.stroke).toHaveBeenCalled();
    });

    it('should skip contigs not found in the map', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500 },
            // contigId 99 does not exist
          },
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 99],
      });
      const canvasCtx = createMockCanvasCtx();

      // Should not throw
      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalled();
      expect(canvasCtx.restore).toHaveBeenCalled();
    });

    it('should not draw lines for boundaries outside the canvas viewport', () => {
      // Single contig spanning the entire map: boundary at 1.0
      // With cam at origin, zoom=1: screenX = (1.0 - 0) * 1 * 800 + 400 = 1200 (outside)
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 1000 },
          },
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0],
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      // beginPath should not be called since the boundary is off-screen
      expect(canvasCtx.beginPath).not.toHaveBeenCalled();
    });

    it('should handle empty comparison snapshot', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {},
        },
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [],
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalled();
      expect(canvasCtx.restore).toHaveBeenCalled();
      // No boundaries drawn
      expect(canvasCtx.beginPath).not.toHaveBeenCalled();
    });
  });
});
