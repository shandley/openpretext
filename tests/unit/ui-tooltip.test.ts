import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../../src/ui/Sidebar', () => ({
  formatBp: vi.fn((bp: number) => `${bp} bp`),
}));

import { state } from '../../src/core/State';
import { formatBp } from '../../src/ui/Sidebar';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(): any {
  const classes = new Set<string>();
  return {
    innerHTML: '',
    style: { left: '', top: '' },
    offsetWidth: 200,
    offsetHeight: 100,
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      contains: (cls: string) => classes.has(cls),
      has: (cls: string) => classes.has(cls),
    },
    _classes: classes,
  };
}

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
    scaffoldManager: {
      getScaffold: vi.fn(() => null),
    } as any,
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

describe('Tooltip', () => {
  let tooltipEl: ReturnType<typeof createMockElement>;
  let originalDocument: typeof globalThis.document;
  let originalWindow: typeof globalThis.window;

  // We need to re-import the module for each test to reset module-local state
  // (tooltipVisible). Use dynamic imports after resetting modules.
  let updateTooltip: typeof import('../../src/ui/Tooltip').updateTooltip;
  let hideTooltip: typeof import('../../src/ui/Tooltip').hideTooltip;

  beforeEach(async () => {
    vi.clearAllMocks();

    tooltipEl = createMockElement();

    originalDocument = globalThis.document;
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'tooltip') return tooltipEl;
        return null;
      }),
    } as any;

    originalWindow = globalThis.window;
    globalThis.window = {
      innerWidth: 1024,
      innerHeight: 768,
    } as any;

    // Reset modules to clear module-local `tooltipVisible` state
    vi.resetModules();
    const mod = await import('../../src/ui/Tooltip');
    updateTooltip = mod.updateTooltip;
    hideTooltip = mod.hideTooltip;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  // -------------------------------------------------------------------------
  // updateTooltip
  // -------------------------------------------------------------------------
  describe('updateTooltip', () => {
    it('should do nothing when tooltip element is not found', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const ctx = createMockCtx({ hoveredContigIndex: 0 });

      updateTooltip(ctx, 100, 100);

      // No error thrown, nothing happens
      expect(state.get).not.toHaveBeenCalled();
    });

    it('should hide tooltip when no map is loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
      });
      const ctx = createMockCtx({ hoveredContigIndex: 0 });

      updateTooltip(ctx, 100, 100);

      // hideTooltip is called internally; since tooltipVisible starts false,
      // classList.remove won't be called (short-circuit), but no content is set
      expect(tooltipEl.innerHTML).toBe('');
    });

    it('should hide tooltip when hoveredContigIndex is -1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: { 0: { name: 'chr1', length: 1000, pixelStart: 0, pixelEnd: 100, inverted: false, scaffoldId: null } } },
        contigOrder: [0],
      });
      const ctx = createMockCtx({ hoveredContigIndex: -1 });

      updateTooltip(ctx, 100, 100);

      expect(tooltipEl.innerHTML).toBe('');
    });

    it('should hide tooltip when contig is not found in map', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contigs: {} },
        contigOrder: [999],
      });
      const ctx = createMockCtx({ hoveredContigIndex: 0 });

      updateTooltip(ctx, 100, 100);

      expect(tooltipEl.innerHTML).toBe('');
    });

    it('should show tooltip with correct content for a valid contig', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            42: {
              name: 'scaffold_1',
              length: 5000,
              pixelStart: 10,
              pixelEnd: 110,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [42],
      });
      (formatBp as ReturnType<typeof vi.fn>).mockReturnValue('5.0 kb');

      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 1.5, y: 2.5 },
      });

      updateTooltip(ctx, 200, 300);

      expect(formatBp).toHaveBeenCalledWith(5000);
      expect(tooltipEl.innerHTML).toContain('scaffold_1');
      expect(tooltipEl.innerHTML).toContain('5.0 kb');
      expect(tooltipEl.innerHTML).toContain('100 px'); // pixelEnd - pixelStart = 100
      expect(tooltipEl.innerHTML).toContain('1 / 1'); // order
      expect(tooltipEl.innerHTML).toContain('Forward'); // not inverted
      expect(tooltipEl.innerHTML).toContain('1.500, 2.500'); // map pos
      expect(tooltipEl.classList.add).toHaveBeenCalledWith('visible');
    });

    it('should show "Inverted" for inverted contigs', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'ctg_inv',
              length: 2000,
              pixelStart: 0,
              pixelEnd: 50,
              inverted: true,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });

      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 100, 100);

      expect(tooltipEl.innerHTML).toContain('Inverted');
    });

    it('should show scaffold info when contig has a scaffoldId', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            5: {
              name: 'chr2',
              length: 3000,
              pixelStart: 0,
              pixelEnd: 60,
              inverted: false,
              scaffoldId: 7,
            },
          },
        },
        contigOrder: [5],
      });

      const mockScaffoldManager = {
        getScaffold: vi.fn(() => ({ name: 'ScaffoldA', color: '#ff0000' })),
      };
      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
        scaffoldManager: mockScaffoldManager as any,
      });

      updateTooltip(ctx, 100, 100);

      expect(mockScaffoldManager.getScaffold).toHaveBeenCalledWith(7);
      expect(tooltipEl.innerHTML).toContain('Scaffold');
      expect(tooltipEl.innerHTML).toContain('ScaffoldA');
      expect(tooltipEl.innerHTML).toContain('#ff0000');
    });

    it('should not show scaffold info when scaffoldId is null', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'chr1',
              length: 1000,
              pixelStart: 0,
              pixelEnd: 50,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });

      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 100, 100);

      expect(tooltipEl.innerHTML).not.toContain('tooltip-badge');
    });

    it('should position tooltip near the cursor with offset', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'c1',
              length: 100,
              pixelStart: 0,
              pixelEnd: 10,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });

      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 200, 300);

      // offset = 16 for both X and Y
      expect(tooltipEl.style.left).toBe('216px');
      expect(tooltipEl.style.top).toBe('316px');
    });

    it('should flip tooltip left when it would exceed the right viewport edge', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'c1',
              length: 100,
              pixelStart: 0,
              pixelEnd: 10,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });
      // tooltipEl.offsetWidth = 200, window.innerWidth = 1024
      // clientX + 16 + 200 = 916 > 1024 - 10 = 1014 when clientX > 798
      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 900, 100);

      // left = 900 - 200 - 8 = 692
      expect(tooltipEl.style.left).toBe('692px');
    });

    it('should flip tooltip up when it would exceed the bottom viewport edge', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'c1',
              length: 100,
              pixelStart: 0,
              pixelEnd: 10,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });
      // tooltipEl.offsetHeight = 100, window.innerHeight = 768
      // clientY + 16 + 100 > 768 - 10 = 758 when clientY > 642
      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 100, 700);

      // top = 700 - 100 - 8 = 592
      expect(tooltipEl.style.top).toBe('592px');
    });

    it('should show correct order for contig in the middle of the list', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            10: { name: 'A', length: 100, pixelStart: 0, pixelEnd: 10, inverted: false, scaffoldId: null },
            20: { name: 'B', length: 200, pixelStart: 10, pixelEnd: 30, inverted: false, scaffoldId: null },
            30: { name: 'C', length: 300, pixelStart: 30, pixelEnd: 60, inverted: false, scaffoldId: null },
          },
        },
        contigOrder: [10, 20, 30],
      });

      const ctx = createMockCtx({
        hoveredContigIndex: 1,
        mouseMapPos: { x: 0, y: 0 },
      });

      updateTooltip(ctx, 100, 100);

      expect(tooltipEl.innerHTML).toContain('2 / 3'); // order: index 1 + 1 = 2 out of 3
    });
  });

  // -------------------------------------------------------------------------
  // hideTooltip
  // -------------------------------------------------------------------------
  describe('hideTooltip', () => {
    it('should be a no-op when tooltip is already hidden (tooltipVisible is false)', () => {
      // Module just loaded, tooltipVisible starts as false
      hideTooltip();

      // classList.remove should NOT have been called because tooltipVisible is false
      expect(tooltipEl.classList.remove).not.toHaveBeenCalled();
    });

    it('should remove "visible" class when tooltip was visible', () => {
      // First make tooltip visible via updateTooltip
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'c1',
              length: 100,
              pixelStart: 0,
              pixelEnd: 10,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });
      updateTooltip(ctx, 100, 100);
      expect(tooltipEl.classList.add).toHaveBeenCalledWith('visible');

      // Now hide it
      hideTooltip();
      expect(tooltipEl.classList.remove).toHaveBeenCalledWith('visible');
    });

    it('should not remove class on second call (already hidden after first hide)', () => {
      // Make visible
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          contigs: {
            0: {
              name: 'c1',
              length: 100,
              pixelStart: 0,
              pixelEnd: 10,
              inverted: false,
              scaffoldId: null,
            },
          },
        },
        contigOrder: [0],
      });
      const ctx = createMockCtx({
        hoveredContigIndex: 0,
        mouseMapPos: { x: 0, y: 0 },
      });
      updateTooltip(ctx, 100, 100);

      // First hide
      hideTooltip();
      expect(tooltipEl.classList.remove).toHaveBeenCalledTimes(1);

      // Second hide should be no-op
      hideTooltip();
      expect(tooltipEl.classList.remove).toHaveBeenCalledTimes(1);
    });
  });
});
