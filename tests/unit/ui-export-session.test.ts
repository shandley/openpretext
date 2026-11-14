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
    update: vi.fn(),
    updateContigs: vi.fn(),
    clearHistory: vi.fn(),
  },
}));

vi.mock('../../src/export/AGPWriter', () => ({
  downloadAGP: vi.fn(),
  agpExportWarnings: vi.fn(() => []),
  AGPExportBlocked: class AGPExportBlocked extends Error {
    constructor(public readonly problems: string[]) { super(problems.join(' ')); }
  },
}));

vi.mock('../../src/export/BEDWriter', () => ({
  downloadBED: vi.fn(),
}));

vi.mock('../../src/export/FASTAWriter', () => ({
  downloadFASTA: vi.fn(),
}));

vi.mock('../../src/export/SnapshotExporter', () => ({
  downloadSnapshot: vi.fn(),
}));

vi.mock('../../src/io/SessionManager', () => ({
  exportSession: vi.fn(() => ({ version: 1 })),
  importSession: vi.fn(),
  downloadSession: vi.fn(),
}));

vi.mock('../../src/formats/FASTAParser', () => ({
  parseFASTA: vi.fn(() => []),
  parseFASTAStream: vi.fn(async () => []),
}));

vi.mock('../../src/ui/LoadingOverlay', () => ({
  showLoading: vi.fn(),
  updateLoading: vi.fn(),
  hideLoading: vi.fn(),
}));

vi.mock('../../src/formats/BedGraphParser', () => ({
  parseBedGraph: vi.fn(() => ({ entries: [], trackName: null, chroms: [] })),
  bedGraphToTrack: vi.fn(() => ({
    name: 'TestTrack',
    type: 'line',
    data: new Float32Array(0),
    color: 'rgb(100,200,255)',
    height: 40,
    visible: true,
  })),
}));

vi.mock('../../src/ui/ColorMapControls', () => ({
  syncColormapDropdown: vi.fn(),
  syncGammaSlider: vi.fn(),
  syncFloorSlider: vi.fn(),
  syncCeilSlider: vi.fn(),
  syncOverviewModeSelect: vi.fn(),
}));

vi.mock('../../src/ui/EventWiring', () => ({
  rebuildContigBoundaries: vi.fn(),
  applyOverviewMode: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test and mocked dependencies
// ---------------------------------------------------------------------------

import {
  exportAGP,
  takeScreenshot,
  saveSession,
  loadSession,
  exportBEDFile,
  exportFASTAFile,
  loadReferenceFasta,
  setupFastaUpload,
  setupTrackUpload,
  loadBedGraphTrack,
} from '../../src/ui/ExportSession';

import { state } from '../../src/core/State';
import { downloadAGP, agpExportWarnings, AGPExportBlocked } from '../../src/export/AGPWriter';
import { downloadBED } from '../../src/export/BEDWriter';
import { downloadFASTA } from '../../src/export/FASTAWriter';
import { downloadSnapshot } from '../../src/export/SnapshotExporter';
import { exportSession, importSession, downloadSession } from '../../src/io/SessionManager';
import { parseFASTA, parseFASTAStream } from '../../src/formats/FASTAParser';
import { showLoading, updateLoading, hideLoading } from '../../src/ui/LoadingOverlay';
import { parseBedGraph, bedGraphToTrack } from '../../src/formats/BedGraphParser';
import { syncColormapDropdown, syncGammaSlider } from '../../src/ui/ColorMapControls';
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
    renderer: { setColorMap: vi.fn() } as any,
    labelRenderer: {} as any,
    trackRenderer: { addTrack: vi.fn() } as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: { animateTo: vi.fn() } as any,
    dragReorder: {} as any,
    scaffoldManager: {
      getScaffold: vi.fn(() => null),
      createScaffold: vi.fn(),
      restoreScaffolds: vi.fn(),
      getAllScaffolds: vi.fn(() => []),
    } as any,
    waypointManager: {
      clearAll: vi.fn(),
      addWaypoint: vi.fn(),
      getAllWaypoints: vi.fn(() => []),
    } as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a fake File with given text content
// ---------------------------------------------------------------------------

function fakeFile(name: string, content: string): File {
  return {
    name,
    size: new TextEncoder().encode(content).byteLength,
    text: vi.fn(async () => content),
    arrayBuffer: vi.fn(async () => new TextEncoder().encode(content).buffer),
    stream: vi.fn(() => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    })),
  } as unknown as File;
}

// ---------------------------------------------------------------------------
// Mock document.getElementById
// ---------------------------------------------------------------------------

const mockGetElementById = vi.fn();

// Provide a minimal global document stub for Node environment
vi.stubGlobal('document', {
  getElementById: mockGetElementById,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExportSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state.get to default (no map)
    (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
      map: null,
      contigOrder: [],
    });
  });

  // =========================================================================
  // exportAGP
  // =========================================================================
  describe('exportAGP', () => {
    it('should show toast and return early when no map is loaded', () => {
      const ctx = createMockCtx();
      exportAGP(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No data to export');
      expect(downloadAGP).not.toHaveBeenCalled();
    });

    it('should call downloadAGP and show success toast when map is loaded', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const ctx = createMockCtx();

      exportAGP(ctx);

      expect(downloadAGP).toHaveBeenCalledWith(fakeState, undefined, { flavor: 'pretextview' });
      expect(ctx.showToast).toHaveBeenCalledWith('AGP exported');
    });

    it('should export and then show what the curator should check', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (agpExportWarnings as ReturnType<typeof vi.fn>).mockReturnValueOnce(['Haplotype order: look here.']);
      const ctx = createMockCtx();

      exportAGP(ctx);

      expect(downloadAGP).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith('AGP exported. Check before using it: Haplotype order: look here.', 30_000);
    });

    it('should not check haplotype order for the standard file, which carries no tags', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (agpExportWarnings as ReturnType<typeof vi.fn>).mockClear();
      const ctx = createMockCtx();

      exportAGP(ctx, 'standard');

      expect(agpExportWarnings).not.toHaveBeenCalled();
    });

    it('should export the nine-column file when asked for the standard flavour', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const ctx = createMockCtx();

      exportAGP(ctx, 'standard');

      expect(downloadAGP).toHaveBeenCalledWith(fakeState, undefined, { flavor: 'standard' });
      expect(ctx.showToast).toHaveBeenCalledWith('Standard AGP exported (9 columns, no tags)');
    });

    it('should say what has to change when the curation cannot be written yet', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (downloadAGP as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new AGPExportBlocked(['1 excluded contig has no tag saying why it is removed: "ctg7".']);
      });
      const ctx = createMockCtx();

      exportAGP(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith(
        'AGP not exported. 1 excluded contig has no tag saying why it is removed: "ctg7".', 20_000);
    });

    it('should catch errors from downloadAGP and show failure toast', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (downloadAGP as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('AGP write failure');
      });
      const ctx = createMockCtx();

      exportAGP(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Export failed');
    });
  });

  // =========================================================================
  // takeScreenshot
  // =========================================================================
  describe('takeScreenshot', () => {
    it('should return early if canvas element is not found', () => {
      mockGetElementById.mockReturnValue(null);
      const ctx = createMockCtx();

      takeScreenshot(ctx);

      expect(downloadSnapshot).not.toHaveBeenCalled();
      expect(ctx.showToast).not.toHaveBeenCalled();
    });

    it('should call downloadSnapshot with canvas and show success toast', () => {
      const fakeCanvas = { id: 'map-canvas' };
      mockGetElementById.mockReturnValue(fakeCanvas);
      const ctx = createMockCtx();

      takeScreenshot(ctx);

      expect(mockGetElementById).toHaveBeenCalledWith('map-canvas');
      expect(downloadSnapshot).toHaveBeenCalledWith(fakeCanvas, { includeOverlays: true });
      expect(ctx.showToast).toHaveBeenCalledWith('Screenshot saved');
    });

    it('should catch errors from downloadSnapshot and show failure toast', () => {
      const fakeCanvas = { id: 'map-canvas' };
      mockGetElementById.mockReturnValue(fakeCanvas);
      (downloadSnapshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Snapshot failure');
      });
      const ctx = createMockCtx();

      takeScreenshot(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Screenshot failed');
    });
  });

  // =========================================================================
  // saveSession
  // =========================================================================
  describe('saveSession', () => {
    it('should show toast and return early when no map is loaded', () => {
      const ctx = createMockCtx();
      saveSession(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No data to save');
      expect(exportSession).not.toHaveBeenCalled();
      expect(downloadSession).not.toHaveBeenCalled();
    });

    it('should call exportSession (with the current tags and exclusions) and downloadSession', async () => {
      const { metaTags } = await import('../../src/curation/MetaTagManager');
      const { contigExclusion } = await import('../../src/curation/ContigExclusion');
      metaTags.clearAll();
      contigExclusion.clearAll();
      metaTags.addTag(0, 'Haplotig');
      contigExclusion.toggle(0);
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const sessionData = { version: 1, filename: 'test.pretext' };
      (exportSession as ReturnType<typeof vi.fn>).mockReturnValue(sessionData);
      const ctx = createMockCtx();

      saveSession(ctx);
      metaTags.clearAll();
      contigExclusion.clearAll();

      expect(exportSession).toHaveBeenCalledWith(fakeState, ctx.scaffoldManager, ctx.waypointManager, {
        tags: new Map([[0, { tags: ['Haplotig'] }]]),
        excluded: new Set([0]),
      });
      expect(downloadSession).toHaveBeenCalledWith(sessionData);
      expect(ctx.showToast).toHaveBeenCalledWith('Session saved');
    });

    it('should catch errors and show failure toast', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (exportSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Session export failure');
      });
      const ctx = createMockCtx();

      saveSession(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Save failed');
    });
  });

  // =========================================================================
  // loadSession
  // =========================================================================
  describe('loadSession', () => {
    const makeSessionData = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      filename: 'test.pretext',
      timestamp: Date.now(),
      contigOrder: [1, 0],
      contigStates: {
        '0': { inverted: true, scaffoldId: null },
        '1': { inverted: false, scaffoldId: 1 },
      },
      scaffolds: [{ id: 1, name: 'scaffold_1', color: '#ff0000' }],
      waypoints: [{ id: 1, mapX: 100, mapY: 200, label: 'WP1', color: '#00ff00' }],
      camera: { x: 50, y: 50, zoom: 2 },
      settings: { colorMapName: 'blue-green', gamma: 1.5, showGrid: true },
      operationLog: [{ type: 'invert', timestamp: 1000, description: 'Inverted contig 0' }],
      ...overrides,
    });

    it('should show toast when no map is loaded', async () => {
      const session = makeSessionData();
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Load a .pretext file first, then restore the session');
    });

    /** A loaded two-contig map the default session fits. */
    const loadedState = (filename = 'test.pretext') => ({
      map: {
        filename,
        textureSize: 20,
        fileContigCount: 2,
        contigs: [
          { name: 'c1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 8, inverted: false, scaffoldId: null },
          { name: 'c2', originalIndex: 1, length: 1500, pixelStart: 8, pixelEnd: 20, inverted: false, scaffoldId: null },
        ],
      },
      contigOrder: [0, 1],
    });

    async function restore(overrides: Record<string, unknown> = {}, filename = 'test.pretext') {
      const session = makeSessionData(overrides);
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(loadedState(filename));
      const ctx = createMockCtx();
      await loadSession(ctx, fakeFile('session.json', JSON.stringify(session)));
      return ctx;
    }

    it('notes a filename mismatch without refusing the session', async () => {
      const ctx = await restore({ filename: 'other.pretext' }, 'current.pretext');

      expect(ctx.showToast).toHaveBeenCalledWith(
        'Note: session was saved from "other.pretext", current file is "current.pretext"'
      );
      expect(state.clearHistory).toHaveBeenCalled();
    });

    it('should skip the filename note when session filename is "demo"', async () => {
      const ctx = await restore({ filename: 'demo' }, 'current.pretext');

      const toasts = (ctx.showToast as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => String(c[0]));
      expect(toasts.some((t) => t.startsWith('Note: session was saved from'))).toBe(false);
    });

    it('installs the session order, orientation and scaffold assignment in one update', async () => {
      await restore();

      const call = (state.update as ReturnType<typeof vi.fn>).mock.calls
        .map((c: unknown[]) => c[0] as Record<string, any>)
        .find((u) => u.contigOrder !== undefined)!;
      expect(call.contigOrder).toEqual([1, 0]);
      expect(call.map.contigs.map((c: any) => [c.name, c.inverted, c.scaffoldId])).toEqual([
        ['c1', true, null],
        ['c2', false, 1],
      ]);
      expect(state.updateContigs).not.toHaveBeenCalled();
    });

    it('drops history and restores scaffolds with their saved ids', async () => {
      const scaffolds = [
        { id: 1, name: 'scaffold_1', color: '#ff0000' },
        { id: 4, name: 'scaffold_4', color: '#00ff00' },
      ];
      const ctx = await restore({ scaffolds });

      expect(state.clearHistory).toHaveBeenCalled();
      expect(ctx.scaffoldManager.restoreScaffolds).toHaveBeenCalledWith(scaffolds);
      expect(ctx.scaffoldManager.createScaffold).not.toHaveBeenCalled();
    });

    it('refuses a session that does not fit the loaded assembly and changes nothing', async () => {
      const ctx = await restore({ contigOrder: [0, 1, 5] });

      expect(ctx.showToast).toHaveBeenCalledWith(
        expect.stringContaining('This session cannot be restored'), 8000,
      );
      expect(state.update).not.toHaveBeenCalled();
      expect(state.clearHistory).not.toHaveBeenCalled();
      expect(ctx.scaffoldManager.restoreScaffolds).not.toHaveBeenCalled();
      expect(ctx.waypointManager.clearAll).not.toHaveBeenCalled();
      expect(ctx.camera.animateTo).not.toHaveBeenCalled();
      expect(hideLoading).toHaveBeenCalled();
    });

    it('shows, updates, and hides the loading overlay during restore', async () => {
      await restore();

      expect(showLoading).toHaveBeenCalled();
      expect(updateLoading).toHaveBeenCalled();
      expect(hideLoading).toHaveBeenCalled();
    });

    it('hides the loading overlay even when restore fails', async () => {
      (importSession as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('bad json');
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', '{bad');

      await loadSession(ctx, file);

      expect(hideLoading).toHaveBeenCalled();
      expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('Load failed'));
    });

    it('should animate camera to session camera position', async () => {
      const ctx = await restore({ camera: { x: 100, y: 200, zoom: 3 } });

      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 100, y: 200, zoom: 3 }, 300);
    });

    it('should restore settings via state.update and renderer', async () => {
      const ctx = await restore({
        settings: { colorMapName: 'viridis', gamma: 2.0, showGrid: false },
      });

      expect(state.update).toHaveBeenCalledWith({
        gamma: 2.0,
        signalFloor: 0,
        signalCeil: 1,
        overviewMode: 'faithful', // a session without the field gets the default
        showGrid: false,
        colorMapName: 'viridis',
      });
      expect(ctx.currentColorMap).toBe('viridis');
      expect(ctx.renderer.setColorMap).toHaveBeenCalledWith('viridis');
      expect(syncColormapDropdown).toHaveBeenCalledWith('viridis');
      expect(syncGammaSlider).toHaveBeenCalledWith(2.0);
    });

    it('should restore waypoints', async () => {
      const waypoints = [
        { id: 1, mapX: 10, mapY: 20, label: 'W1', color: '#fff' },
        { id: 2, mapX: 30, mapY: 40, label: 'W2', color: '#000' },
      ];
      const ctx = await restore({ waypoints });

      expect(ctx.waypointManager.clearAll).toHaveBeenCalled();
      expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(10, 20, 'W1');
      expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(30, 40, 'W2');
    });

    it('refreshes everything that follows the layout', async () => {
      const ctx = await restore();

      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.updateSidebarScaffoldList).toHaveBeenCalled();
    });

    it('puts tags and exclusions back on their contigs, replacing what was there', async () => {
      const { metaTags } = await import('../../src/curation/MetaTagManager');
      const { contigExclusion } = await import('../../src/curation/ContigExclusion');
      metaTags.clearAll();
      contigExclusion.clearAll();
      metaTags.addTag(1, 'Unloc');   // from before the restore
      contigExclusion.toggle(1);

      const ctx = await restore({
        contigTags: { '0': { tags: ['Haplotig', 'Hap_1'], notes: 'dup of c2' } },
        excludedContigs: [0],
      });

      expect([...metaTags.getAllTags()]).toEqual([[0, { tags: ['Haplotig', 'Hap_1'], notes: 'dup of c2' }]]);
      expect([...contigExclusion.getExcluded()]).toEqual([0]);
      expect(ctx.showToast).toHaveBeenCalledWith('Session restored (2 contigs, 1 scaffolds, 1 tagged, 1 excluded)');
      metaTags.clearAll();
      contigExclusion.clearAll();
    });

    it('should show a success toast with what was restored', async () => {
      const ctx = await restore();

      expect(ctx.showToast).toHaveBeenCalledWith('Session restored (2 contigs, 1 scaffolds)');
    });

    it('should catch errors and show failure toast with error message', async () => {
      (importSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Bad JSON');
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', 'invalid-json');

      await loadSession(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Load failed: Bad JSON');
    });

    it('should show generic failure toast for non-Error throws', async () => {
      (importSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 'string error';
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', 'anything');

      await loadSession(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Load failed: Unknown error');
    });
  });

  // =========================================================================
  // exportBEDFile
  // =========================================================================
  describe('exportBEDFile', () => {
    it('should show toast and return early when no map is loaded', () => {
      const ctx = createMockCtx();
      exportBEDFile(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No data to export');
      expect(downloadBED).not.toHaveBeenCalled();
    });

    it('should call downloadBED and show success toast', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const ctx = createMockCtx();

      exportBEDFile(ctx);

      expect(downloadBED).toHaveBeenCalledWith(fakeState);
      expect(ctx.showToast).toHaveBeenCalledWith('BED exported');
    });

    it('should catch errors from downloadBED and show failure toast', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (downloadBED as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('BED write failure');
      });
      const ctx = createMockCtx();

      exportBEDFile(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('BED export failed');
    });
  });

  // =========================================================================
  // exportFASTAFile
  // =========================================================================
  describe('exportFASTAFile', () => {
    it('should show toast and return early when no map is loaded', () => {
      const ctx = createMockCtx();
      exportFASTAFile(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('No data to export');
      expect(downloadFASTA).not.toHaveBeenCalled();
    });

    it('should show toast when no reference sequences are loaded', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const ctx = createMockCtx({ referenceSequences: null });

      exportFASTAFile(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('Load a reference FASTA first');
      expect(downloadFASTA).not.toHaveBeenCalled();
    });

    it('should call downloadFASTA with state and reference sequences on success', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const refSeqs = new Map([['chr1', 'ATCG']]);
      const ctx = createMockCtx({ referenceSequences: refSeqs });

      exportFASTAFile(ctx);

      expect(downloadFASTA).toHaveBeenCalledWith(fakeState, refSeqs);
      expect(ctx.showToast).toHaveBeenCalledWith('FASTA exported');
    });

    it('should catch errors from downloadFASTA and show failure toast', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const refSeqs = new Map([['chr1', 'ATCG']]);
      const ctx = createMockCtx({ referenceSequences: refSeqs });
      (downloadFASTA as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('FASTA write failure');
      });

      exportFASTAFile(ctx);

      expect(ctx.showToast).toHaveBeenCalledWith('FASTA export failed');
    });
  });

  // =========================================================================
  // loadReferenceFasta
  // =========================================================================
  describe('loadReferenceFasta', () => {
    it('should stream-parse a plain FASTA file, store sequences, and show success toast', async () => {
      const records = [
        { name: 'chr1', description: '', sequence: 'ATCG' },
        { name: 'chr2', description: '', sequence: 'GCTA' },
      ];
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockResolvedValue(records);
      const ctx = createMockCtx();
      const file = fakeFile('ref.fasta', '>chr1\nATCG\n>chr2\nGCTA');

      await loadReferenceFasta(ctx, file);

      expect(parseFASTAStream).toHaveBeenCalled();
      expect(ctx.referenceSequences).toBeInstanceOf(Map);
      expect(ctx.referenceSequences!.get('chr1')).toBe('ATCG');
      expect(ctx.referenceSequences!.get('chr2')).toBe('GCTA');
      expect(ctx.showToast).toHaveBeenCalledWith('Loaded 2 reference sequences');
    });

    it('should warn when no sequences are found in the file', async () => {
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const ctx = createMockCtx();
      const file = fakeFile('empty.fasta', '');

      await loadReferenceFasta(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith(
        'No sequences found in empty.fasta — is this a valid FASTA file?',
      );
      expect(ctx.referenceSequences).toBeNull();
    });

    it('should reject oversized gzip files with a helpful message', async () => {
      const ctx = createMockCtx();
      const bigGzipFile = { name: 'genome.fa.gz', size: 600 * 1024 * 1024 } as unknown as File;

      await loadReferenceFasta(ctx, bigGzipFile);

      expect(ctx.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Gzip FASTA files larger than 500 MB'),
      );
    });

    it('should catch parse errors and show failure toast with message', async () => {
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stream error'));
      const ctx = createMockCtx();
      const file = fakeFile('bad.fasta', 'garbage');

      await loadReferenceFasta(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('FASTA load failed: stream error');
    });

    it('should show generic error for non-Error throws', async () => {
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockRejectedValue(42);
      const ctx = createMockCtx();
      const file = fakeFile('bad.fasta', 'garbage');

      await loadReferenceFasta(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('FASTA load failed: Unknown error');
    });

    it('should show and hide the loading overlay', async () => {
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const ctx = createMockCtx();
      const file = fakeFile('ref.fasta', '');

      await loadReferenceFasta(ctx, file);

      expect(showLoading).toHaveBeenCalledWith('Loading FASTA', 'Reading file...');
      expect(hideLoading).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // setupFastaUpload
  // =========================================================================
  describe('setupFastaUpload', () => {
    it('should return early if fasta-file-input element is not found', () => {
      mockGetElementById.mockReturnValue(null);
      const ctx = createMockCtx();

      setupFastaUpload(ctx);

      expect(mockGetElementById).toHaveBeenCalledWith('fasta-file-input');
    });

    it('should wire up a change event listener on the input element', () => {
      const mockInput = {
        addEventListener: vi.fn(),
        files: [],
        value: '',
      };
      mockGetElementById.mockReturnValue(mockInput);
      const ctx = createMockCtx();

      setupFastaUpload(ctx);

      expect(mockInput.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should call loadReferenceFasta when file is selected', async () => {
      const fakeFileObj = fakeFile('ref.fasta', '>chr1\nATCG');
      const mockInput: Record<string, unknown> = {
        addEventListener: vi.fn(),
        files: [fakeFileObj],
        value: 'some/path',
      };
      mockGetElementById.mockReturnValue(mockInput);

      const records = [{ name: 'chr1', description: '', sequence: 'ATCG' }];
      (parseFASTAStream as ReturnType<typeof vi.fn>).mockResolvedValue(records);
      const ctx = createMockCtx();

      setupFastaUpload(ctx);

      // Extract and call the change handler
      const changeHandler = (mockInput.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await changeHandler();

      expect(parseFASTAStream).toHaveBeenCalled();
      expect(mockInput.value).toBe('');
    });

    it('should reset input value even when no file is selected', async () => {
      const mockInput: Record<string, unknown> = {
        addEventListener: vi.fn(),
        files: [] as File[],
        value: 'some/path',
      };
      mockGetElementById.mockReturnValue(mockInput);
      const ctx = createMockCtx();

      setupFastaUpload(ctx);

      const changeHandler = (mockInput.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await changeHandler();

      expect(mockInput.value).toBe('');
    });
  });

  // =========================================================================
  // setupTrackUpload
  // =========================================================================
  describe('setupTrackUpload', () => {
    it('should return early if track-file-input element is not found', () => {
      mockGetElementById.mockReturnValue(null);
      const ctx = createMockCtx();

      setupTrackUpload(ctx);

      expect(mockGetElementById).toHaveBeenCalledWith('track-file-input');
    });

    it('should wire up a change event listener on the input element', () => {
      const mockInput = {
        addEventListener: vi.fn(),
        files: [],
        value: '',
      };
      mockGetElementById.mockReturnValue(mockInput);
      const ctx = createMockCtx();

      setupTrackUpload(ctx);

      expect(mockInput.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should call loadBedGraphTrack when file is selected', async () => {
      const fakeFileObj = fakeFile('track.bedgraph', 'chr1\t0\t100\t1.5');
      const mockInput: Record<string, unknown> = {
        addEventListener: vi.fn(),
        files: [fakeFileObj],
        value: 'some/path',
      };
      mockGetElementById.mockReturnValue(mockInput);

      // Make sure loadBedGraphTrack has the state it needs
      const fakeState = {
        map: {
          filename: 'test.pretext',
          contigs: [{ name: 'chr1', pixelStart: 0, pixelEnd: 100, length: 1000 }],
          textureSize: 100,
        },
        contigOrder: [0],
      };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const ctx = createMockCtx();

      setupTrackUpload(ctx);

      const changeHandler = (mockInput.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await changeHandler();

      expect(parseBedGraph).toHaveBeenCalled();
      expect(mockInput.value).toBe('');
    });

    it('should reset input value even when no file is selected', async () => {
      const mockInput: Record<string, unknown> = {
        addEventListener: vi.fn(),
        files: [] as File[],
        value: 'some/path',
      };
      mockGetElementById.mockReturnValue(mockInput);
      const ctx = createMockCtx();

      setupTrackUpload(ctx);

      const changeHandler = (mockInput.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await changeHandler();

      expect(mockInput.value).toBe('');
    });
  });

  // =========================================================================
  // loadBedGraphTrack
  // =========================================================================
  describe('loadBedGraphTrack', () => {
    it('should show toast and return early when no map is loaded', async () => {
      const ctx = createMockCtx();
      const file = fakeFile('track.bedgraph', 'chr1\t0\t100\t1.5');

      await loadBedGraphTrack(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Load a map file first');
      expect(parseBedGraph).not.toHaveBeenCalled();
    });

    it('should parse bedgraph, create track, and add to renderer', async () => {
      const contigs = [{ name: 'chr1', pixelStart: 0, pixelEnd: 100, length: 1000 }];
      const fakeState = {
        map: { filename: 'test.pretext', contigs, textureSize: 100 },
        contigOrder: [0],
      };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);

      const parseResult = {
        entries: [{ chrom: 'chr1', start: 0, end: 100, value: 1.5 }],
        trackName: 'MyTrack',
        chroms: ['chr1'],
      };
      (parseBedGraph as ReturnType<typeof vi.fn>).mockReturnValue(parseResult);

      const track = {
        name: 'MyTrack',
        type: 'line' as const,
        data: new Float32Array(100),
        color: 'rgb(100,200,255)',
        height: 40,
        visible: true,
      };
      (bedGraphToTrack as ReturnType<typeof vi.fn>).mockReturnValue(track);

      const ctx = createMockCtx();
      const file = fakeFile('track.bedgraph', 'chr1\t0\t100\t1.5');

      await loadBedGraphTrack(ctx, file);

      expect(parseBedGraph).toHaveBeenCalledWith('chr1\t0\t100\t1.5');
      expect(bedGraphToTrack).toHaveBeenCalledWith(
        parseResult,
        contigs,
        [0],
        100,
        { name: 'MyTrack' },
      );
      expect(ctx.trackRenderer.addTrack).toHaveBeenCalledWith(track);
      expect(ctx.tracksVisible).toBe(true);
      expect(ctx.showToast).toHaveBeenCalledWith('Track loaded: MyTrack');
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });

    it('should use file.name as track name when trackName is null', async () => {
      const contigs = [{ name: 'chr1', pixelStart: 0, pixelEnd: 100, length: 1000 }];
      const fakeState = {
        map: { filename: 'test.pretext', contigs, textureSize: 100 },
        contigOrder: [0],
      };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);

      const parseResult = {
        entries: [],
        trackName: null,
        chroms: [],
      };
      (parseBedGraph as ReturnType<typeof vi.fn>).mockReturnValue(parseResult);

      const ctx = createMockCtx();
      const file = fakeFile('mydata.bedgraph', '');

      await loadBedGraphTrack(ctx, file);

      expect(bedGraphToTrack).toHaveBeenCalledWith(
        parseResult,
        contigs,
        [0],
        100,
        { name: 'mydata.bedgraph' },
      );
    });

    it('should catch errors and show failure toast with error message', async () => {
      const fakeState = {
        map: { filename: 'test.pretext', contigs: [], textureSize: 100 },
        contigOrder: [],
      };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (parseBedGraph as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid bedgraph');
      });
      const ctx = createMockCtx();
      const file = fakeFile('bad.bedgraph', 'garbage');

      await loadBedGraphTrack(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Track load failed: Invalid bedgraph');
    });

    it('should show generic error for non-Error throws', async () => {
      const fakeState = {
        map: { filename: 'test.pretext', contigs: [], textureSize: 100 },
        contigOrder: [],
      };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      (parseBedGraph as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw null;
      });
      const ctx = createMockCtx();
      const file = fakeFile('bad.bedgraph', 'garbage');

      await loadBedGraphTrack(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Track load failed: Unknown error');
    });
  });
});
