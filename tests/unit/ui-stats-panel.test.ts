import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/curation/ContigExclusion', () => ({
  contigExclusion: {
    getExcludedCount: vi.fn(() => 0),
  },
}));

import { updateStatsPanel } from '../../src/ui/StatsPanel';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(): any {
  return {
    innerHTML: '',
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
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {
      getSummary: vi.fn(() => null),
    } as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatsPanel', () => {
  let statsEl: ReturnType<typeof createMockElement>;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    vi.clearAllMocks();

    statsEl = createMockElement();

    originalDocument = globalThis.document;
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'stats-content') return statsEl;
        return null;
      }),
    } as any;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  // -------------------------------------------------------------------------
  // updateStatsPanel
  // -------------------------------------------------------------------------
  describe('updateStatsPanel', () => {
    it('should do nothing when stats-content element is not found', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const ctx = createMockCtx();

      updateStatsPanel(ctx);

      expect(ctx.metricsTracker.getSummary).not.toHaveBeenCalled();
    });

    it('should show "No data loaded" when metricsTracker returns null summary', () => {
      const ctx = createMockCtx();

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('No data loaded');
    });

    it('should display all metrics when summary is available', () => {
      const mockSummary = {
        current: {
          contigCount: 150,
          totalLength: 2_500_000_000,
          n50: 50_000_000,
          l50: 12,
          n90: 5_000_000,
          l90: 80,
          longestContig: 200_000_000,
          shortestContig: 500,
          medianLength: 10_000_000,
          scaffoldCount: 23,
          operationCount: 5,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('Contigs');
      expect(statsEl.innerHTML).toContain('150');
      expect(statsEl.innerHTML).toContain('Total length');
      expect(statsEl.innerHTML).toContain('2.50 Gb');
      expect(statsEl.innerHTML).toContain('N50');
      expect(statsEl.innerHTML).toContain('50.00 Mb');
      expect(statsEl.innerHTML).toContain('L50');
      expect(statsEl.innerHTML).toContain('12');
      expect(statsEl.innerHTML).toContain('N90');
      expect(statsEl.innerHTML).toContain('5.00 Mb');
      expect(statsEl.innerHTML).toContain('L90');
      expect(statsEl.innerHTML).toContain('80');
      expect(statsEl.innerHTML).toContain('Longest');
      expect(statsEl.innerHTML).toContain('200.00 Mb');
      expect(statsEl.innerHTML).toContain('Shortest');
      expect(statsEl.innerHTML).toContain('500 bp');
      expect(statsEl.innerHTML).toContain('Median');
      expect(statsEl.innerHTML).toContain('10.00 Mb');
      expect(statsEl.innerHTML).toContain('Scaffolds');
      expect(statsEl.innerHTML).toContain('23');
      expect(statsEl.innerHTML).toContain('Operations');
      expect(statsEl.innerHTML).toContain('5');
    });

    it('should format lengths in kilobases correctly', () => {
      const mockSummary = {
        current: {
          contigCount: 10,
          totalLength: 5_000,
          n50: 2_500,
          l50: 3,
          n90: 1_200,
          l90: 8,
          longestContig: 4_000,
          shortestContig: 800,
          medianLength: 2_000,
          scaffoldCount: 1,
          operationCount: 0,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('5.0 kb');
      expect(statsEl.innerHTML).toContain('2.5 kb');
    });

    it('should show positive delta with green color for contig count', () => {
      const mockSummary = {
        current: {
          contigCount: 100,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 5,
          operationCount: 2,
        },
        contigCountDelta: 3,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('+3');
      expect(statsEl.innerHTML).toContain('#4caf50'); // green
    });

    it('should show negative delta with red color for n50', () => {
      const mockSummary = {
        current: {
          contigCount: 100,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 5,
          operationCount: 2,
        },
        contigCountDelta: 0,
        n50Delta: -2,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('-2');
      expect(statsEl.innerHTML).toContain('#e94560'); // red
    });

    it('should not show delta when delta is 0', () => {
      const mockSummary = {
        current: {
          contigCount: 50,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 5,
          operationCount: 0,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      // No delta indicators should be present (no + or - signs in delta spans)
      expect(statsEl.innerHTML).not.toContain('#4caf50');
      expect(statsEl.innerHTML).not.toContain('#e94560');
    });

    it('should show excluded count when there are excluded contigs', () => {
      (contigExclusion.getExcludedCount as ReturnType<typeof vi.fn>).mockReturnValue(7);

      const mockSummary = {
        current: {
          contigCount: 50,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 5,
          operationCount: 0,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('Excluded');
      expect(statsEl.innerHTML).toContain('7');
    });

    it('should not show excluded row when excluded count is 0', () => {
      (contigExclusion.getExcludedCount as ReturnType<typeof vi.fn>).mockReturnValue(0);

      const mockSummary = {
        current: {
          contigCount: 50,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 5,
          operationCount: 0,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).not.toContain('Excluded');
    });

    it('should show scaffold count delta', () => {
      const mockSummary = {
        current: {
          contigCount: 50,
          totalLength: 1_000_000,
          n50: 10_000,
          l50: 5,
          n90: 5_000,
          l90: 20,
          longestContig: 50_000,
          shortestContig: 100,
          medianLength: 5_000,
          scaffoldCount: 8,
          operationCount: 3,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 2,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('+2');
    });

    it('should format gigabase-level lengths', () => {
      const mockSummary = {
        current: {
          contigCount: 5,
          totalLength: 3_000_000_000,
          n50: 1_500_000_000,
          l50: 1,
          n90: 500_000_000,
          l90: 3,
          longestContig: 2_000_000_000,
          shortestContig: 100_000_000,
          medianLength: 600_000_000,
          scaffoldCount: 2,
          operationCount: 0,
        },
        contigCountDelta: 0,
        n50Delta: 0,
        scaffoldCountDelta: 0,
      };

      const ctx = createMockCtx({
        metricsTracker: { getSummary: vi.fn(() => mockSummary) } as any,
      });

      updateStatsPanel(ctx);

      expect(statsEl.innerHTML).toContain('3.00 Gb');
      expect(statsEl.innerHTML).toContain('1.50 Gb');
    });
  });
});
