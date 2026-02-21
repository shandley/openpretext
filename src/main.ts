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
import { TutorialManager } from './ui/TutorialManager';
import { setupTutorialOverlay } from './ui/TutorialOverlay';
import { setupAssessmentPanel } from './ui/AssessmentPanel';
import { setupPatternGallery } from './ui/PatternGallery';

import type { AppContext } from './ui/AppContext';
import {
  showToast,
  setupShortcutsModal,
  updateSidebarContigList,
  updateSidebarScaffoldList,
  setupContigSearch,
  updateStatsPanel,
  updateTrackConfigPanel,
  updateUndoHistoryPanel,
  setMode,
  setupMouseTracking,
  setupDragReorder,
  setupClickInteractions,
  setupFastaUpload,
  setupTrackUpload,
  setupFileDrop,
  setupFileInput,
  startRenderLoop,
  onCameraChange,
  setupScriptConsole,
  setupAIAssist,
  setupCommandPalette,
  setupKeyboardShortcuts,
  setupToolbar,
  boot,
  setupEventListeners,
  refreshAfterCuration,
  setupSpecimenPicker,
  setupAnalysisPanel,
} from './ui';

class OpenPretextApp {
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
      comparisonInvertedSnapshot: null,
      comparisonVisible: false,
      tutorialManager: null,
      progressReference: null,
      previousProgress: null,

      // Cross-module callbacks
      showToast,
      refreshAfterCuration: () => refreshAfterCuration(ctx),
      updateSidebarContigList: () => updateSidebarContigList(ctx),
      updateSidebarScaffoldList: () => updateSidebarScaffoldList(ctx),
      updateStatsPanel: () => updateStatsPanel(ctx),
      updateTrackConfigPanel: () => updateTrackConfigPanel(ctx),
      updateUndoHistoryPanel: () => updateUndoHistoryPanel(ctx),
      setMode: (mode) => setMode(ctx, mode),
    };

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
    setupEventListeners(ctx);
    setupScriptConsole(ctx);
    setupAIAssist(ctx);
    setupShortcutsModal();
    setupContigSearch(ctx);
    setupTrackUpload(ctx);
    setupFastaUpload(ctx);
    startRenderLoop(ctx);
    setupSpecimenPicker(ctx);

    // Tutorial system
    const tutorialManager = new TutorialManager();
    ctx.tutorialManager = tutorialManager;
    setupTutorialOverlay(ctx, tutorialManager);
    setupAssessmentPanel(ctx, tutorialManager);
    setupPatternGallery();
    setupAnalysisPanel(ctx);

    console.log('OpenPretext initialized');
  }
}

// ─── Boot ─────────────────────────────────────────────────

boot(() => new OpenPretextApp());
