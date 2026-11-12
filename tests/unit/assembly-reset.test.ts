/**
 * resetForNewAssembly: nothing held about one assembly may survive into the
 * next. Uses the real state, engine and curation singletons; only the
 * DOM-bound panels are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ui/AnalysisPanel', () => ({
  clearAnalysisTracks: vi.fn(),
  clearEnhancedMap: vi.fn(),
  updateFastaHint: vi.fn(),
}));
vi.mock('../../src/ui/OEMapToggle', () => ({ resetOEMap: vi.fn() }));
vi.mock('../../src/ui/CutReviewPanel', () => ({
  closeCutReview: vi.fn(),
  isCutReviewActive: vi.fn(() => false),
}));
vi.mock('../../src/ui/MacroRecorder', () => ({
  isMacroRecording: vi.fn(() => false),
  toggleMacroRecording: vi.fn(),
}));

import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { WaypointManager } from '../../src/curation/WaypointManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { metaTags } from '../../src/curation/MetaTagManager';
import { resetForNewAssembly } from '../../src/ui/AssemblyReset';
import { clearAnalysisTracks, clearEnhancedMap } from '../../src/ui/AnalysisPanel';
import { resetOEMap } from '../../src/ui/OEMapToggle';
import { closeCutReview, isCutReviewActive } from '../../src/ui/CutReviewPanel';
import { isMacroRecording, toggleMacroRecording } from '../../src/ui/MacroRecorder';
import type { AppContext } from '../../src/ui/AppContext';

function makeMap(n: number): MapData {
  const contigs: ContigInfo[] = Array.from({ length: n }, (_, i) => ({
    name: `c${i}`, originalIndex: i, length: 10_000,
    pixelStart: i * 10, pixelEnd: (i + 1) * 10, inverted: false, scaffoldId: null,
  }));
  return {
    filename: 'a.pretext', textureSize: n * 10, numMipMaps: 1, tileResolution: n * 10,
    tilesPerDimension: 1, contigs, fileContigCount: n, contactMap: null, rawTiles: null,
    parsedHeader: null, extensions: new Map(),
  };
}

function makeCtx() {
  const tileManager = { dispose: vi.fn() };
  const ctx = {
    scaffoldManager: new ScaffoldManager(),
    waypointManager: new WaypointManager(),
    metricsTracker: { clear: vi.fn() },
    trackRenderer: { clearTracks: vi.fn() },
    tileDecoder: { cancel: vi.fn() },
    tileManager,
    tileDecodeDebounce: setTimeout(() => {}, 100_000),
    faithfulOverviewOriginal: new Float32Array(4),
    currentWaypointId: 3,
    hoveredContigIndex: 2,
    flashHighlightUntil: 1e12,
    fastaTrackData: new Map([['gap', new Int32Array(1)]]),
    referenceSequences: new Map([['c0', 'ACGT']]),
    comparisonSnapshot: [0, 1],
    comparisonInvertedSnapshot: new Map([[0, false]]),
    comparisonVisible: true,
    progressReference: [0, 1],
    previousProgress: {},
    updateUndoHistoryPanel: vi.fn(),
    updateTrackConfigPanel: vi.fn(),
    showToast: vi.fn(),
  };
  return { ctx: ctx as unknown as AppContext, raw: ctx, tileManager };
}

describe('resetForNewAssembly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reset();
    contigExclusion.clearAll();
    metaTags.clearAll();
  });

  function dirty(ctx: AppContext): void {
    state.update({ map: makeMap(5), contigOrder: [0, 1, 2, 3, 4] });
    CurationEngine.setScaffoldManager(ctx.scaffoldManager);
    CurationEngine.cut(1, 4);
    CurationEngine.move(0, 3);
    CurationEngine.invert(2);
    const sc = ctx.scaffoldManager.createScaffold('chr1');
    ctx.scaffoldManager.paintContigs([0, 1], sc);
    ctx.scaffoldManager.setActiveScaffoldId(sc);
    CurationEngine.invert(0);
    CurationEngine.undo(); // leaves something on the redo stack
    state.update({ selectedContigs: new Set([1, 2]) });
    state.setBatchContext('left-open');
    contigExclusion.toggle(2);
    metaTags.setTag(1, 'haplotig');
    ctx.waypointManager.addWaypoint(0.2, 0.2, 'w');
  }

  it('clears history, selection and any open batch', () => {
    const { ctx } = makeCtx();
    dirty(ctx);
    expect(state.get().undoStack.length).toBeGreaterThan(0);
    expect(state.get().redoStack.length).toBeGreaterThan(0);

    resetForNewAssembly(ctx);

    expect(state.get().undoStack).toEqual([]);
    expect(state.get().redoStack).toEqual([]);
    expect(state.get().selectedContigs.size).toBe(0);
    expect(state.undoDroppedCount()).toBe(0);
    // An operation on the next assembly must not inherit the old batch id.
    state.update({ map: makeMap(3), contigOrder: [0, 1, 2] });
    CurationEngine.invert(0);
    expect(state.get().undoStack[0].batchId).toBeUndefined();
  });

  it('clears scaffolds, exclusions, tags and waypoints, and restarts scaffold ids', () => {
    const { ctx } = makeCtx();
    dirty(ctx);

    resetForNewAssembly(ctx);

    expect(ctx.scaffoldManager.getAllScaffolds()).toEqual([]);
    expect(ctx.scaffoldManager.getActiveScaffoldId()).toBeNull();
    expect(ctx.scaffoldManager.createScaffold(undefined, { record: false })).toBe(1);
    expect(contigExclusion.getExcludedCount()).toBe(0);
    expect(metaTags.getTagCount()).toBe(0);
    expect(ctx.waypointManager.getAllWaypoints()).toEqual([]);
    expect(ctx.currentWaypointId).toBeNull();
  });

  it('drops tiles, the cached finer overview, tracks and derived views', () => {
    const { ctx, raw, tileManager } = makeCtx();
    dirty(ctx);

    resetForNewAssembly(ctx);

    expect(tileManager.dispose).toHaveBeenCalled();
    expect(raw.tileDecoder.cancel).toHaveBeenCalled();
    expect(ctx.tileManager).toBeNull();
    expect(ctx.tileDecodeDebounce).toBeNull();
    expect(ctx.faithfulOverviewOriginal).toBeNull();
    expect(raw.trackRenderer.clearTracks).toHaveBeenCalled();
    expect(ctx.fastaTrackData).toBeNull();
    expect(clearAnalysisTracks).toHaveBeenCalledWith(ctx);
    expect(clearEnhancedMap).toHaveBeenCalled();
    expect(resetOEMap).toHaveBeenCalledWith(ctx);
    expect(raw.metricsTracker.clear).toHaveBeenCalled();
    expect(ctx.comparisonSnapshot).toBeNull();
    expect(ctx.comparisonInvertedSnapshot).toBeNull();
    expect(ctx.comparisonVisible).toBe(false);
    expect(ctx.progressReference).toBeNull();
    expect(ctx.previousProgress).toBeNull();
    expect(ctx.hoveredContigIndex).toBe(-1);
  });

  it('drops a FASTA that was loaded alongside the previous assembly', () => {
    const { ctx } = makeCtx();
    dirty(ctx);
    resetForNewAssembly(ctx);
    expect(ctx.referenceSequences).toBeNull();
  });

  it('keeps a FASTA loaded before any assembly, for the one about to load', () => {
    const { ctx } = makeCtx();
    expect(state.get().map).toBeNull();
    resetForNewAssembly(ctx);
    expect(ctx.referenceSequences?.get('c0')).toBe('ACGT');
  });

  it('ends a cut review and a macro recording that were under way', () => {
    const { ctx } = makeCtx();
    dirty(ctx);
    (isCutReviewActive as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    (isMacroRecording as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    resetForNewAssembly(ctx);

    expect(closeCutReview).toHaveBeenCalledWith(ctx);
    expect(toggleMacroRecording).toHaveBeenCalledWith(ctx);
  });
});
