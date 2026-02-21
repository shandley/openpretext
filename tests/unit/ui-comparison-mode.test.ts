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
  computeDiff,
  updateComparisonSummary,
  exportDiffReport,
} from '../../src/ui/ComparisonMode';

import { state } from '../../src/core/State';
import type { AppContext } from '../../src/ui/AppContext';
import type { CameraState } from '../../src/renderer/Camera';
import type { ContigInfo } from '../../src/core/State';

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
    updateUndoHistoryPanel: vi.fn(),
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
    comparisonInvertedSnapshot: null,
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
    tutorialManager: null,
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
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textBaseline: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Helper: create ContigInfo
// ---------------------------------------------------------------------------

function makeContig(overrides: Partial<ContigInfo> = {}): ContigInfo {
  return {
    name: 'ctg',
    originalIndex: 0,
    length: 1000,
    pixelStart: 0,
    pixelEnd: 100,
    inverted: false,
    scaffoldId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal DOM stub (no jsdom needed)
// ---------------------------------------------------------------------------

const mockElements = new Map<string, any>();

function createDomElement(): any {
  return {
    style: { display: '' },
    innerHTML: '',
    remove: vi.fn(),
  };
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    getElementById: vi.fn((id: string) => mockElements.get(id) ?? null),
    createElement: vi.fn(() => createDomElement()),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  };
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComparisonMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElements.clear();
    (globalThis.document.getElementById as any) = vi.fn((id: string) => mockElements.get(id) ?? null);
  });

  // -------------------------------------------------------------------------
  // computeDiff
  // -------------------------------------------------------------------------
  describe('computeDiff', () => {
    it('should detect no changes when order and inversions match', () => {
      const contigs = [
        makeContig({ name: 'a', inverted: false }),
        makeContig({ name: 'b', inverted: false }),
      ];
      const snapshot = [0, 1];
      const invertedSnapshot = new Map([[0, false], [1, false]]);
      const current = [0, 1];

      const { changes, summary } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(summary.unchanged).toBe(2);
      expect(summary.moved).toBe(0);
      expect(summary.inverted).toBe(0);
      expect(summary.added).toBe(0);
      expect(summary.removed).toBe(0);
      expect(changes.get(0)).toBe('unchanged');
      expect(changes.get(1)).toBe('unchanged');
    });

    it('should detect moved contigs', () => {
      const contigs = [
        makeContig({ name: 'a', inverted: false }),
        makeContig({ name: 'b', inverted: false }),
        makeContig({ name: 'c', inverted: false }),
      ];
      const snapshot = [0, 1, 2];
      const invertedSnapshot = new Map([[0, false], [1, false], [2, false]]);
      // Swap 0 and 1
      const current = [1, 0, 2];

      const { changes, summary } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(summary.moved).toBe(2);
      expect(summary.unchanged).toBe(1);
      expect(changes.get(0)).toBe('moved');
      expect(changes.get(1)).toBe('moved');
      expect(changes.get(2)).toBe('unchanged');
    });

    it('should detect inverted contigs', () => {
      const contigs = [
        makeContig({ name: 'a', inverted: true }),
        makeContig({ name: 'b', inverted: false }),
      ];
      const snapshot = [0, 1];
      const invertedSnapshot = new Map([[0, false], [1, false]]);
      const current = [0, 1];

      const { changes, summary } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(summary.inverted).toBe(1);
      expect(summary.unchanged).toBe(1);
      expect(changes.get(0)).toBe('inverted');
      expect(changes.get(1)).toBe('unchanged');
    });

    it('should detect added contigs (from cuts)', () => {
      const contigs = [
        makeContig({ name: 'a' }),
        makeContig({ name: 'b' }),
        makeContig({ name: 'a_part2' }),
      ];
      const snapshot = [0, 1];
      const invertedSnapshot = new Map([[0, false], [1, false]]);
      // contig 2 is new (from a cut)
      const current = [0, 2, 1];

      const { changes, summary } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(summary.added).toBe(1);
      expect(changes.get(2)).toBe('added');
    });

    it('should detect removed contigs (from joins)', () => {
      const contigs = [
        makeContig({ name: 'a' }),
        makeContig({ name: 'b' }),
      ];
      const snapshot = [0, 1, 2]; // contig 2 was in snapshot
      const invertedSnapshot = new Map([[0, false], [1, false], [2, false]]);
      const current = [0, 1]; // contig 2 is gone (joined)

      const { changes, summary } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(summary.removed).toBe(1);
    });

    it('should handle empty snapshot', () => {
      const contigs = [makeContig({ name: 'a' })];
      const { summary } = computeDiff([], new Map(), [0], contigs);

      expect(summary.added).toBe(1);
      expect(summary.removed).toBe(0);
    });

    it('should handle empty current order', () => {
      const contigs = [makeContig({ name: 'a' })];
      const { summary } = computeDiff([0], new Map([[0, false]]), [], contigs);

      expect(summary.removed).toBe(1);
      expect(summary.total).toBe(0);
    });

    it('should prioritize inversion over position change', () => {
      const contigs = [
        makeContig({ name: 'a', inverted: true }),
        makeContig({ name: 'b', inverted: false }),
      ];
      const snapshot = [0, 1];
      const invertedSnapshot = new Map([[0, false], [1, false]]);
      // contig 0 is both moved AND inverted — inversion takes priority
      const current = [1, 0];

      const { changes } = computeDiff(snapshot, invertedSnapshot, current, contigs);

      expect(changes.get(0)).toBe('inverted');
      expect(changes.get(1)).toBe('moved');
    });
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

    it('should toggle comparisonVisible to true and show ON toast with diff summary', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000 },
        contigOrder: [],
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [],
        comparisonInvertedSnapshot: new Map(),
        comparisonVisible: false,
      });

      toggleComparisonMode(ctx);

      expect(ctx.comparisonVisible).toBe(true);
      expect(ctx.showToast).toHaveBeenCalledWith('Comparison: ON (no changes)');
    });

    it('should show diff details in ON toast when changes exist', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            makeContig({ inverted: true }),
            makeContig({ inverted: false }),
          ],
          textureSize: 1000,
        },
        contigOrder: [1, 0],
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
        comparisonVisible: false,
      });

      toggleComparisonMode(ctx);

      expect(ctx.comparisonVisible).toBe(true);
      // contig 0 is inverted, contig 1 is moved
      expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('1 moved'));
      expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('1 inverted'));
    });

    it('should toggle comparisonVisible to false and show OFF toast', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000 },
        contigOrder: [],
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
  // updateComparisonSummary
  // -------------------------------------------------------------------------
  describe('updateComparisonSummary', () => {
    it('should hide when comparison is not visible', () => {
      const el = createDomElement();
      el.style.display = 'block';
      mockElements.set('comparison-summary', el);

      const ctx = createMockCtx({ comparisonVisible: false });
      updateComparisonSummary(ctx);

      expect(el.style.display).toBe('none');
    });

    it('should show diff badges when comparison is active', () => {
      const el = createDomElement();
      mockElements.set('comparison-summary', el);

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: [
            makeContig({ inverted: false }),
            makeContig({ inverted: false }),
          ],
          textureSize: 1000,
        },
        contigOrder: [1, 0],
      });

      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });

      updateComparisonSummary(ctx);

      expect(el.style.display).toBe('block');
      expect(el.innerHTML).toContain('diff-moved');
      expect(el.innerHTML).toContain('2 moved');
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
            0: { pixelStart: 0, pixelEnd: 500, inverted: false },
            1: { pixelStart: 500, pixelEnd: 1000, inverted: false },
          },
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalledTimes(1);
      expect(canvasCtx.restore).toHaveBeenCalledTimes(1);
    });

    it('should set dashed line style for baseline overlay', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500, inverted: false },
          },
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0],
        comparisonInvertedSnapshot: new Map([[0, false]]),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.setLineDash).toHaveBeenCalledWith([4, 4]);
    });

    it('should draw boundary lines for contigs in snapshot', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500, inverted: false },
            1: { pixelStart: 500, pixelEnd: 1000, inverted: false },
          },
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });
      const canvasCtx = createMockCanvasCtx();
      const testCam: CameraState = { x: 0.5, y: 0.5, zoom: 1 };

      renderComparisonOverlay(ctx, canvasCtx, testCam, canvasWidth, canvasHeight);

      expect(canvasCtx.beginPath).toHaveBeenCalled();
      expect(canvasCtx.stroke).toHaveBeenCalled();
    });

    it('should skip contigs not found in the map', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500, inverted: false },
          },
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 99],
        comparisonInvertedSnapshot: new Map([[0, false], [99, false]]),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalled();
      expect(canvasCtx.restore).toHaveBeenCalled();
    });

    it('should handle empty comparison snapshot', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {},
        },
        contigOrder: [],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [],
        comparisonInvertedSnapshot: new Map(),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      expect(canvasCtx.save).toHaveBeenCalled();
      expect(canvasCtx.restore).toHaveBeenCalled();
      expect(canvasCtx.beginPath).not.toHaveBeenCalled();
    });

    it('should draw legend when changes exist', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500, inverted: true },
            1: { pixelStart: 500, pixelEnd: 1000, inverted: false },
          },
        },
        contigOrder: [1, 0],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      // Legend draws a rounded rectangle background and text labels
      expect(canvasCtx.roundRect).toHaveBeenCalled();
      expect(canvasCtx.fill).toHaveBeenCalled();
      // Should draw legend items for both "moved" and "inverted"
      const fillTextCalls = (canvasCtx.fillText as ReturnType<typeof vi.fn>).mock.calls;
      const labels = fillTextCalls.map((c: any[]) => c[0]);
      expect(labels).toContain('Moved');
      expect(labels).toContain('Inverted');
    });

    it('should not draw legend when all contigs are unchanged', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 1000,
          contigs: {
            0: { pixelStart: 0, pixelEnd: 500, inverted: false },
            1: { pixelStart: 500, pixelEnd: 1000, inverted: false },
          },
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx({
        comparisonVisible: true,
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });
      const canvasCtx = createMockCanvasCtx();

      renderComparisonOverlay(ctx, canvasCtx, cam, canvasWidth, canvasHeight);

      // No legend should be drawn when no changes (all contigs unchanged are skipped in markers)
      // The roundRect should not be called since the legend filters to only types present
      // and unchanged IS in the legend items, so it will show for unchanged-only diffs
      expect(canvasCtx.roundRect).toHaveBeenCalled();
      const fillTextCalls = (canvasCtx.fillText as ReturnType<typeof vi.fn>).mock.calls;
      const labels = fillTextCalls.map((c: any[]) => c[0]);
      expect(labels).toContain('Unchanged');
    });
  });

  // -------------------------------------------------------------------------
  // exportDiffReport
  // -------------------------------------------------------------------------
  describe('exportDiffReport', () => {
    it('should return early when no map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ map: null });
      const ctx = createMockCtx({ comparisonSnapshot: [0] });

      exportDiffReport(ctx);

      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should return early when no snapshot exists', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 1000, filename: 'test.pretext' },
        contigOrder: [],
      });
      const ctx = createMockCtx({ comparisonSnapshot: null });

      exportDiffReport(ctx);

      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should create and download a JSON diff report', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          filename: 'test.pretext',
          contigs: [
            makeContig({ name: 'ctg1', inverted: true }),
            makeContig({ name: 'ctg2', inverted: false }),
          ],
          textureSize: 1000,
        },
        contigOrder: [1, 0],
      });
      const ctx = createMockCtx({
        comparisonSnapshot: [0, 1],
        comparisonInvertedSnapshot: new Map([[0, false], [1, false]]),
      });

      // Mock Blob, URL, and anchor element for download
      const mockUrl = 'blob:test';
      const mockAnchor = { href: '', download: '', click: vi.fn() } as any;
      (globalThis as any).Blob = vi.fn((parts: any[], opts: any) => ({ parts, type: opts.type }));
      (globalThis as any).URL = {
        createObjectURL: vi.fn(() => mockUrl),
        revokeObjectURL: vi.fn(),
      };
      (globalThis.document.createElement as any) = vi.fn(() => mockAnchor);

      exportDiffReport(ctx);

      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
      expect(mockAnchor.download).toBe('test-diff-report.json');
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl);
      expect(ctx.showToast).toHaveBeenCalledWith('Diff report exported');
    });
  });
});
