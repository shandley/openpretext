import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/EventBus', () => ({
  events: {
    on: vi.fn(),
  },
}));

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
      undoStack: [],
    })),
    update: vi.fn(),
    select: vi.fn(() => () => {}),
    updateContig: vi.fn(),
    updateContigs: vi.fn(),
    appendContigs: vi.fn(),
  },
  selectContigOrder: (s: any) => s.contigOrder,
  selectGamma: (s: any) => s.gamma,
  selectShowGrid: (s: any) => s.showGrid,
  selectMode: (s: any) => s.mode,
  selectSelectedContigs: (s: any) => s.selectedContigs,
}));

vi.mock('../../src/curation/ContigExclusion', () => ({
  contigExclusion: {
    clearAll: vi.fn(),
  },
}));

vi.mock('../../src/core/DerivedState', async () => {
  const stateModule = await vi.importMock<typeof import('../../src/core/State')>('../../src/core/State');
  return {
    getContigBoundaries: vi.fn(() => {
      const s = stateModule.state.get();
      if (!s.map) return [];
      const totalPixels = s.map.textureSize;
      let accumulated = 0;
      const result: number[] = [];
      for (const contigId of s.contigOrder) {
        const contig = s.map.contigs[contigId];
        accumulated += (contig.pixelEnd - contig.pixelStart);
        result.push(accumulated / totalPixels);
      }
      return result;
    }),
    getContigNames: vi.fn(() => []),
    getContigScaffoldIds: vi.fn(() => []),
  };
});

import {
  setupEventListeners,
  refreshAfterCuration,
  rebuildContigBoundaries,
} from '../../src/ui/EventWiring';

import { events } from '../../src/core/EventBus';
import { state } from '../../src/core/State';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import type { AppContext } from '../../src/ui/AppContext';

// Cast the mocked events.on so we can inspect calls
const mockEventsOn = events.on as ReturnType<typeof vi.fn>;

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
    trackRenderer: { removeTrack: vi.fn(), addTrack: vi.fn() } as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {} as any,
    dragReorder: {} as any,
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {
      clear: vi.fn(),
      snapshot: vi.fn(),
    } as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DOM mocking
// ---------------------------------------------------------------------------

let originalDocument: typeof globalThis.document;

beforeEach(() => {
  originalDocument = globalThis.document;
});

afterEach(() => {
  if (originalDocument) {
    globalThis.document = originalDocument;
  } else {
    (globalThis as any).document = undefined;
  }
});

function setupMockDocument(elements: Record<string, any> = {}): void {
  globalThis.document = {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventWiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // setupEventListeners
  // -------------------------------------------------------------------------
  describe('setupEventListeners', () => {
    it('should subscribe to file:loaded event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('file:loaded');
    });

    it('should subscribe to curation:cut event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:cut');
    });

    it('should subscribe to curation:join event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:join');
    });

    it('should subscribe to curation:invert event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:invert');
    });

    it('should subscribe to curation:move event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:move');
    });

    it('should subscribe to curation:undo event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:undo');
    });

    it('should subscribe to curation:redo event', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain('curation:redo');
    });

    it('should subscribe to exactly 7 events', () => {
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      expect(mockEventsOn).toHaveBeenCalledTimes(7);
    });

    it('file:loaded handler should call updateSidebarContigList', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      // Find the file:loaded handler and invoke it
      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      expect(fileLoadedCall).toBeDefined();
      const handler = fileLoadedCall![1];
      handler();

      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
    });

    it('file:loaded handler should call updateStatsPanel', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      const handler = fileLoadedCall![1];
      handler();

      expect(ctx.updateStatsPanel).toHaveBeenCalled();
    });

    it('file:loaded handler should take metrics snapshot when map is loaded', () => {
      const fakeContigs = [
        { name: 'chr1', pixelStart: 0, pixelEnd: 100, inverted: false },
      ];
      const fakeContigOrder = [0];
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: fakeContigs, textureSize: 100 },
        contigOrder: fakeContigOrder,
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      const handler = fileLoadedCall![1];
      handler();

      expect(ctx.metricsTracker.clear).toHaveBeenCalled();
      expect(ctx.metricsTracker.snapshot).toHaveBeenCalledWith(
        fakeContigs,
        fakeContigOrder,
        0
      );
    });

    it('file:loaded handler should store comparisonSnapshot when map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 100 },
        contigOrder: [0, 1, 2],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      const handler = fileLoadedCall![1];
      handler();

      expect(ctx.comparisonSnapshot).toEqual([0, 1, 2]);
      expect(ctx.comparisonVisible).toBe(false);
    });

    it('file:loaded handler should call contigExclusion.clearAll when map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: [], textureSize: 100 },
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      const handler = fileLoadedCall![1];
      handler();

      expect(contigExclusion.clearAll).toHaveBeenCalled();
    });

    it('file:loaded handler should not take metrics snapshot when no map', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const fileLoadedCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'file:loaded'
      );
      const handler = fileLoadedCall![1];
      handler();

      expect(ctx.metricsTracker.clear).not.toHaveBeenCalled();
      expect(ctx.metricsTracker.snapshot).not.toHaveBeenCalled();
    });

    it('curation:cut handler should call refreshAfterCuration logic', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [0, 1],
        undoStack: [],
      });
      const ctx = createMockCtx();
      setupEventListeners(ctx);

      const cutCall = mockEventsOn.mock.calls.find(
        (call: any[]) => call[0] === 'curation:cut'
      );
      const handler = cutCall![1];
      handler();

      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateStatsPanel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // refreshAfterCuration
  // -------------------------------------------------------------------------
  describe('refreshAfterCuration', () => {
    it('should call updateSidebarContigList', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
    });

    it('should call updateStatsPanel', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(ctx.updateStatsPanel).toHaveBeenCalled();
    });

    it('should update DOM status-contigs element with contig count', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [0, 1, 2],
        undoStack: [],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(statusContigsEl.textContent).toBe('3 contigs');
    });

    it('should display 0 contigs when contigOrder is empty', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(statusContigsEl.textContent).toBe('0 contigs');
    });

    it('should call metricsTracker.snapshot when map is loaded', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      const fakeContigs = [
        { name: 'chr1', pixelStart: 0, pixelEnd: 100, inverted: false },
      ];
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: fakeContigs, textureSize: 100 },
        contigOrder: [0],
        undoStack: [{ type: 'cut' }, { type: 'invert' }],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(ctx.metricsTracker.snapshot).toHaveBeenCalledWith(
        fakeContigs,
        [0],
        2
      );
    });

    it('should not call metricsTracker.snapshot when no map', () => {
      const statusContigsEl = { textContent: '' };
      setupMockDocument({ 'status-contigs': statusContigsEl });

      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();
      refreshAfterCuration(ctx);

      expect(ctx.metricsTracker.snapshot).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // rebuildContigBoundaries
  // -------------------------------------------------------------------------
  describe('rebuildContigBoundaries', () => {
    it('should return early when no map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
      });
      const ctx = createMockCtx();
      ctx.contigBoundaries = [0.5]; // pre-existing value
      rebuildContigBoundaries(ctx);

      // Should not have been modified (early return before resetting)
      expect(ctx.contigBoundaries).toEqual([0.5]);
    });

    it('should compute correct boundaries for single contig', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 100,
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 100, inverted: false },
          ],
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx();
      rebuildContigBoundaries(ctx);

      // (100 - 0) / 100 = 1.0
      expect(ctx.contigBoundaries).toEqual([1.0]);
    });

    it('should compute correct boundaries for multiple contigs', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 200,
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 80, inverted: false },
            { name: 'chr2', pixelStart: 80, pixelEnd: 140, inverted: false },
            { name: 'chr3', pixelStart: 140, pixelEnd: 200, inverted: false },
          ],
        },
        contigOrder: [0, 1, 2],
      });
      const ctx = createMockCtx();
      rebuildContigBoundaries(ctx);

      // contig 0: (80 - 0) = 80, accumulated = 80, 80/200 = 0.4
      // contig 1: (140 - 80) = 60, accumulated = 140, 140/200 = 0.7
      // contig 2: (200 - 140) = 60, accumulated = 200, 200/200 = 1.0
      expect(ctx.contigBoundaries).toEqual([0.4, 0.7, 1.0]);
    });

    it('should handle reordered contigs', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 200,
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 80, inverted: false },
            { name: 'chr2', pixelStart: 80, pixelEnd: 140, inverted: false },
            { name: 'chr3', pixelStart: 140, pixelEnd: 200, inverted: false },
          ],
        },
        // Reversed order: chr3, chr2, chr1
        contigOrder: [2, 1, 0],
      });
      const ctx = createMockCtx();
      rebuildContigBoundaries(ctx);

      // contig 2: (200 - 140) = 60, accumulated = 60, 60/200 = 0.3
      // contig 1: (140 - 80) = 60, accumulated = 120, 120/200 = 0.6
      // contig 0: (80 - 0) = 80, accumulated = 200, 200/200 = 1.0
      expect(ctx.contigBoundaries).toEqual([0.3, 0.6, 1.0]);
    });

    it('should produce empty array for empty contigOrder', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 100,
          contigs: [],
        },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      rebuildContigBoundaries(ctx);

      expect(ctx.contigBoundaries).toEqual([]);
    });

    it('should reset contigBoundaries before rebuilding', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          textureSize: 100,
          contigs: [
            { name: 'chr1', pixelStart: 0, pixelEnd: 50, inverted: false },
          ],
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx();
      ctx.contigBoundaries = [0.1, 0.2, 0.3]; // stale data
      rebuildContigBoundaries(ctx);

      expect(ctx.contigBoundaries).toEqual([0.5]);
    });
  });
});
