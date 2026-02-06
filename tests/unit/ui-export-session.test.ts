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
  },
}));

vi.mock('../../src/export/AGPWriter', () => ({
  downloadAGP: vi.fn(),
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
}));

vi.mock('../../src/ui/EventWiring', () => ({
  rebuildContigBoundaries: vi.fn(),
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
import { downloadAGP } from '../../src/export/AGPWriter';
import { downloadBED } from '../../src/export/BEDWriter';
import { downloadFASTA } from '../../src/export/FASTAWriter';
import { downloadSnapshot } from '../../src/export/SnapshotExporter';
import { exportSession, importSession, downloadSession } from '../../src/io/SessionManager';
import { parseFASTA } from '../../src/formats/FASTAParser';
import { parseBedGraph, bedGraphToTrack } from '../../src/formats/BedGraphParser';
import { syncColormapDropdown, syncGammaSlider } from '../../src/ui/ColorMapControls';
import { rebuildContigBoundaries } from '../../src/ui/EventWiring';
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
    text: vi.fn(async () => content),
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

      expect(downloadAGP).toHaveBeenCalledWith(fakeState);
      expect(ctx.showToast).toHaveBeenCalledWith('AGP exported');
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

    it('should call exportSession and downloadSession when map is loaded', () => {
      const fakeState = { map: { filename: 'test.pretext' }, contigOrder: [0] };
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeState);
      const sessionData = { version: 1, filename: 'test.pretext' };
      (exportSession as ReturnType<typeof vi.fn>).mockReturnValue(sessionData);
      const ctx = createMockCtx();

      saveSession(ctx);

      expect(exportSession).toHaveBeenCalledWith(fakeState, ctx.scaffoldManager, ctx.waypointManager);
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

    it('should show warning toast when filename does not match', async () => {
      const session = makeSessionData({ filename: 'other.pretext' });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          filename: 'current.pretext',
          contigs: [
            { inverted: false, scaffoldId: null },
            { inverted: false, scaffoldId: null },
          ],
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith(
        'Warning: session was for "other.pretext", current file is "current.pretext"'
      );
    });

    it('should skip filename warning when session filename is "demo"', async () => {
      const session = makeSessionData({ filename: 'demo' });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          filename: 'current.pretext',
          contigs: [
            { inverted: false, scaffoldId: null },
            { inverted: false, scaffoldId: null },
          ],
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      // Should NOT have the filename warning toast
      const toastCalls = (ctx.showToast as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
      expect(toastCalls).not.toContain(expect.stringContaining('Warning: session was for'));
    });

    it('should apply contig order from session', async () => {
      const session = makeSessionData({ contigOrder: [1, 0] });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          filename: 'test.pretext',
          contigs: [
            { inverted: false, scaffoldId: null },
            { inverted: false, scaffoldId: null },
          ],
        },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(state.update).toHaveBeenCalledWith({ contigOrder: [1, 0] });
    });

    it('should not update contig order when session has empty contigOrder', async () => {
      const session = makeSessionData({ contigOrder: [] });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: {
          filename: 'test.pretext',
          contigs: [],
        },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      // state.update for contigOrder should NOT have been called
      const updateCalls = (state.update as ReturnType<typeof vi.fn>).mock.calls;
      const contigOrderUpdates = updateCalls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).contigOrder !== undefined
      );
      expect(contigOrderUpdates).toHaveLength(0);
    });

    it('should apply contig states (inversions, scaffolds)', async () => {
      const session = makeSessionData({
        contigStates: {
          '0': { inverted: true, scaffoldId: 2 },
          '1': { inverted: false, scaffoldId: null },
        },
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      const contigs = [
        { inverted: false, scaffoldId: null },
        { inverted: false, scaffoldId: null },
      ];
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs },
        contigOrder: [0, 1],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(contigs[0].inverted).toBe(true);
      expect(contigs[0].scaffoldId).toBe(2);
      expect(contigs[1].inverted).toBe(false);
      expect(contigs[1].scaffoldId).toBeNull();
    });

    it('should skip contig state overrides for out-of-range indices', async () => {
      const session = makeSessionData({
        contigStates: {
          '99': { inverted: true, scaffoldId: 1 },
        },
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      const contigs = [{ inverted: false, scaffoldId: null }];
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs },
        contigOrder: [0],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      // Contig 0 should remain unchanged since 99 is out of range
      expect(contigs[0].inverted).toBe(false);
    });

    it('should restore scaffolds by calling createScaffold for new ones', async () => {
      const session = makeSessionData({
        scaffolds: [
          { id: 1, name: 'scaffold_1', color: '#ff0000' },
          { id: 2, name: 'scaffold_2', color: '#00ff00' },
        ],
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      // getScaffold returns null meaning scaffold doesn't exist yet
      (ctx.scaffoldManager.getScaffold as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.scaffoldManager.createScaffold).toHaveBeenCalledWith('scaffold_1');
      expect(ctx.scaffoldManager.createScaffold).toHaveBeenCalledWith('scaffold_2');
    });

    it('should not create scaffold if it already exists', async () => {
      const session = makeSessionData({
        scaffolds: [{ id: 1, name: 'scaffold_1', color: '#ff0000' }],
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      // getScaffold returns an existing scaffold
      (ctx.scaffoldManager.getScaffold as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 1,
        name: 'scaffold_1',
        color: '#ff0000',
      });
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.scaffoldManager.createScaffold).not.toHaveBeenCalled();
    });

    it('should animate camera to session camera position', async () => {
      const session = makeSessionData({
        camera: { x: 100, y: 200, zoom: 3 },
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 100, y: 200, zoom: 3 }, 300);
    });

    it('should restore settings via state.update and renderer', async () => {
      const session = makeSessionData({
        settings: { colorMapName: 'viridis', gamma: 2.0, showGrid: false },
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(state.update).toHaveBeenCalledWith({
        gamma: 2.0,
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
      const session = makeSessionData({ waypoints });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.waypointManager.clearAll).toHaveBeenCalled();
      expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(10, 20, 'W1');
      expect(ctx.waypointManager.addWaypoint).toHaveBeenCalledWith(30, 40, 'W2');
    });

    it('should call rebuildContigBoundaries and update sidebars', async () => {
      const session = makeSessionData();
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(rebuildContigBoundaries).toHaveBeenCalledWith(ctx);
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateSidebarScaffoldList).toHaveBeenCalled();
    });

    it('should show success toast with operation count', async () => {
      const session = makeSessionData({
        operationLog: [
          { type: 'invert', timestamp: 100, description: 'op1' },
          { type: 'cut', timestamp: 200, description: 'op2' },
        ],
      });
      (importSession as ReturnType<typeof vi.fn>).mockReturnValue(session);
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({
        map: { filename: 'test.pretext', contigs: [] },
        contigOrder: [],
      });
      const ctx = createMockCtx();
      const file = fakeFile('session.json', JSON.stringify(session));

      await loadSession(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('Session restored (2 operations)');
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
    it('should parse FASTA text, store sequences on ctx, and show success toast', async () => {
      const records = [
        { name: 'chr1', description: '', sequence: 'ATCG' },
        { name: 'chr2', description: '', sequence: 'GCTA' },
      ];
      (parseFASTA as ReturnType<typeof vi.fn>).mockReturnValue(records);
      const ctx = createMockCtx();
      const file = fakeFile('ref.fasta', '>chr1\nATCG\n>chr2\nGCTA');

      await loadReferenceFasta(ctx, file);

      expect(parseFASTA).toHaveBeenCalledWith('>chr1\nATCG\n>chr2\nGCTA');
      expect(ctx.referenceSequences).toBeInstanceOf(Map);
      expect(ctx.referenceSequences!.get('chr1')).toBe('ATCG');
      expect(ctx.referenceSequences!.get('chr2')).toBe('GCTA');
      expect(ctx.showToast).toHaveBeenCalledWith('Loaded 2 reference sequences');
    });

    it('should catch parse errors and show failure toast with message', async () => {
      (parseFASTA as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid FASTA format');
      });
      const ctx = createMockCtx();
      const file = fakeFile('bad.fasta', 'garbage');

      await loadReferenceFasta(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('FASTA load failed: Invalid FASTA format');
    });

    it('should show generic error for non-Error throws', async () => {
      (parseFASTA as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 42;
      });
      const ctx = createMockCtx();
      const file = fakeFile('bad.fasta', 'garbage');

      await loadReferenceFasta(ctx, file);

      expect(ctx.showToast).toHaveBeenCalledWith('FASTA load failed: Unknown error');
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
      (parseFASTA as ReturnType<typeof vi.fn>).mockReturnValue(records);
      const ctx = createMockCtx();

      setupFastaUpload(ctx);

      // Extract and call the change handler
      const changeHandler = (mockInput.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await changeHandler();

      expect(parseFASTA).toHaveBeenCalled();
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
