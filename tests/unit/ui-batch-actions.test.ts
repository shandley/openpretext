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
      undoStack: [],
    })),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectToggle: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedIndices: vi.fn(() => []),
  },
}));

vi.mock('../../src/curation/CurationEngine', () => ({
  undoBatch: vi.fn(() => 0),
}));

vi.mock('../../src/curation/BatchOperations', () => ({
  selectByPattern: vi.fn(() => []),
  selectBySize: vi.fn(() => []),
  batchCutBySize: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
  batchJoinSelected: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
  batchInvertSelected: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
  sortByLength: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
  autoSortContigs: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
  autoCutContigs: vi.fn(() => ({ operationsPerformed: 0, description: 'no-op' })),
}));

// ---------------------------------------------------------------------------
// Import module under test and mocked dependencies
// ---------------------------------------------------------------------------

import {
  runBatchSelectByPattern,
  runBatchSelectBySize,
  runBatchCut,
  runBatchJoin,
  runBatchInvert,
  runSortByLength,
  runAutoSort,
  runAutoCut,
  undoLastBatch,
} from '../../src/ui/BatchActions';

import { state } from '../../src/core/State';
import { SelectionManager } from '../../src/curation/SelectionManager';
import { undoBatch } from '../../src/curation/CurationEngine';
import {
  selectByPattern,
  selectBySize,
  batchCutBySize,
  batchJoinSelected,
  batchInvertSelected,
  sortByLength,
  autoSortContigs,
  autoCutContigs,
} from '../../src/curation/BatchOperations';

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
    scaffoldManager: { getAllScaffolds: () => [] } as any,
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

describe('BatchActions', () => {
  // Save the original globalThis.prompt so we can restore it
  const originalPrompt = globalThis.prompt;

  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a default mock prompt that returns null (cancelled)
    globalThis.prompt = vi.fn(() => null) as any;
  });

  afterEach(() => {
    globalThis.prompt = originalPrompt;
  });

  // -------------------------------------------------------------------------
  // runBatchSelectByPattern
  // -------------------------------------------------------------------------
  describe('runBatchSelectByPattern', () => {
    it('should do nothing when prompt is cancelled (null)', () => {
      globalThis.prompt = vi.fn(() => null) as any;
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(selectByPattern).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should do nothing when prompt returns empty string', () => {
      globalThis.prompt = vi.fn(() => '') as any;
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(selectByPattern).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should show toast when no contigs match pattern', () => {
      globalThis.prompt = vi.fn(() => 'chr*') as any;
      (selectByPattern as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(selectByPattern).toHaveBeenCalledWith('chr*');
      expect(ctx.showToast).toHaveBeenCalledWith('No contigs match pattern');
      expect(SelectionManager.selectToggle).not.toHaveBeenCalled();
    });

    it('should toggle selection for matching contigs and update sidebar', () => {
      globalThis.prompt = vi.fn(() => 'scaffold_*') as any;
      (selectByPattern as ReturnType<typeof vi.fn>).mockReturnValue([0, 2, 5]);
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(selectByPattern).toHaveBeenCalledWith('scaffold_*');
      expect(SelectionManager.selectToggle).toHaveBeenCalledTimes(3);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(0);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(2);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(5);
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Selected 3 contigs matching "scaffold_*"');
    });

    it('should show toast with error message when selectByPattern throws', () => {
      globalThis.prompt = vi.fn(() => '[invalid') as any;
      (selectByPattern as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid regular expression');
      });
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid pattern: Invalid regular expression');
    });

    it('should show generic error message when selectByPattern throws non-Error', () => {
      globalThis.prompt = vi.fn(() => 'bad') as any;
      (selectByPattern as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 'string-error';
      });
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid pattern: Unknown error');
    });

    it('should select a single matching contig', () => {
      globalThis.prompt = vi.fn(() => 'chrX') as any;
      (selectByPattern as ReturnType<typeof vi.fn>).mockReturnValue([7]);
      const ctx = createMockCtx();

      runBatchSelectByPattern(ctx);

      expect(SelectionManager.selectToggle).toHaveBeenCalledTimes(1);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(7);
      expect(ctx.showToast).toHaveBeenCalledWith('Selected 1 contigs matching "chrX"');
    });
  });

  // -------------------------------------------------------------------------
  // runBatchSelectBySize
  // -------------------------------------------------------------------------
  describe('runBatchSelectBySize', () => {
    it('should do nothing when prompt is cancelled (null)', () => {
      globalThis.prompt = vi.fn(() => null) as any;
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      expect(selectBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should do nothing when prompt returns empty string', () => {
      globalThis.prompt = vi.fn(() => '') as any;
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      expect(selectBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should show toast when no contigs match size range', () => {
      globalThis.prompt = vi.fn(() => '1000000-5000000') as any;
      (selectBySize as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      expect(selectBySize).toHaveBeenCalledWith(1000000, 5000000);
      expect(ctx.showToast).toHaveBeenCalledWith('No contigs in size range');
      expect(SelectionManager.selectToggle).not.toHaveBeenCalled();
    });

    it('should toggle selection for matching contigs and update sidebar', () => {
      globalThis.prompt = vi.fn(() => '100-500') as any;
      (selectBySize as ReturnType<typeof vi.fn>).mockReturnValue([1, 3]);
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      expect(selectBySize).toHaveBeenCalledWith(100, 500);
      expect(SelectionManager.selectToggle).toHaveBeenCalledTimes(2);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(1);
      expect(SelectionManager.selectToggle).toHaveBeenCalledWith(3);
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Selected 2 contigs in size range');
    });

    it('should handle min only (no max) when input has no dash', () => {
      globalThis.prompt = vi.fn(() => '5000') as any;
      (selectBySize as ReturnType<typeof vi.fn>).mockReturnValue([0]);
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      // parts[0] = 5000, parts[1] = undefined => parseInt(undefined) = NaN
      // NaN || undefined => undefined for max
      expect(selectBySize).toHaveBeenCalledWith(5000, undefined);
    });

    it('should handle range with spaces around dash', () => {
      globalThis.prompt = vi.fn(() => '1000 - 2000') as any;
      (selectBySize as ReturnType<typeof vi.fn>).mockReturnValue([2]);
      const ctx = createMockCtx();

      runBatchSelectBySize(ctx);

      expect(selectBySize).toHaveBeenCalledWith(1000, 2000);
    });
  });

  // -------------------------------------------------------------------------
  // runBatchCut
  // -------------------------------------------------------------------------
  describe('runBatchCut', () => {
    it('should do nothing when prompt is cancelled (null)', () => {
      globalThis.prompt = vi.fn(() => null) as any;
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should do nothing when prompt returns empty string', () => {
      globalThis.prompt = vi.fn(() => '') as any;
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should show toast for invalid (non-numeric) input', () => {
      globalThis.prompt = vi.fn(() => 'abc') as any;
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Invalid size');
    });

    it('should show toast for zero input', () => {
      globalThis.prompt = vi.fn(() => '0') as any;
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Invalid size');
    });

    it('should show toast for negative input', () => {
      globalThis.prompt = vi.fn(() => '-100') as any;
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).not.toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Invalid size');
    });

    it('should call batchCutBySize and refresh on valid input', () => {
      globalThis.prompt = vi.fn(() => '5000000') as any;
      (batchCutBySize as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 3,
        description: 'Cut 3 contig(s) larger than 5000000 bp at their midpoints',
      });
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).toHaveBeenCalledWith(5000000);
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Cut 3 contig(s) larger than 5000000 bp at their midpoints');
    });

    it('should handle input with whitespace', () => {
      globalThis.prompt = vi.fn(() => '  1000  ') as any;
      (batchCutBySize as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 1,
        description: 'Cut 1 contig(s)',
      });
      const ctx = createMockCtx();

      runBatchCut(ctx);

      expect(batchCutBySize).toHaveBeenCalledWith(1000);
    });
  });

  // -------------------------------------------------------------------------
  // runBatchJoin
  // -------------------------------------------------------------------------
  describe('runBatchJoin', () => {
    it('should show toast when no operations performed (no adjacent selection)', () => {
      (batchJoinSelected as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 0,
        description: 'Need at least 2 selected contigs to join',
      });
      const ctx = createMockCtx();

      runBatchJoin(ctx);

      expect(batchJoinSelected).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Select adjacent contigs to batch join');
      expect(ctx.refreshAfterCuration).not.toHaveBeenCalled();
      expect(SelectionManager.clearSelection).not.toHaveBeenCalled();
    });

    it('should clear selection, refresh, and show description on success', () => {
      (batchJoinSelected as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 2,
        description: 'Joined 2 adjacent contig pair(s) across 1 contiguous run(s)',
      });
      const ctx = createMockCtx();

      runBatchJoin(ctx);

      expect(batchJoinSelected).toHaveBeenCalled();
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Joined 2 adjacent contig pair(s) across 1 contiguous run(s)');
    });
  });

  // -------------------------------------------------------------------------
  // runBatchInvert
  // -------------------------------------------------------------------------
  describe('runBatchInvert', () => {
    it('should show toast when no operations performed (no selection)', () => {
      (batchInvertSelected as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 0,
        description: 'No contigs selected',
      });
      const ctx = createMockCtx();

      runBatchInvert(ctx);

      expect(batchInvertSelected).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Select contigs to batch invert');
      expect(ctx.refreshAfterCuration).not.toHaveBeenCalled();
    });

    it('should refresh and show description on success', () => {
      (batchInvertSelected as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 4,
        description: 'Inverted 4 contig(s)',
      });
      const ctx = createMockCtx();

      runBatchInvert(ctx);

      expect(batchInvertSelected).toHaveBeenCalled();
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Inverted 4 contig(s)');
    });
  });

  // -------------------------------------------------------------------------
  // runSortByLength
  // -------------------------------------------------------------------------
  describe('runSortByLength', () => {
    it('should call sortByLength with descending=true and refresh', () => {
      (sortByLength as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 5,
        description: 'Sorted 10 contigs by length (descending), 5 move(s)',
      });
      const ctx = createMockCtx();

      runSortByLength(ctx);

      expect(sortByLength).toHaveBeenCalledWith(true);
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Sorted 10 contigs by length (descending), 5 move(s)');
    });

    it('should still refresh even when no moves needed (already sorted)', () => {
      (sortByLength as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 0,
        description: 'Sorted 5 contigs by length (descending), 0 move(s)',
      });
      const ctx = createMockCtx();

      runSortByLength(ctx);

      expect(sortByLength).toHaveBeenCalledWith(true);
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Sorted 5 contigs by length (descending), 0 move(s)');
    });
  });

  // -------------------------------------------------------------------------
  // runAutoSort
  // -------------------------------------------------------------------------
  describe('runAutoSort', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show toast and return early when no contact map loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No contact map loaded');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should show toast when map exists but contactMap is null', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: null, contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No contact map loaded');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should do nothing when prompt is cancelled (null)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => null) as any;
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).not.toHaveBeenCalledWith('Auto sorting...');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should use default threshold when prompt returns empty string', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '') as any;
      (autoSortContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 3,
        description: 'Auto sort: 3 operation(s) (1 chain(s))',
      });
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto sorting...');

      // Advance timers to trigger the setTimeout callback
      vi.advanceTimersByTime(50);

      expect(autoSortContigs).toHaveBeenCalledWith(undefined);
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Auto sort: 3 operation(s) (1 chain(s))');
    });

    it('should pass hardThreshold when a valid number is provided', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '0.35') as any;
      (autoSortContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 2,
        description: 'Auto sort: 2 operation(s)',
      });
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto sorting...');

      vi.advanceTimersByTime(50);

      expect(autoSortContigs).toHaveBeenCalledWith({ hardThreshold: 0.35 });
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
    });

    it('should show toast for invalid threshold (NaN)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => 'not-a-number') as any;
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should show toast for threshold of 0', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '0') as any;
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should show toast for threshold greater than 1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '1.5') as any;
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should show toast for negative threshold', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '-0.1') as any;
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoSortContigs).not.toHaveBeenCalled();
    });

    it('should accept threshold of exactly 1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '1') as any;
      (autoSortContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 0,
        description: 'Auto sort: 0 operation(s)',
      });
      const ctx = createMockCtx();

      runAutoSort(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto sorting...');
      vi.advanceTimersByTime(50);
      expect(autoSortContigs).toHaveBeenCalledWith({ hardThreshold: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // runAutoCut
  // -------------------------------------------------------------------------
  describe('runAutoCut', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show toast and return early when no contact map loaded', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No contact map loaded');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should show toast when map exists but contactMap is null', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: null, contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No contact map loaded');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should do nothing when prompt is cancelled (null)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => null) as any;
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).not.toHaveBeenCalledWith('Auto cutting...');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should use default threshold when prompt returns empty string', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '') as any;
      (autoCutContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 2,
        description: 'Auto cut: 2 breakpoint(s) detected and applied',
      });
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto cutting...');

      vi.advanceTimersByTime(50);

      expect(autoCutContigs).toHaveBeenCalledWith(undefined);
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Auto cut: 2 breakpoint(s) detected and applied');
    });

    it('should pass cutThreshold when a valid number is provided', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '0.15') as any;
      (autoCutContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 1,
        description: 'Auto cut: 1 breakpoint(s)',
      });
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto cutting...');

      vi.advanceTimersByTime(50);

      expect(autoCutContigs).toHaveBeenCalledWith({ cutThreshold: 0.15 });
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
    });

    it('should show toast for invalid threshold (NaN)', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => 'xyz') as any;
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should show toast for threshold of 0', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '0') as any;
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should show toast for threshold greater than 1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '2') as any;
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should show toast for negative threshold', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '-0.5') as any;
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Invalid threshold');
      expect(autoCutContigs).not.toHaveBeenCalled();
    });

    it('should accept threshold of exactly 1', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { contactMap: new Float32Array(100), contigs: [] },
        contigOrder: [],
        undoStack: [],
      });
      globalThis.prompt = vi.fn(() => '1') as any;
      (autoCutContigs as ReturnType<typeof vi.fn>).mockReturnValue({
        operationsPerformed: 0,
        description: 'No breakpoints detected',
      });
      const ctx = createMockCtx();

      runAutoCut(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Auto cutting...');
      vi.advanceTimersByTime(50);
      expect(autoCutContigs).toHaveBeenCalledWith({ cutThreshold: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // undoLastBatch
  // -------------------------------------------------------------------------
  describe('undoLastBatch', () => {
    it('should show toast when no matching batch operations in undo stack', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [],
      });
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autocut');

      expect(ctx.showToast).toHaveBeenCalledWith('No autocut operations to undo');
      expect(undoBatch).not.toHaveBeenCalled();
    });

    it('should show toast when undo stack has operations but none match prefix', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [
          { batchId: 'autosort-123', data: {} },
          { batchId: 'autosort-456', data: {} },
        ],
      });
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autocut');

      expect(ctx.showToast).toHaveBeenCalledWith('No autocut operations to undo');
      expect(undoBatch).not.toHaveBeenCalled();
    });

    it('should find the last matching batch and call undoBatch', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [
          { batchId: 'autocut-100', data: {} },
          { batchId: 'autosort-200', data: {} },
          { batchId: 'autocut-300', data: {} },
        ],
      });
      (undoBatch as ReturnType<typeof vi.fn>).mockReturnValue(3);
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autocut');

      // Should find the LAST (most recent in reversed stack) matching batch
      expect(undoBatch).toHaveBeenCalledWith('autocut-300');
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Undid 3 autocut operation(s)');
    });

    it('should work with autosort prefix', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [
          { batchId: 'autosort-999', data: {} },
        ],
      });
      (undoBatch as ReturnType<typeof vi.fn>).mockReturnValue(5);
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autosort');

      expect(undoBatch).toHaveBeenCalledWith('autosort-999');
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Undid 5 autosort operation(s)');
    });

    it('should handle operations with undefined batchId', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [
          { batchId: undefined, data: {} },
          { batchId: undefined, data: {} },
        ],
      });
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autocut');

      expect(ctx.showToast).toHaveBeenCalledWith('No autocut operations to undo');
      expect(undoBatch).not.toHaveBeenCalled();
    });

    it('should handle mixed undefined and matching batchIds', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: null,
        contigOrder: [],
        undoStack: [
          { batchId: 'autocut-50', data: {} },
          { batchId: undefined, data: {} },
          { data: {} },
        ],
      });
      (undoBatch as ReturnType<typeof vi.fn>).mockReturnValue(1);
      const ctx = createMockCtx();

      undoLastBatch(ctx, 'autocut');

      expect(undoBatch).toHaveBeenCalledWith('autocut-50');
      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('Undid 1 autocut operation(s)');
    });
  });
});
