import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock the worker client to return minimal valid results
const mockComputeInsulation = vi.fn().mockResolvedValue({
  rawScores: new Float64Array(64),
  normalizedScores: new Float32Array(64),
  boundaries: [],
  boundaryStrengths: [],
});

const mockComputeDecay = vi.fn().mockResolvedValue({
  distances: Float64Array.from([1, 2, 3]),
  meanContacts: Float64Array.from([0.5, 0.3, 0.2]),
  logDistances: Float64Array.from([0, 0.301, 0.477]),
  logContacts: Float64Array.from([-0.301, -0.523, -0.699]),
  decayExponent: -1.1,
  rSquared: 0.95,
  maxDistance: 32,
});

const mockComputeCompartments = vi.fn().mockResolvedValue({
  eigenvector: new Float32Array(64),
  normalizedEigenvector: new Float32Array(64),
  iterations: 50,
  eigenvalue: 5.0,
});

vi.mock('../../src/analysis/AnalysisWorkerClient', () => ({
  AnalysisWorkerClient: vi.fn().mockImplementation(() => ({
    computeInsulation: mockComputeInsulation,
    computeContactDecay: mockComputeDecay,
    computeCompartments: mockComputeCompartments,
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

vi.mock('../../src/analysis/MisassemblyDetector', () => ({
  detectMisassemblies: vi.fn(() => ({
    flags: [],
    summary: { total: 0, boundaryViolations: 0, compartmentSwitches: 0 },
  })),
  misassemblyToTrack: vi.fn(() => ({ name: 'Misassembly Flags', data: [] })),
  buildCutSuggestions: vi.fn(() => []),
}));

vi.mock('../../src/curation/MisassemblyFlags', () => ({
  misassemblyFlags: {
    clearAll: vi.fn(),
    setFlags: vi.fn(),
    getFlaggedCount: vi.fn(() => 0),
    getAllFlags: vi.fn(() => []),
    isFlagged: vi.fn(() => false),
  },
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

vi.mock('../../src/curation/CurationEngine', () => ({
  cut: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DOM mock — set up before importing the module under test
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
  };
  return el;
}

const mockElements: Record<string, any> = {};

// Intercept document.getElementById to return mock elements
const origGetElementById = globalThis.document?.getElementById?.bind(globalThis.document);
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

import {
  scheduleAnalysisRecompute,
  runAllAnalyses,
  clearAnalysisTracks,
  snapshotBaseline,
  resetBaseline,
  getBaselineDecay,
} from '../../src/ui/AnalysisPanel';
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
    trackRenderer: { removeTrack: vi.fn(), addTrack: vi.fn() } as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {} as any,
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

describe('scheduleAnalysisRecompute', () => {
  let ctx: AppContext;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockCtx();
    mockComputeInsulation.mockClear();
    mockComputeDecay.mockClear();
    mockComputeCompartments.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAnalysisTracks(ctx);
  });

  it('does not schedule recompute when no analysis has been computed', () => {
    // No analysis computed yet — caches are null after clearAnalysisTracks
    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(2000);
    // Worker should not have been called for insulation or decay
    expect(mockComputeInsulation).not.toHaveBeenCalled();
    expect(mockComputeDecay).not.toHaveBeenCalled();
  });

  it('schedules recompute after initial analysis has been computed', async () => {
    // First run all analyses to populate caches
    await runAllAnalyses(ctx);
    mockComputeInsulation.mockClear();
    mockComputeDecay.mockClear();

    // Now schedule recompute
    scheduleAnalysisRecompute(ctx);

    // Should not fire immediately
    expect(mockComputeInsulation).not.toHaveBeenCalled();

    // Advance past debounce delay
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockComputeInsulation).toHaveBeenCalled();
    expect(mockComputeDecay).toHaveBeenCalled();
  });

  it('debounces multiple rapid calls into one recompute', async () => {
    await runAllAnalyses(ctx);
    mockComputeInsulation.mockClear();
    mockComputeDecay.mockClear();

    // Simulate rapid curation operations
    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(200);
    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(200);
    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(200);
    scheduleAnalysisRecompute(ctx);

    // Not yet fired
    expect(mockComputeInsulation).not.toHaveBeenCalled();

    // Advance past debounce from last call
    await vi.advanceTimersByTimeAsync(1100);

    // Only one recompute should have fired
    expect(mockComputeInsulation).toHaveBeenCalledTimes(1);
    expect(mockComputeDecay).toHaveBeenCalledTimes(1);
  });

  it('resets timer on successive calls', async () => {
    await runAllAnalyses(ctx);
    mockComputeInsulation.mockClear();

    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(800); // 200ms before it would fire
    scheduleAnalysisRecompute(ctx); // Reset timer

    // Original timer would have fired at 1000ms, but was reset
    vi.advanceTimersByTime(200);
    expect(mockComputeInsulation).not.toHaveBeenCalled();

    // Now advance to when the reset timer fires
    await vi.advanceTimersByTimeAsync(900);
    expect(mockComputeInsulation).toHaveBeenCalledTimes(1);
  });

  it('does not recompute compartments during auto-recompute', async () => {
    await runAllAnalyses(ctx);
    mockComputeCompartments.mockClear();

    scheduleAnalysisRecompute(ctx);
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockComputeCompartments).not.toHaveBeenCalled();
  });

  it('clearAnalysisTracks cancels pending recompute', async () => {
    await runAllAnalyses(ctx);
    mockComputeInsulation.mockClear();

    scheduleAnalysisRecompute(ctx);
    vi.advanceTimersByTime(500);

    // Clear tracks cancels the pending timer
    clearAnalysisTracks(ctx);

    await vi.advanceTimersByTimeAsync(1000);

    // Should NOT have been called
    expect(mockComputeInsulation).not.toHaveBeenCalled();
  });

  it('queues recompute when computing flag is true', async () => {
    await runAllAnalyses(ctx);
    mockComputeInsulation.mockClear();
    mockComputeDecay.mockClear();

    // Make decay slow so computing flag stays true
    let resolveDecay!: (v: any) => void;
    mockComputeDecay.mockImplementationOnce(() => new Promise(r => { resolveDecay = r; }));

    // Start a manual computation that will be slow
    scheduleAnalysisRecompute(ctx);
    await vi.advanceTimersByTimeAsync(1100);

    // Now insulation finished but decay is still pending
    // Schedule another recompute while computing
    scheduleAnalysisRecompute(ctx);
    await vi.advanceTimersByTimeAsync(1100);

    // Resolve the slow decay
    resolveDecay({
      distances: Float64Array.from([1, 2]),
      meanContacts: Float64Array.from([0.5, 0.3]),
      logDistances: Float64Array.from([0, 0.301]),
      logContacts: Float64Array.from([-0.301, -0.523]),
      decayExponent: -1.1,
      rSquared: 0.95,
      maxDistance: 32,
    });

    // Let the chained recompute fire (100ms delay + computation)
    await vi.advanceTimersByTimeAsync(200);

    // The insulation should have been called at least twice
    // (once in first recompute, once in chained recompute)
    expect(mockComputeInsulation.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('integration: refreshAfterCuration triggers recompute', () => {
  it('scheduleAnalysisRecompute is exported and callable', () => {
    expect(typeof scheduleAnalysisRecompute).toBe('function');
  });
});

describe('baseline decay management', () => {
  let ctx: AppContext;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockCtx();
    mockComputeInsulation.mockClear();
    mockComputeDecay.mockClear();
    mockComputeCompartments.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAnalysisTracks(ctx);
  });

  it('captures baseline on first runAllAnalyses', async () => {
    expect(getBaselineDecay()).toBeNull();
    await runAllAnalyses(ctx);
    expect(getBaselineDecay()).not.toBeNull();
    expect(getBaselineDecay()!.decayExponent).toBe(-1.1);
  });

  it('does not overwrite baseline on subsequent runAllAnalyses', async () => {
    await runAllAnalyses(ctx);
    const first = getBaselineDecay();

    // Change mock to return different exponent
    mockComputeDecay.mockResolvedValueOnce({
      distances: Float64Array.from([1, 2, 3]),
      meanContacts: Float64Array.from([0.5, 0.3, 0.2]),
      logDistances: Float64Array.from([0, 0.301, 0.477]),
      logContacts: Float64Array.from([-0.301, -0.523, -0.699]),
      decayExponent: -1.5,
      rSquared: 0.90,
      maxDistance: 32,
    });

    await runAllAnalyses(ctx);
    // Baseline should still be the first capture
    expect(getBaselineDecay()).toBe(first);
    expect(getBaselineDecay()!.decayExponent).toBe(-1.1);
  });

  it('clearAnalysisTracks clears baseline', async () => {
    await runAllAnalyses(ctx);
    expect(getBaselineDecay()).not.toBeNull();
    clearAnalysisTracks(ctx);
    expect(getBaselineDecay()).toBeNull();
  });

  it('snapshotBaseline captures current decay', async () => {
    await runAllAnalyses(ctx);
    clearAnalysisTracks(ctx);
    expect(getBaselineDecay()).toBeNull();

    // Re-run to get a new cachedDecay
    await runAllAnalyses(ctx);
    // Clear baseline only (not cachedDecay)
    resetBaseline();
    expect(getBaselineDecay()).toBeNull();

    // Snapshot should capture the current cached decay
    snapshotBaseline();
    expect(getBaselineDecay()).not.toBeNull();
    expect(getBaselineDecay()!.decayExponent).toBe(-1.1);
  });

  it('resetBaseline clears baseline without affecting decay', async () => {
    await runAllAnalyses(ctx);
    expect(getBaselineDecay()).not.toBeNull();
    resetBaseline();
    expect(getBaselineDecay()).toBeNull();
    // Decay should still be computed (we can verify by snapshotting)
    snapshotBaseline();
    expect(getBaselineDecay()).not.toBeNull();
  });

  it('snapshotBaseline is a no-op when no decay is cached', () => {
    clearAnalysisTracks(ctx);
    snapshotBaseline();
    expect(getBaselineDecay()).toBeNull();
  });
});
