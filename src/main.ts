/**
 * OpenPretext — Main Entry Point
 *
 * Modern web-based Hi-C contact map viewer for genome assembly curation.
 * This file is a pure orchestrator: it creates instances, builds AppContext,
 * wires callbacks, and boots. All behavior lives in src/ui/ modules.
 */

import { WebGLRenderer } from './renderer/WebGLRenderer';
import { Camera } from './renderer/Camera';
import { LabelRenderer } from './renderer/LabelRenderer';
import { Minimap } from './renderer/Minimap';
import { TrackRenderer } from './renderer/TrackRenderer';
import { ScaffoldOverlay } from './renderer/ScaffoldOverlay';
import { WaypointOverlay } from './renderer/WaypointOverlay';
import { DragReorder } from './curation/DragReorder';
import { ScaffoldManager } from './curation/ScaffoldManager';
import { WaypointManager } from './curation/WaypointManager';
import { CurationEngine } from './curation/CurationEngine';
import { MetricsTracker } from './curation/QualityMetrics';
import { contigExclusion } from './curation/ContigExclusion';
import { events } from './core/EventBus';
import { state } from './core/State';

import type { AppContext } from './ui/AppContext';
import { showToast } from './ui/ToastNotifications';
import { setupShortcutsModal } from './ui/ShortcutsModal';
import { formatBp, updateSidebarContigList, updateSidebarScaffoldList, setupContigSearch } from './ui/Sidebar';
import { updateStatsPanel } from './ui/StatsPanel';
import { updateTrackConfigPanel } from './ui/TrackConfig';
import { setMode } from './ui/ModeManager';
import { setupMouseTracking, setupDragReorder } from './ui/MouseTracking';
import { setupClickInteractions } from './ui/ClickInteractions';
import { setupFastaUpload, setupTrackUpload } from './ui/ExportSession';
import { setupFileDrop, setupFileInput } from './ui/FileLoading';
import { startRenderLoop, onCameraChange } from './ui/RenderLoop';
import { setupScriptConsole } from './ui/ScriptConsole';
import { setupCommandPalette } from './ui/CommandPalette';
import { setupKeyboardShortcuts } from './ui/KeyboardShortcuts';
import { setupToolbar } from './ui/Toolbar';

class OpenPretextApp {
  private ctx!: AppContext;

  constructor() {
    this.init();
  }

  private init(): void {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas not found');

    const renderer = new WebGLRenderer(canvas);

    const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
    const labelRenderer = labelCanvas ? new LabelRenderer(labelCanvas) : null!;

    const trackCanvas = document.getElementById('track-canvas') as HTMLCanvasElement;
    const trackRenderer = trackCanvas ? new TrackRenderer(trackCanvas) : null!;

    const scaffoldCanvas = document.getElementById('scaffold-canvas') as HTMLCanvasElement;
    const scaffoldOverlay = scaffoldCanvas ? new ScaffoldOverlay(scaffoldCanvas) : null!;

    const waypointCanvas = document.getElementById('waypoint-canvas') as HTMLCanvasElement;
    const waypointOverlay = waypointCanvas ? new WaypointOverlay(waypointCanvas) : null!;

    const scaffoldManager = new ScaffoldManager();
    const waypointManager = new WaypointManager();
    CurationEngine.setScaffoldManager(scaffoldManager);

    const container = document.getElementById('canvas-container')!;
    const minimap = new Minimap(container, { size: 160, margin: 12, position: 'bottom-right' });

    // Build AppContext — mutable shared state object passed to all UI modules
    const ctx: AppContext = {
      renderer,
      labelRenderer,
      trackRenderer,
      scaffoldOverlay,
      waypointOverlay,
      minimap,
      camera: null!, // set below after Camera is created
      dragReorder: new DragReorder(),
      scaffoldManager,
      waypointManager,
      metricsTracker: new MetricsTracker(),
      tileManager: null,
      cancelTileDecode: null,
      contigBoundaries: [],
      hoveredContigIndex: -1,
      mouseMapPos: { x: 0, y: 0 },
      currentMode: 'navigate',
      currentColorMap: 'red-white',
      tracksVisible: false,
      currentWaypointId: null,
      animFrameId: 0,
      referenceSequences: null,
      comparisonSnapshot: null,
      comparisonVisible: false,

      // Cross-module callbacks
      showToast,
      refreshAfterCuration: () => this.refreshAfterCuration(),
      updateSidebarContigList: () => updateSidebarContigList(ctx),
      updateSidebarScaffoldList: () => updateSidebarScaffoldList(ctx),
      updateStatsPanel: () => updateStatsPanel(ctx),
      updateTrackConfigPanel: () => updateTrackConfigPanel(ctx),
      rebuildContigBoundaries: () => this.rebuildContigBoundaries(),
      setMode: (mode) => setMode(ctx, mode),
      formatBp,
    };

    this.ctx = ctx;

    minimap.setNavigateCallback((mapX, mapY) => {
      ctx.camera.animateTo({ x: mapX, y: mapY }, 200);
    });

    ctx.camera = new Camera(canvas, (cam) => onCameraChange(ctx, cam));

    // Setup all UI modules
    setupDragReorder(ctx, canvas);
    setupToolbar(ctx);
    setupKeyboardShortcuts(ctx);
    setupFileDrop(ctx);
    setupFileInput(ctx);
    setupCommandPalette(ctx);
    setupMouseTracking(ctx, canvas);
    setupClickInteractions(ctx, canvas);
    this.setupEventListeners();
    setupScriptConsole(ctx);
    setupShortcutsModal();
    setupContigSearch(ctx);
    setupTrackUpload(ctx);
    setupFastaUpload(ctx);
    startRenderLoop(ctx);

    console.log('OpenPretext initialized');
  }

  // ─── Event Listeners ─────────────────────────────────────

  private setupEventListeners(): void {
    const ctx = this.ctx;

    events.on('file:loaded', () => {
      ctx.updateSidebarContigList();
      // Take initial metrics snapshot
      const s = state.get();
      if (s.map) {
        ctx.metricsTracker.clear();
        ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, 0);
        // Store initial order for comparison mode
        ctx.comparisonSnapshot = [...s.contigOrder];
        ctx.comparisonVisible = false;
        contigExclusion.clearAll();
      }
      ctx.updateStatsPanel();
    });

    events.on('curation:cut', () => this.refreshAfterCuration());
    events.on('curation:join', () => this.refreshAfterCuration());
    events.on('curation:invert', () => this.refreshAfterCuration());
    events.on('curation:move', () => this.refreshAfterCuration());
    events.on('curation:undo', () => this.refreshAfterCuration());
    events.on('curation:redo', () => this.refreshAfterCuration());
  }

  private refreshAfterCuration(): void {
    const ctx = this.ctx;
    this.rebuildContigBoundaries();
    ctx.updateSidebarContigList();
    const s = state.get();
    document.getElementById('status-contigs')!.textContent = `${s.contigOrder.length} contigs`;
    // Snapshot quality metrics
    if (s.map) {
      ctx.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
    }
    ctx.updateStatsPanel();
  }

  private rebuildContigBoundaries(): void {
    const ctx = this.ctx;
    const s = state.get();
    if (!s.map) return;

    const totalPixels = s.map.textureSize;
    let accumulated = 0;
    ctx.contigBoundaries = [];

    for (const contigId of s.contigOrder) {
      const contig = s.map.contigs[contigId];
      accumulated += (contig.pixelEnd - contig.pixelStart);
      ctx.contigBoundaries.push(accumulated / totalPixels);
    }
  }
}

// ─── Boot ─────────────────────────────────────────────────

// Global error handler — show user-friendly messages instead of silent failures
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error);
  const toast = document.getElementById('toast-container');
  if (toast) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = `Error: ${e.message || 'An unexpected error occurred'}`;
    toast.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4000);
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  const toast = document.getElementById('toast-container');
  if (toast) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = `Error: ${e.reason?.message || 'An unexpected error occurred'}`;
    toast.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4000);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  new OpenPretextApp();
});
