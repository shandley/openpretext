import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (variables used inside vi.mock factories)
// ---------------------------------------------------------------------------

const {
  mockCut,
  mockGetAllFlags,
  mockGetFlaggedCount,
  mockBuildCutSuggestions,
} = vi.hoisted(() => ({
  mockCut: vi.fn(),
  mockGetAllFlags: vi.fn(() => [
    { contigId: 0, overviewPixel: 16, reason: 'tad_boundary', strength: 0.8 },
    { contigId: 1, overviewPixel: 48, reason: 'compartment_switch', strength: 0.6 },
  ]),
  mockGetFlaggedCount: vi.fn(() => 2),
  mockBuildCutSuggestions: vi.fn(() => [
    { orderIndex: 1, contigId: 1, contigName: 'c1', pixelOffset: 16, reason: 'compartment_switch' as const, strength: 0.6 },
    { orderIndex: 0, contigId: 0, contigName: 'c0', pixelOffset: 16, reason: 'tad_boundary' as const, strength: 0.8 },
  ]),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: {
        contactMap: new Float32Array(64 * 64),
        contigs: [
          { pixelStart: 0, pixelEnd: 32, scaffoldId: null, inverted: false, name: 'c0' },
          { pixelStart: 32, pixelEnd: 64, scaffoldId: null, inverted: false, name: 'c1' },
        ],
        textureSize: 64,
        filename: 'test.pretext',
      },
      contigOrder: [0, 1],
      undoStack: [],
      mode: 'navigate',
      camera: { x: 0.5, y: 0.5, zoom: 1 },
      gamma: 1,
      colorMapName: 'YlOrRd',
      showGrid: true,
      selectedContigs: new Set<number>(),
    })),
    update: vi.fn(),
    select: vi.fn(() => () => {}),
    updateContig: vi.fn(),
    updateContigs: vi.fn(),
    appendContigs: vi.fn(),
    pushOperation: vi.fn(),
  },
  selectContigOrder: (s: any) => s.contigOrder,
}));

vi.mock('../../src/core/EventBus', () => ({
  events: { on: vi.fn(), emit: vi.fn() },
}));

vi.mock('../../src/core/DerivedState', () => ({
  getContigBoundaries: vi.fn(() => [0.5, 1.0]),
}));

vi.mock('../../src/curation/ContigExclusion', () => ({
  contigExclusion: { clearAll: vi.fn() },
}));

vi.mock('../../src/curation/CurationEngine', () => ({
  cut: (...args: any[]) => mockCut(...args),
}));

vi.mock('../../src/curation/MisassemblyFlags', () => ({
  misassemblyFlags: {
    clearAll: vi.fn(),
    setFlags: vi.fn(),
    getFlaggedCount: mockGetFlaggedCount,
    getAllFlags: mockGetAllFlags,
    isFlagged: vi.fn(() => false),
  },
}));

vi.mock('../../src/analysis/MisassemblyDetector', () => ({
  buildCutSuggestions: (...args: any[]) => mockBuildCutSuggestions(...args),
  detectMisassemblies: vi.fn(() => ({
    flags: [],
    summary: { total: 0, boundaryViolations: 0, compartmentSwitches: 0 },
  })),
  misassemblyToTrack: vi.fn(() => ({ name: 'Misassembly Flags', data: [] })),
}));

vi.mock('../../src/analysis/AnalysisWorkerClient', () => ({
  AnalysisWorkerClient: vi.fn().mockImplementation(() => ({
    computeInsulation: vi.fn().mockResolvedValue({
      rawScores: new Float64Array(64),
      normalizedScores: new Float32Array(64),
      boundaries: [],
      boundaryStrengths: [],
    }),
    computeContactDecay: vi.fn().mockResolvedValue({
      distances: Float64Array.from([1, 2, 3]),
      meanContacts: Float64Array.from([0.5, 0.3, 0.2]),
      logDistances: Float64Array.from([0, 0.301, 0.477]),
      logContacts: Float64Array.from([-0.301, -0.523, -0.699]),
      decayExponent: -1.1,
      rSquared: 0.95,
      maxDistance: 32,
    }),
    computeCompartments: vi.fn().mockResolvedValue({
      eigenvector: new Float32Array(64),
      normalizedEigenvector: new Float32Array(64),
      iterations: 50,
      eigenvalue: 5.0,
    }),
  })),
}));

vi.mock('../../src/analysis/InsulationScore', () => ({
  insulationToTracks: vi.fn(() => ({
    insulationTrack: { name: 'Insulation Score', data: [] },
    boundaryTrack: { name: 'TAD Boundaries', data: [] },
  })),
}));

vi.mock('../../src/analysis/CompartmentAnalysis', () => ({
  compartmentToTrack: vi.fn(() => ({ name: 'A/B Compartments', data: [] })),
}));

vi.mock('../../src/analysis/ContactDecay', () => ({
  formatDecayStats: vi.fn(() => ''),
  computeDecayByScaffold: vi.fn(() => []),
}));

vi.mock('../../src/analysis/HealthScore', () => ({
  computeHealthScore: vi.fn(() => ({
    overall: 75,
    components: { contiguity: 80, decayQuality: 70, integrity: 80, compartments: 70 },
  })),
}));

vi.mock('../../src/export/AnalysisExport', () => ({
  downloadInsulationBedGraph: vi.fn(),
  downloadCompartmentBedGraph: vi.fn(),
  downloadDecayTSV: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DOM mock
// ---------------------------------------------------------------------------

function createMockElement(tag?: string): any {
  const el: any = {
    tagName: tag ?? 'DIV',
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    disabled: false,
    value: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    getAttribute: vi.fn(),
    setAttribute: vi.fn(),
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
    querySelectorAll: vi.fn(() => []),
  };
  return el;
}

const mockElements: Record<string, any> = {};

vi.stubGlobal('document', {
  getElementById: vi.fn((id: string) => {
    if (!mockElements[id]) {
      mockElements[id] = createMockElement();
    }
    return mockElements[id];
  }),
  createElement: vi.fn(() => createMockElement()),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
});

vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

import { openCutReview, closeCutReview, isCutReviewActive } from '../../src/ui/CutReviewPanel';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockCtx(): AppContext {
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
    contigBoundaries: [0.5, 1.0],
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
    camera: {
      zoomToRegion: vi.fn(),
      animateTo: vi.fn(),
      getState: vi.fn(() => ({ x: 0.5, y: 0.5, zoom: 1 })),
    } as any,
    dragReorder: {} as any,
    scaffoldManager: { getAllScaffolds: vi.fn(() => []) } as any,
    waypointManager: {} as any,
    metricsTracker: {
      clear: vi.fn(),
      snapshot: vi.fn(),
      getLatest: vi.fn(() => ({
        n50: 1000, totalLength: 10000, contigCount: 2,
        l50: 5, n90: 200, l90: 9,
      })),
      getSummary: vi.fn(),
    } as any,
    tileManager: null,
    cancelTileDecode: null,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CutReviewPanel', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createMockCtx();
    mockCut.mockClear();
    mockBuildCutSuggestions.mockClear();
    mockGetAllFlags.mockClear();
    mockGetFlaggedCount.mockClear();
    // Reset mock elements
    for (const key of Object.keys(mockElements)) {
      delete mockElements[key];
    }
  });

  afterEach(() => {
    if (isCutReviewActive()) {
      closeCutReview(ctx);
    }
  });

  it('is not active before opening', () => {
    expect(isCutReviewActive()).toBe(false);
  });

  it('opens and becomes active when suggestions exist', () => {
    openCutReview(ctx);
    expect(isCutReviewActive()).toBe(true);
    expect(mockBuildCutSuggestions).toHaveBeenCalled();
  });

  it('navigates camera to first suggestion on open', () => {
    openCutReview(ctx);
    expect((ctx.camera as any).zoomToRegion).toHaveBeenCalled();
  });

  it('shows toast and stays inactive when no flags', () => {
    mockGetAllFlags.mockReturnValueOnce([]);
    openCutReview(ctx);
    expect(isCutReviewActive()).toBe(false);
    expect(ctx.showToast).toHaveBeenCalledWith('No misassemblies detected');
  });

  it('shows toast when suggestions are empty', () => {
    mockBuildCutSuggestions.mockReturnValueOnce([]);
    openCutReview(ctx);
    expect(isCutReviewActive()).toBe(false);
    expect(ctx.showToast).toHaveBeenCalledWith('No cut suggestions available');
  });

  it('closeCutReview resets state', () => {
    openCutReview(ctx);
    expect(isCutReviewActive()).toBe(true);
    closeCutReview(ctx);
    expect(isCutReviewActive()).toBe(false);
  });

  it('does not show summary toast when no cuts accepted', () => {
    openCutReview(ctx);
    closeCutReview(ctx);
    const toastCalls = (ctx.showToast as any).mock.calls;
    const summaryToasts = toastCalls.filter((c: string[]) =>
      typeof c[0] === 'string' && c[0].includes('Review complete'),
    );
    expect(summaryToasts.length).toBe(0);
  });

  it('sorts suggestions ascending by orderIndex for left-to-right review', () => {
    // mockBuildCutSuggestions returns [orderIndex:1, orderIndex:0]
    // After open, queue should be sorted ascending: [0, 1]
    openCutReview(ctx);
    const zoomCalls = (ctx.camera as any).zoomToRegion.mock.calls;
    expect(zoomCalls.length).toBeGreaterThan(0);
    // First suggestion is c0 (orderIndex 0), spans 0-0.5 in map space
    const [x1] = zoomCalls[0];
    expect(x1).toBeLessThan(0.5);
  });

  it('installs keyboard handler on open with capture phase', () => {
    openCutReview(ctx);
    expect((window as any).addEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      true,
    );
  });

  it('removes keyboard handler on close', () => {
    openCutReview(ctx);
    closeCutReview(ctx);
    expect((window as any).removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      true,
    );
  });
});
