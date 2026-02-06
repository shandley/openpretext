/**
 * OpenPretext — Main Entry Point
 *
 * Modern web-based Hi-C contact map viewer for genome assembly curation.
 */

import { WebGLRenderer } from './renderer/WebGLRenderer';
import { Camera, type CameraState } from './renderer/Camera';
import { LabelRenderer } from './renderer/LabelRenderer';
import { Minimap } from './renderer/Minimap';
import { type ColorMapName } from './renderer/ColorMaps';
import { generateSyntheticMap } from './formats/SyntheticData';
import { parsePretextFile, isPretextFile, tileLinearIndex, type PretextHeader } from './formats/PretextParser';
import { events } from './core/EventBus';
import { state, type InteractionMode } from './core/State';
import { TileManager, tileKeyToString, type TileKey } from './renderer/TileManager';
import { decodeTileBatch } from './renderer/TileDecoder';
import { CurationEngine } from './curation/CurationEngine';
import { SelectionManager } from './curation/SelectionManager';
import { DragReorder, renderDragIndicator } from './curation/DragReorder';
import { ScaffoldManager } from './curation/ScaffoldManager';
import { TrackRenderer } from './renderer/TrackRenderer';
import { ScaffoldOverlay } from './renderer/ScaffoldOverlay';
import { WaypointOverlay } from './renderer/WaypointOverlay';
import { WaypointManager } from './curation/WaypointManager';
import { generateDemoTracks } from './formats/SyntheticTracks';
import { downloadAGP } from './export/AGPWriter';
import { downloadBED } from './export/BEDWriter';
import { downloadFASTA } from './export/FASTAWriter';
import { parseFASTA, type FASTARecord } from './formats/FASTAParser';
import { parseBedGraph, bedGraphToTrack } from './formats/BedGraphParser';
import { downloadSnapshot } from './export/SnapshotExporter';
import { exportSession, importSession, downloadSession, type SessionData } from './io/SessionManager';
import { parseScript } from './scripting/ScriptParser';
import { executeScript, type ScriptContext, type ScriptResult } from './scripting/ScriptExecutor';
import { operationsToScript } from './scripting/ScriptReplay';
import { calculateMetrics, MetricsTracker, type AssemblyMetrics } from './curation/QualityMetrics';
import { contigExclusion } from './curation/ContigExclusion';
import { selectByPattern, selectBySize, batchCutBySize, batchJoinSelected, batchInvertSelected, sortByLength, autoSortContigs, autoCutContigs } from './curation/BatchOperations';
import { undoBatch } from './curation/CurationEngine';

class OpenPretextApp {
  private renderer!: WebGLRenderer;
  private labelRenderer!: LabelRenderer;
  private trackRenderer!: TrackRenderer;
  private scaffoldOverlay!: ScaffoldOverlay;
  private waypointOverlay!: WaypointOverlay;
  private minimap!: Minimap;
  private camera!: Camera;
  private dragReorder = new DragReorder();
  private scaffoldManager = new ScaffoldManager();
  private waypointManager = new WaypointManager();
  private currentWaypointId: number | null = null;
  private tracksVisible = false;
  private animFrameId: number = 0;
  private currentColorMap: ColorMapName = 'red-white';
  private contigBoundaries: number[] = [];
  private currentMode: InteractionMode = 'navigate';
  private hoveredContigIndex: number = -1;
  private mouseMapPos: { x: number; y: number } = { x: 0, y: 0 };

  // Tile streaming state
  private tileManager: TileManager | null = null;
  private cancelTileDecode: (() => void) | null = null;

  // Feature: quality metrics tracking
  private metricsTracker = new MetricsTracker();

  // Feature: reference sequences for FASTA export
  private referenceSequences: Map<string, string> | null = null;

  // Feature: comparison mode (stores original contig order snapshot)
  private comparisonSnapshot: number[] | null = null;
  private comparisonVisible = false;

  constructor() {
    this.init();
  }

  private init(): void {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas not found');

    this.renderer = new WebGLRenderer(canvas);

    const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
    if (labelCanvas) {
      this.labelRenderer = new LabelRenderer(labelCanvas);
    }

    const trackCanvas = document.getElementById('track-canvas') as HTMLCanvasElement;
    if (trackCanvas) {
      this.trackRenderer = new TrackRenderer(trackCanvas);
    }

    const scaffoldCanvas = document.getElementById('scaffold-canvas') as HTMLCanvasElement;
    if (scaffoldCanvas) {
      this.scaffoldOverlay = new ScaffoldOverlay(scaffoldCanvas);
    }

    const waypointCanvas = document.getElementById('waypoint-canvas') as HTMLCanvasElement;
    if (waypointCanvas) {
      this.waypointOverlay = new WaypointOverlay(waypointCanvas);
    }

    CurationEngine.setScaffoldManager(this.scaffoldManager);

    const container = document.getElementById('canvas-container')!;
    this.minimap = new Minimap(container, { size: 160, margin: 12, position: 'bottom-right' });
    this.minimap.setNavigateCallback((mapX, mapY) => {
      this.camera.animateTo({ x: mapX, y: mapY }, 200);
    });

    this.camera = new Camera(canvas, (cam) => this.onCameraChange(cam));

    this.setupDragReorder(canvas);
    this.setupToolbar();
    this.setupKeyboardShortcuts();
    this.setupFileDrop();
    this.setupFileInput();
    this.setupCommandPalette();
    this.setupMouseTracking(canvas);
    this.setupClickInteractions(canvas);
    this.setupEventListeners();
    this.setupScriptConsole();
    this.setupShortcutsModal();
    this.setupContigSearch();
    this.setupTrackUpload();
    this.setupFastaUpload();
    this.startRenderLoop();

    console.log('OpenPretext initialized');
  }

  // ─── Event Listeners ─────────────────────────────────────

  private setupEventListeners(): void {
    events.on('file:loaded', () => {
      this.updateSidebarContigList();
      // Take initial metrics snapshot
      const s = state.get();
      if (s.map) {
        this.metricsTracker.clear();
        this.metricsTracker.snapshot(s.map.contigs, s.contigOrder, 0);
        // Store initial order for comparison mode
        this.comparisonSnapshot = [...s.contigOrder];
        this.comparisonVisible = false;
        contigExclusion.clearAll();
      }
      this.updateStatsPanel();
    });

    events.on('curation:cut', () => this.refreshAfterCuration());
    events.on('curation:join', () => this.refreshAfterCuration());
    events.on('curation:invert', () => this.refreshAfterCuration());
    events.on('curation:move', () => this.refreshAfterCuration());
    events.on('curation:undo', () => this.refreshAfterCuration());
    events.on('curation:redo', () => this.refreshAfterCuration());
  }

  private refreshAfterCuration(): void {
    this.rebuildContigBoundaries();
    this.updateSidebarContigList();
    const s = state.get();
    document.getElementById('status-contigs')!.textContent = `${s.contigOrder.length} contigs`;
    // Snapshot quality metrics
    if (s.map) {
      this.metricsTracker.snapshot(s.map.contigs, s.contigOrder, s.undoStack.length);
    }
    this.updateStatsPanel();
  }

  private rebuildContigBoundaries(): void {
    const s = state.get();
    if (!s.map) return;

    const totalPixels = s.map.textureSize;
    let accumulated = 0;
    this.contigBoundaries = [];

    for (const contigId of s.contigOrder) {
      const contig = s.map.contigs[contigId];
      accumulated += (contig.pixelEnd - contig.pixelStart);
      this.contigBoundaries.push(accumulated / totalPixels);
    }
  }

  // ─── Drag Reorder ──────────────────────────────────────────

  private setupDragReorder(canvas: HTMLCanvasElement): void {
    this.dragReorder.setup({
      getContigAtPosition: (mapX: number) => {
        let prevBoundary = 0;
        for (let i = 0; i < this.contigBoundaries.length; i++) {
          if (mapX >= prevBoundary && mapX < this.contigBoundaries[i]) return i;
          prevBoundary = this.contigBoundaries[i];
        }
        return -1;
      },
      onDragUpdate: () => {
        canvas.style.cursor = 'grabbing';
      },
      onDragEnd: (moved: boolean) => {
        this.updateCursor(canvas);
        if (moved) {
          this.refreshAfterCuration();
          this.showToast('Contig moved');
        }
      },
    });
  }

  // ─── File Loading ─────────────────────────────────────────

  private async loadPretextFile(file: File): Promise<void> {
    const statusEl = document.getElementById('status-file')!;
    statusEl.textContent = `Loading ${file.name}...`;
    this.showLoading(`Loading ${file.name}`, 'Reading file...');

    try {
      this.updateLoading('Reading file into memory...', 10);
      const buffer = await file.arrayBuffer();

      if (isPretextFile(buffer)) {
        this.updateLoading('Parsing header and metadata...', 20);
        const parsed = await parsePretextFile(buffer, { coarsestOnly: true });
        const h = parsed.header;
        const mapSize = h.numberOfPixels1D;

        this.updateLoading('Assembling contact map...', 50);

        // For large maps (e.g. 32768x32768), assembling the full-resolution map
        // as a single Float32Array is infeasible (~4GB). Instead, use the coarsest
        // mipmap level from each tile to build a downsampled overview texture.
        const N = h.numberOfTextures1D;
        const coarsestMip = h.mipMapLevels - 1;
        const coarsestRes = h.textureResolution >> coarsestMip; // e.g. 1024 >> 5 = 32
        const overviewSize = N * coarsestRes; // e.g. 32 * 32 = 1024
        const contactMap = new Float32Array(overviewSize * overviewSize);
        const totalTiles = (N * (N + 1)) / 2;
        let tilesDone = 0;

        for (let tx = 0; tx < N; tx++) {
          for (let ty = tx; ty < N; ty++) {
            const linIdx = tileLinearIndex(tx, ty, N);
            const tileData = parsed.tilesDecoded[linIdx]?.[coarsestMip];
            if (!tileData) { tilesDone++; continue; }

            for (let py = 0; py < coarsestRes; py++) {
              for (let px = 0; px < coarsestRes; px++) {
                const val = tileData[py * coarsestRes + px];
                const gx = tx * coarsestRes + px;
                const gy = ty * coarsestRes + py;
                if (gx < overviewSize && gy < overviewSize) {
                  contactMap[gy * overviewSize + gx] = val;
                  contactMap[gx * overviewSize + gy] = val;
                }
              }
            }

            tilesDone++;
            if (tilesDone % Math.max(1, Math.floor(totalTiles / 20)) === 0) {
              this.updateLoading(
                `Assembling tiles... (${tilesDone}/${totalTiles})`,
                50 + Math.round((tilesDone / totalTiles) * 40),
              );
            }
          }
        }

        this.updateLoading('Uploading to GPU...', 92);
        this.renderer.uploadContactMap(contactMap, overviewSize);
        this.minimap.updateThumbnail(contactMap, overviewSize);
        // Map contig boundaries to normalized positions in the full map
        this.contigBoundaries = parsed.contigs.map(c => c.pixelEnd / mapSize);

        // Dispose previous tile manager and cancel in-flight decodes
        if (this.cancelTileDecode) { this.cancelTileDecode(); this.cancelTileDecode = null; }
        if (this.tileManager) { this.tileManager.dispose(); }
        this.tileManager = new TileManager(this.renderer.getGL());

        this.updateLoading('Finalizing...', 98);
        state.update({
          map: {
            filename: file.name,
            textureSize: mapSize,
            numMipMaps: h.mipMapLevels,
            tileResolution: h.textureResolution,
            tilesPerDimension: h.numberOfTextures1D,
            contigs: parsed.contigs.map((c, i) => ({
              name: c.name, originalIndex: i, length: c.length,
              pixelStart: c.pixelStart, pixelEnd: c.pixelEnd,
              inverted: false, scaffoldId: null,
            })),
            contactMap,
            rawTiles: parsed.tiles,
            parsedHeader: h,
            extensions: new Map(parsed.extensions.map(e => [e.name, e.data])),
          },
          contigOrder: parsed.contigs.map((_, i) => i),
        });
        statusEl.textContent = file.name;
        document.getElementById('status-contigs')!.textContent = `${parsed.contigs.length} contigs`;
        events.emit('file:loaded', { filename: file.name, contigs: parsed.contigs.length, textureSize: mapSize });
        this.showToast(`Loaded ${file.name} — ${parsed.contigs.length} contigs, ${mapSize}px`);
      } else {
        statusEl.textContent = 'Invalid file format';
        this.showToast('Invalid file — not a .pretext file');
      }
    } catch (err) {
      console.error('Error loading file:', err);
      statusEl.textContent = 'Error loading file';
      this.showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    this.hideLoading();
    document.getElementById('welcome')!.style.display = 'none';
  }

  private loadDemoData(): void {
    const { data, size, contigs } = generateSyntheticMap(1024, 12);
    this.renderer.uploadContactMap(data, size);
    this.contigBoundaries = contigs.map(c => c.end / size);

    // Clean up tile streaming state for demo data
    if (this.cancelTileDecode) { this.cancelTileDecode(); this.cancelTileDecode = null; }
    if (this.tileManager) { this.tileManager.dispose(); this.tileManager = null; }

    state.update({
      map: {
        filename: 'demo',
        textureSize: size,
        numMipMaps: 1,
        tileResolution: size,
        tilesPerDimension: 1,
        contigs: contigs.map((c, i) => ({
          name: c.name, originalIndex: i,
          length: (c.end - c.start) * 1000000,
          pixelStart: c.start, pixelEnd: c.end,
          inverted: false, scaffoldId: null,
        })),
        contactMap: data,
        rawTiles: null,
        parsedHeader: null,
        extensions: new Map(),
      },
      contigOrder: contigs.map((_, i) => i),
    });

    // Generate minimap thumbnail
    this.minimap.updateThumbnail(data, size);

    // Generate synthetic annotation tracks
    if (this.trackRenderer) {
      const boundaries = contigs.map(c => c.end);
      const demoTracks = generateDemoTracks(size, boundaries);
      for (const track of demoTracks) {
        this.trackRenderer.addTrack(track);
      }
    }

    document.getElementById('status-file')!.textContent = 'Demo data';
    document.getElementById('status-contigs')!.textContent = `${contigs.length} contigs`;
    document.getElementById('welcome')!.style.display = 'none';

    events.emit('file:loaded', { filename: 'demo', contigs: contigs.length, textureSize: size });
  }

  // ─── Mouse Tracking ──────────────────────────────────────

  private setupMouseTracking(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousemove', (e) => {
      const cam = this.camera.getState();
      this.mouseMapPos = this.renderer.canvasToMap(e.offsetX, e.offsetY, cam);

      // Handle drag reorder in edit mode
      if (this.currentMode === 'edit' && this.dragReorder.onMouseMove(e.clientX, e.clientY, this.mouseMapPos.x, this.contigBoundaries)) {
        return; // Dragging, skip normal hover
      }

      const mx = this.mouseMapPos.x;
      this.hoveredContigIndex = -1;
      const s = state.get();
      if (s.map && mx >= 0 && mx <= 1) {
        let prevBoundary = 0;
        for (let i = 0; i < this.contigBoundaries.length; i++) {
          if (mx >= prevBoundary && mx < this.contigBoundaries[i]) {
            this.hoveredContigIndex = i;
            break;
          }
          prevBoundary = this.contigBoundaries[i];
        }
      }

      const posEl = document.getElementById('status-position')!;
      if (s.map && this.hoveredContigIndex >= 0) {
        const contigId = s.contigOrder[this.hoveredContigIndex];
        const contig = s.map.contigs[contigId];
        posEl.textContent = contig ? contig.name : '\u2014';
      } else {
        posEl.textContent = '\u2014';
      }

      this.updateCursor(canvas);
      this.updateTooltip(e.clientX, e.clientY);
    });

    canvas.addEventListener('mouseleave', () => {
      this.hoveredContigIndex = -1;
      document.getElementById('status-position')!.textContent = '\u2014';
      this.hideTooltip();
    });
  }

  private updateCursor(canvas: HTMLCanvasElement): void {
    switch (this.currentMode) {
      case 'navigate':
        canvas.style.cursor = 'grab';
        break;
      case 'edit':
        canvas.style.cursor = this.hoveredContigIndex >= 0 ? 'pointer' : 'crosshair';
        break;
      case 'scaffold':
        canvas.style.cursor = 'cell';
        break;
      case 'waypoint':
        canvas.style.cursor = 'crosshair';
        break;
      default:
        canvas.style.cursor = 'default';
    }
  }

  // ─── Tooltip ─────────────────────────────────────────────

  private tooltipVisible = false;

  private updateTooltip(clientX: number, clientY: number): void {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip) return;

    const s = state.get();
    if (!s.map || this.hoveredContigIndex < 0) {
      this.hideTooltip();
      return;
    }

    const contigId = s.contigOrder[this.hoveredContigIndex];
    const contig = s.map.contigs[contigId];
    if (!contig) {
      this.hideTooltip();
      return;
    }

    // Build tooltip content
    const lengthStr = this.formatBp(contig.length);
    const pixelSpan = contig.pixelEnd - contig.pixelStart;
    const orderStr = `${this.hoveredContigIndex + 1} / ${s.contigOrder.length}`;
    const orientStr = contig.inverted ? 'Inverted' : 'Forward';
    const scaffoldInfo = contig.scaffoldId !== null
      ? this.scaffoldManager.getScaffold(contig.scaffoldId)
      : null;

    let html = `<div class="tooltip-name">${contig.name}</div>`;
    html += `<div class="tooltip-row"><span class="label">Length</span><span class="value">${lengthStr}</span></div>`;
    html += `<div class="tooltip-row"><span class="label">Pixels</span><span class="value">${pixelSpan} px</span></div>`;
    html += `<div class="tooltip-row"><span class="label">Order</span><span class="value">${orderStr}</span></div>`;
    html += `<div class="tooltip-row"><span class="label">Orient.</span><span class="value">${orientStr}</span></div>`;
    if (scaffoldInfo) {
      html += `<div class="tooltip-row"><span class="label">Scaffold</span><span class="value"><span class="tooltip-badge" style="background:${scaffoldInfo.color};color:#fff;">${scaffoldInfo.name}</span></span></div>`;
    }

    // Show position in map space
    const mx = this.mouseMapPos.x;
    const my = this.mouseMapPos.y;
    html += `<div class="tooltip-row" style="margin-top:4px;font-size:10px;opacity:0.6"><span>Map pos</span><span>${mx.toFixed(3)}, ${my.toFixed(3)}</span></div>`;

    tooltip.innerHTML = html;

    // Position tooltip near cursor (offset to avoid overlapping)
    const offsetX = 16;
    const offsetY = 16;
    let left = clientX + offsetX;
    let top = clientY + offsetY;

    // Keep within viewport
    const tooltipW = tooltip.offsetWidth || 200;
    const tooltipH = tooltip.offsetHeight || 100;
    if (left + tooltipW > window.innerWidth - 10) {
      left = clientX - tooltipW - 8;
    }
    if (top + tooltipH > window.innerHeight - 10) {
      top = clientY - tooltipH - 8;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('visible');
    this.tooltipVisible = true;
  }

  private hideTooltip(): void {
    if (!this.tooltipVisible) return;
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.classList.remove('visible');
    this.tooltipVisible = false;
  }

  // ─── Loading Progress ──────────────────────────────────

  private showLoading(title: string, detail: string = ''): void {
    const overlay = document.getElementById('loading-overlay');
    const titleEl = document.getElementById('loading-title');
    const detailEl = document.getElementById('loading-detail');
    const barEl = document.getElementById('loading-bar');
    const percentEl = document.getElementById('loading-percent');
    if (overlay) overlay.classList.add('visible');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
    if (barEl) barEl.style.width = '0%';
    if (percentEl) percentEl.textContent = '0%';
  }

  private updateLoading(detail: string, progress: number): void {
    const detailEl = document.getElementById('loading-detail');
    const barEl = document.getElementById('loading-bar');
    const percentEl = document.getElementById('loading-percent');
    const pct = Math.round(Math.min(100, Math.max(0, progress)));
    if (detailEl) detailEl.textContent = detail;
    if (barEl) barEl.style.width = `${pct}%`;
    if (percentEl) percentEl.textContent = `${pct}%`;
  }

  private hideLoading(): void {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // ─── Click Interactions ──────────────────────────────────

  private setupClickInteractions(canvas: HTMLCanvasElement): void {
    let mouseDownPos = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };

      // Try to initiate drag reorder in edit mode
      if (this.currentMode === 'edit' && this.hoveredContigIndex >= 0) {
        this.dragReorder.onMouseDown(e.clientX, e.clientY, this.hoveredContigIndex);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      // Handle drag end
      if (this.dragReorder.isActive()) {
        this.dragReorder.onMouseUp();
        return;
      }

      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > 5 || dy > 5) return;

      if (this.currentMode === 'edit' && this.hoveredContigIndex >= 0) {
        if (e.shiftKey) {
          SelectionManager.selectRange(this.hoveredContigIndex);
        } else if (e.metaKey || e.ctrlKey) {
          SelectionManager.selectToggle(this.hoveredContigIndex);
        } else {
          SelectionManager.selectSingle(this.hoveredContigIndex);
        }
        this.updateSidebarContigList();
        this.showToast(`Selected: ${this.getContigNameAt(this.hoveredContigIndex)}`);
      }

      // Scaffold painting mode
      if (this.currentMode === 'scaffold' && this.hoveredContigIndex >= 0) {
        if (e.shiftKey) {
          this.scaffoldManager.paintContigs([this.hoveredContigIndex], null);
          this.showToast(`Unpainted: ${this.getContigNameAt(this.hoveredContigIndex)}`);
        } else {
          const activeId = this.scaffoldManager.getActiveScaffoldId();
          if (activeId !== null) {
            this.scaffoldManager.paintContigs([this.hoveredContigIndex], activeId);
            const sc = this.scaffoldManager.getScaffold(activeId);
            this.showToast(`Painted: ${this.getContigNameAt(this.hoveredContigIndex)} → ${sc?.name ?? ''}`);
          } else {
            this.showToast('No active scaffold. Press N to create one.');
          }
        }
        this.updateSidebarContigList();
        this.updateSidebarScaffoldList();
      }

      // Waypoint mode: click to place waypoint, shift+click to remove nearest
      if (this.currentMode === 'waypoint') {
        const mapX = this.mouseMapPos.x;
        const mapY = this.mouseMapPos.y;
        if (mapX >= 0 && mapX <= 1 && mapY >= 0 && mapY <= 1) {
          if (e.shiftKey) {
            // Remove nearest waypoint
            const all = this.waypointManager.getAllWaypoints();
            if (all.length > 0) {
              let nearest = all[0];
              let minDist = Infinity;
              for (const wp of all) {
                const d = Math.hypot(wp.mapX - mapX, wp.mapY - mapY);
                if (d < minDist) { minDist = d; nearest = wp; }
              }
              this.waypointManager.removeWaypoint(nearest.id);
              if (this.currentWaypointId === nearest.id) this.currentWaypointId = null;
              this.showToast(`Removed waypoint: ${nearest.label}`);
            }
          } else {
            const wp = this.waypointManager.addWaypoint(mapX, mapY);
            this.currentWaypointId = wp.id;
            this.showToast(`Placed: ${wp.label}`);
          }
        }
      }
    });
  }

  private getContigNameAt(orderIndex: number): string {
    const s = state.get();
    if (!s.map || orderIndex < 0 || orderIndex >= s.contigOrder.length) return '';
    const contigId = s.contigOrder[orderIndex];
    return s.map.contigs[contigId]?.name ?? '';
  }

  // ─── Toast Notifications ─────────────────────────────────

  private showToast(message: string, duration: number = 2000): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── Sidebar ─────────────────────────────────────────────

  private updateSidebarContigList(): void {
    const listEl = document.getElementById('contig-list');
    if (!listEl) return;

    const s = state.get();
    if (!s.map) {
      listEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No data loaded</div>';
      return;
    }

    const searchInput = document.getElementById('contig-search') as HTMLInputElement;
    const filter = (searchInput?.value ?? '').toLowerCase().trim();

    const selected = s.selectedContigs;
    const html = s.contigOrder.map((contigId, orderIdx) => {
      const contig = s.map!.contigs[contigId];
      if (!contig) return '';
      if (filter && !contig.name.toLowerCase().includes(filter)) return '';
      const isSelected = selected.has(orderIdx);
      const lengthStr = this.formatBp(contig.length);
      const invertedBadge = contig.inverted ? '<span class="contig-badge inverted">INV</span>' : '';
      const excludedBadge = contigExclusion.isExcluded(orderIdx) ? '<span class="contig-badge excluded">EXC</span>' : '';
      const scaffoldBadge = contig.scaffoldId !== null
        ? `<span class="contig-badge scaffold">S${contig.scaffoldId}</span>`
        : '';

      return `<div class="contig-item ${isSelected ? 'selected' : ''}" data-order-index="${orderIdx}">
        <span class="contig-name">${contig.name}</span>
        <span class="contig-meta">${lengthStr} ${invertedBadge}${excludedBadge}${scaffoldBadge}</span>
      </div>`;
    }).join('');

    listEl.innerHTML = html;

    listEl.querySelectorAll('.contig-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        const idx = parseInt((el as HTMLElement).dataset.orderIndex ?? '-1', 10);
        if (idx < 0) return;

        if ((e as MouseEvent).shiftKey) {
          SelectionManager.selectRange(idx);
        } else if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
          SelectionManager.selectToggle(idx);
        } else {
          SelectionManager.selectSingle(idx);
        }
        this.updateSidebarContigList();
      });

      el.addEventListener('dblclick', () => {
        const idx = parseInt((el as HTMLElement).dataset.orderIndex ?? '-1', 10);
        if (idx < 0 || idx >= this.contigBoundaries.length) return;
        const start = idx === 0 ? 0 : this.contigBoundaries[idx - 1];
        const end = this.contigBoundaries[idx];
        this.camera.zoomToRegion(start, start, end, end);
      });
    });
  }

  private updateSidebarScaffoldList(): void {
    const listEl = document.getElementById('scaffold-list');
    if (!listEl) return;

    const scaffolds = this.scaffoldManager.getAllScaffolds();
    const activeId = this.scaffoldManager.getActiveScaffoldId();

    if (scaffolds.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No scaffolds. Press N in scaffold mode to create one.</div>';
      return;
    }

    const html = scaffolds.map(sc => {
      const isActive = sc.id === activeId;
      const count = this.scaffoldManager.getContigsInScaffold(sc.id).length;
      return `<div class="contig-item ${isActive ? 'selected' : ''}" data-scaffold-id="${sc.id}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${sc.color};margin-right:6px;flex-shrink:0;"></span>
        <span class="contig-name">${sc.name}</span>
        <span class="contig-meta">${count} contigs</span>
      </div>`;
    }).join('');

    listEl.innerHTML = html;

    listEl.querySelectorAll('.contig-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt((el as HTMLElement).dataset.scaffoldId ?? '-1', 10);
        if (id >= 0) {
          this.scaffoldManager.setActiveScaffoldId(id);
          this.updateSidebarScaffoldList();
          const sc = this.scaffoldManager.getScaffold(id);
          this.showToast(`Active scaffold: ${sc?.name ?? ''}`);
        }
      });
    });
  }

  private formatBp(bp: number): string {
    if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(1)} Gb`;
    if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`;
    if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
    return `${bp} bp`;
  }

  // ─── Rendering ────────────────────────────────────────────

  private startRenderLoop(): void {
    const renderFrame = () => {
      const cam = this.camera.getState();
      const s = state.get();

      // Highlight from hover or single selection
      let highlightStart: number | undefined;
      let highlightEnd: number | undefined;
      if (this.hoveredContigIndex >= 0 && this.hoveredContigIndex < this.contigBoundaries.length) {
        highlightStart = this.hoveredContigIndex === 0 ? 0 : this.contigBoundaries[this.hoveredContigIndex - 1];
        highlightEnd = this.contigBoundaries[this.hoveredContigIndex];
      } else if (s.selectedContigs.size === 1) {
        const selIdx = Array.from(s.selectedContigs)[0];
        if (selIdx >= 0 && selIdx < this.contigBoundaries.length) {
          highlightStart = selIdx === 0 ? 0 : this.contigBoundaries[selIdx - 1];
          highlightEnd = this.contigBoundaries[selIdx];
        }
      }

      this.renderer.render(cam, {
        gamma: s.gamma,
        showGrid: s.showGrid,
        gridOpacity: 0.6,
        contigBoundaries: this.contigBoundaries,
        highlightStart,
        highlightEnd,
      });

      // Render detail tiles on top of the overview
      if (this.tileManager && s.map?.parsedHeader && cam.zoom > 1.5) {
        const tilesPerDim = s.map.parsedHeader.numberOfTextures1D;
        for (const key of this.tileManager.visibleKeys) {
          const tile = this.tileManager.getTile(key);
          if (tile && tile.state === 'loaded' && tile.texture) {
            this.renderer.renderTile(tile.texture, key.col, key.row, tilesPerDim, cam, s.gamma);
          }
        }
      }

      const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
      const w = mapCanvas.clientWidth;
      const h = mapCanvas.clientHeight;

      if (this.labelRenderer && s.map) {
        const contigNames = s.contigOrder.map(id => s.map!.contigs[id]?.name ?? '');
        this.labelRenderer.render({
          contigBoundaries: this.contigBoundaries,
          contigNames,
          camera: cam,
          hoveredIndex: this.hoveredContigIndex,
          canvasWidth: w,
          canvasHeight: h,
        });

        // Draw drag indicator on the label canvas if dragging
        if (this.dragReorder.isActive()) {
          const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
          const ctx = labelCanvas.getContext('2d');
          if (ctx) {
            renderDragIndicator(ctx, this.dragReorder.getDragState(), this.contigBoundaries, cam, w, h);
          }
        }

        // Draw cut indicator in edit mode
        if (this.currentMode === 'edit' && this.hoveredContigIndex >= 0 && !this.dragReorder.isActive()) {
          const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
          const ctx = labelCanvas.getContext('2d');
          if (ctx) {
            this.renderCutIndicator(ctx, cam, w, h);
          }
        }

        // Draw comparison overlay
        if (this.comparisonVisible) {
          const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
          const ctx = labelCanvas.getContext('2d');
          if (ctx) {
            this.renderComparisonOverlay(ctx, cam, w, h);
          }
        }
      }

      // Scaffold overlay
      if (this.scaffoldOverlay && s.map) {
        const contigScaffoldIds = s.contigOrder.map(id => s.map!.contigs[id]?.scaffoldId ?? null);
        const scaffoldMap = new Map(
          this.scaffoldManager.getAllScaffolds().map(sc => [sc.id, sc])
        );
        this.scaffoldOverlay.render({
          contigBoundaries: this.contigBoundaries,
          contigScaffoldIds,
          scaffolds: scaffoldMap,
          camera: cam,
          canvasWidth: w,
          canvasHeight: h,
        });
      }

      // Track rendering
      if (this.trackRenderer && this.tracksVisible && s.map) {
        this.trackRenderer.render({
          camera: cam,
          canvasWidth: w,
          canvasHeight: h,
          textureSize: s.map.textureSize,
        });
      }

      // Waypoint overlay
      if (this.waypointOverlay) {
        this.waypointOverlay.render({
          camera: cam,
          canvasWidth: w,
          canvasHeight: h,
          waypoints: this.waypointManager.getAllWaypoints(),
          currentWaypointId: this.currentWaypointId,
        });
      }

      // Minimap
      this.minimap.render(cam);

      document.getElementById('status-zoom')!.textContent = `${Math.round(cam.zoom * 100)}%`;

      this.animFrameId = requestAnimationFrame(renderFrame);
    };
    this.startRenderLoop = () => { renderFrame(); };
    renderFrame();
  }

  private renderCutIndicator(ctx: CanvasRenderingContext2D, cam: CameraState, canvasWidth: number, canvasHeight: number): void {
    const mapX = this.mouseMapPos.x;
    // Convert map position to canvas pixel
    const canvasX = (mapX - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 220, 50, 0.8)';
    ctx.lineWidth = 1.5;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(canvasX, 0);
    ctx.lineTo(canvasX, canvasHeight);
    ctx.stroke();

    // Horizontal line
    const canvasY = (mapX - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(canvasWidth, canvasY);
    ctx.stroke();

    ctx.restore();
  }

  private onCameraChange(cam: CameraState): void {
    events.emit('camera:changed', cam);
    this.updateDetailTiles(cam);
  }

  /**
   * Check which detail tiles are needed for the current camera and
   * start decoding any missing ones.
   */
  private updateDetailTiles(cam: CameraState): void {
    const s = state.get();
    if (!s.map || !s.map.rawTiles || !s.map.parsedHeader || !this.tileManager) return;

    // Only load detail tiles when zoomed in past the overview
    if (cam.zoom <= 1.5) return;

    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const header = s.map.parsedHeader;
    const rawTiles = s.map.rawTiles;

    const visibleKeys = this.tileManager.updateVisibleTiles(
      cam,
      canvas.clientWidth,
      canvas.clientHeight,
      header.numberOfTextures1D,
      header.mipMapLevels,
    );

    // Find keys that need decoding
    const needDecode: TileKey[] = [];
    for (const key of visibleKeys) {
      if (!this.tileManager.hasTile(key)) {
        this.tileManager.markPending(key);
        needDecode.push(key);
      }
    }

    if (needDecode.length === 0) return;

    // Cancel any in-flight batch decode
    if (this.cancelTileDecode) {
      this.cancelTileDecode();
    }

    this.cancelTileDecode = decodeTileBatch(
      needDecode,
      rawTiles,
      header,
      (key, data) => {
        if (this.tileManager) {
          this.tileManager.loadTile(key, data);
        }
      },
      () => {
        this.cancelTileDecode = null;
      },
    );
  }

  // ─── Mode Management ──────────────────────────────────────

  private setMode(mode: InteractionMode): void {
    const previous = this.currentMode;
    this.currentMode = mode;
    state.update({ mode });

    // Block camera left-click panning in non-navigate modes
    this.camera.leftClickBlocked = mode !== 'navigate';

    if (previous === 'edit' && mode !== 'edit') {
      SelectionManager.clearSelection();
    }

    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });

    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (canvas) this.updateCursor(canvas);

    document.getElementById('status-mode')!.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    events.emit('mode:changed', { mode, previous });
  }

  // ─── Color Map ────────────────────────────────────────────

  private cycleColorMap(): void {
    const maps: ColorMapName[] = ['red-white', 'blue-white-red', 'viridis', 'hot', 'cool', 'grayscale'];
    const idx = maps.indexOf(this.currentColorMap);
    this.currentColorMap = maps[(idx + 1) % maps.length];
    this.renderer.setColorMap(this.currentColorMap);
    this.showToast(`Color map: ${this.currentColorMap}`);
    this.syncColormapDropdown(this.currentColorMap);
    events.emit('colormap:changed', { name: this.currentColorMap });
  }

  private syncGammaSlider(gamma: number): void {
    const slider = document.getElementById('gamma-slider') as HTMLInputElement;
    const label = document.getElementById('gamma-value');
    if (slider) slider.value = String(gamma);
    if (label) label.textContent = gamma.toFixed(2);
  }

  private syncColormapDropdown(name: ColorMapName): void {
    const select = document.getElementById('colormap-select') as HTMLSelectElement;
    if (select) select.value = name;
  }

  // ─── Curation Operations ────────────────────────────────

  private performUndo(): void {
    if (CurationEngine.undo()) {
      this.showToast('Undo');
    }
  }

  private performRedo(): void {
    if (CurationEngine.redo()) {
      this.showToast('Redo');
    }
  }

  private invertSelectedContigs(): void {
    const selected = SelectionManager.getSelectedIndices();
    if (selected.length === 0) {
      this.showToast('No contigs selected');
      return;
    }
    for (const idx of selected) {
      CurationEngine.invert(idx);
    }
    this.showToast(`Inverted ${selected.length} contig(s)`);
  }

  private cutAtCursorPosition(): void {
    if (this.currentMode !== 'edit') return;
    const s = state.get();
    if (!s.map || this.hoveredContigIndex < 0) {
      this.showToast('Hover over a contig to cut');
      return;
    }

    const prevBoundary = this.hoveredContigIndex === 0 ? 0 : this.contigBoundaries[this.hoveredContigIndex - 1];
    const curBoundary = this.contigBoundaries[this.hoveredContigIndex];
    const fraction = (this.mouseMapPos.x - prevBoundary) / (curBoundary - prevBoundary);

    const contigId = s.contigOrder[this.hoveredContigIndex];
    const contig = s.map.contigs[contigId];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;
    const pixelOffset = Math.round(fraction * contigPixelLength);

    if (pixelOffset <= 0 || pixelOffset >= contigPixelLength) {
      this.showToast('Cannot cut at edge of contig');
      return;
    }

    CurationEngine.cut(this.hoveredContigIndex, pixelOffset);
    SelectionManager.clearSelection();
    this.showToast(`Cut: ${contig.name} at offset ${pixelOffset}`);
  }

  private joinSelectedContigs(): void {
    if (this.currentMode !== 'edit') return;
    const selected = SelectionManager.getSelectedIndices();

    if (selected.length === 1) {
      const idx = selected[0];
      const s = state.get();
      if (idx >= s.contigOrder.length - 1) {
        this.showToast('No right neighbor to join with');
        return;
      }
      CurationEngine.join(idx);
      SelectionManager.clearSelection();
      this.showToast('Joined contigs');
    } else if (selected.length === 2) {
      const sorted = [...selected].sort((a, b) => a - b);
      if (sorted[1] - sorted[0] !== 1) {
        this.showToast('Selected contigs must be adjacent to join');
        return;
      }
      CurationEngine.join(sorted[0]);
      SelectionManager.clearSelection();
      this.showToast('Joined contigs');
    } else {
      this.showToast('Select 1 or 2 adjacent contigs to join');
    }
  }

  // ─── Export ──────────────────────────────────────────────

  private exportAGP(): void {
    const s = state.get();
    if (!s.map) {
      this.showToast('No data to export');
      return;
    }
    try {
      downloadAGP(s);
      this.showToast('AGP exported');
    } catch (err) {
      console.error('AGP export error:', err);
      this.showToast('Export failed');
    }
  }

  private takeScreenshot(): void {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    try {
      downloadSnapshot(canvas, { includeOverlays: true });
      this.showToast('Screenshot saved');
    } catch (err) {
      console.error('Screenshot error:', err);
      this.showToast('Screenshot failed');
    }
  }

  private saveSession(): void {
    const s = state.get();
    if (!s.map) {
      this.showToast('No data to save');
      return;
    }
    try {
      const sessionData = exportSession(s, this.scaffoldManager, this.waypointManager);
      downloadSession(sessionData);
      this.showToast('Session saved');
    } catch (err) {
      console.error('Session save error:', err);
      this.showToast('Save failed');
    }
  }

  private async loadSession(file: File): Promise<void> {
    try {
      const text = await file.text();
      const session = importSession(text);

      // Apply session state to the app
      const s = state.get();
      if (!s.map) {
        this.showToast('Load a .pretext file first, then restore the session');
        return;
      }

      // Verify filename match
      if (session.filename !== s.map.filename && session.filename !== 'demo') {
        this.showToast(`Warning: session was for "${session.filename}", current file is "${s.map.filename}"`);
      }

      // Apply contig order
      if (session.contigOrder.length > 0) {
        state.update({ contigOrder: session.contigOrder });
      }

      // Apply contig states (inversions, scaffolds)
      for (const [contigIdStr, override] of Object.entries(session.contigStates)) {
        const contigId = Number(contigIdStr);
        if (contigId >= 0 && contigId < s.map.contigs.length) {
          s.map.contigs[contigId].inverted = override.inverted;
          s.map.contigs[contigId].scaffoldId = override.scaffoldId;
        }
      }

      // Restore scaffolds
      for (const sc of session.scaffolds) {
        if (!this.scaffoldManager.getScaffold(sc.id)) {
          this.scaffoldManager.createScaffold(sc.name);
        }
      }

      // Restore camera
      this.camera.animateTo(session.camera, 300);

      // Restore settings
      state.update({
        gamma: session.settings.gamma,
        showGrid: session.settings.showGrid,
        colorMapName: session.settings.colorMapName,
      });
      this.currentColorMap = session.settings.colorMapName as any;
      this.renderer.setColorMap(this.currentColorMap);
      this.syncColormapDropdown(this.currentColorMap);
      this.syncGammaSlider(session.settings.gamma);

      // Restore waypoints
      this.waypointManager.clearAll();
      for (const wp of session.waypoints) {
        this.waypointManager.addWaypoint(wp.mapX, wp.mapY, wp.label);
      }

      this.rebuildContigBoundaries();
      this.updateSidebarContigList();
      this.updateSidebarScaffoldList();
      this.showToast(`Session restored (${session.operationLog.length} operations)`);
    } catch (err) {
      console.error('Session load error:', err);
      this.showToast(`Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ─── BED Export ──────────────────────────────────────────

  private exportBEDFile(): void {
    const s = state.get();
    if (!s.map) {
      this.showToast('No data to export');
      return;
    }
    try {
      downloadBED(s);
      this.showToast('BED exported');
    } catch (err) {
      console.error('BED export error:', err);
      this.showToast('BED export failed');
    }
  }

  // ─── FASTA Export ──────────────────────────────────────────

  private exportFASTAFile(): void {
    const s = state.get();
    if (!s.map) {
      this.showToast('No data to export');
      return;
    }
    if (!this.referenceSequences) {
      this.showToast('Load a reference FASTA first');
      return;
    }
    try {
      downloadFASTA(s, this.referenceSequences);
      this.showToast('FASTA exported');
    } catch (err) {
      console.error('FASTA export error:', err);
      this.showToast('FASTA export failed');
    }
  }

  private async loadReferenceFasta(file: File): Promise<void> {
    try {
      const text = await file.text();
      const records = parseFASTA(text);
      this.referenceSequences = new Map(records.map(r => [r.name, r.sequence]));
      this.showToast(`Loaded ${records.length} reference sequences`);
    } catch (err) {
      console.error('FASTA parse error:', err);
      this.showToast(`FASTA load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private setupFastaUpload(): void {
    const input = document.getElementById('fasta-file-input') as HTMLInputElement;
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await this.loadReferenceFasta(file);
      input.value = '';
    });
  }

  // ─── BedGraph Track Upload ────────────────────────────────

  private async loadBedGraphTrack(file: File): Promise<void> {
    const s = state.get();
    if (!s.map) {
      this.showToast('Load a map file first');
      return;
    }
    try {
      const text = await file.text();
      const result = parseBedGraph(text);
      const track = bedGraphToTrack(
        result,
        s.map.contigs,
        s.contigOrder,
        s.map.textureSize,
        { name: result.trackName ?? file.name },
      );
      this.trackRenderer.addTrack(track);
      this.tracksVisible = true;
      this.showToast(`Track loaded: ${track.name}`);
      this.updateTrackConfigPanel();
    } catch (err) {
      console.error('BedGraph parse error:', err);
      this.showToast(`Track load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private setupTrackUpload(): void {
    const input = document.getElementById('track-file-input') as HTMLInputElement;
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await this.loadBedGraphTrack(file);
      input.value = '';
    });
  }

  // ─── Contig Exclusion ──────────────────────────────────────

  private toggleContigExclusion(): void {
    if (this.currentMode !== 'edit') return;
    const selected = SelectionManager.getSelectedIndices();
    if (selected.length > 0) {
      for (const idx of selected) {
        contigExclusion.toggle(idx);
      }
      this.showToast(`Toggled exclusion on ${selected.length} contig(s)`);
    } else if (this.hoveredContigIndex >= 0) {
      const wasExcluded = contigExclusion.toggle(this.hoveredContigIndex);
      this.showToast(wasExcluded ? 'Contig excluded' : 'Contig included');
    } else {
      this.showToast('Hover or select contigs to exclude');
    }
    this.updateSidebarContigList();
    this.updateStatsPanel();
  }

  // ─── Batch Operations ──────────────────────────────────────

  private runBatchSelectByPattern(): void {
    const pattern = prompt('Enter name pattern (regex):');
    if (!pattern) return;
    try {
      const indices = selectByPattern(pattern);
      if (indices.length === 0) {
        this.showToast('No contigs match pattern');
        return;
      }
      for (const idx of indices) {
        SelectionManager.selectToggle(idx);
      }
      this.updateSidebarContigList();
      this.showToast(`Selected ${indices.length} contigs matching "${pattern}"`);
    } catch (err) {
      this.showToast(`Invalid pattern: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private runBatchSelectBySize(): void {
    const input = prompt('Enter size range in bp (min-max, e.g. 1000000-5000000):');
    if (!input) return;
    const parts = input.split('-').map(s => parseInt(s.trim(), 10));
    const min = parts[0] || undefined;
    const max = parts[1] || undefined;
    const indices = selectBySize(min, max);
    if (indices.length === 0) {
      this.showToast('No contigs in size range');
      return;
    }
    for (const idx of indices) {
      SelectionManager.selectToggle(idx);
    }
    this.updateSidebarContigList();
    this.showToast(`Selected ${indices.length} contigs in size range`);
  }

  private runBatchCut(): void {
    const input = prompt('Cut contigs larger than (bp):');
    if (!input) return;
    const minLength = parseInt(input.trim(), 10);
    if (isNaN(minLength) || minLength <= 0) {
      this.showToast('Invalid size');
      return;
    }
    const result = batchCutBySize(minLength);
    this.refreshAfterCuration();
    this.showToast(result.description);
  }

  private runBatchJoin(): void {
    const result = batchJoinSelected();
    if (result.operationsPerformed === 0) {
      this.showToast('Select adjacent contigs to batch join');
      return;
    }
    SelectionManager.clearSelection();
    this.refreshAfterCuration();
    this.showToast(result.description);
  }

  private runBatchInvert(): void {
    const result = batchInvertSelected();
    if (result.operationsPerformed === 0) {
      this.showToast('Select contigs to batch invert');
      return;
    }
    this.refreshAfterCuration();
    this.showToast(result.description);
  }

  private runSortByLength(): void {
    const result = sortByLength(true);
    this.refreshAfterCuration();
    this.showToast(result.description);
  }

  private runAutoSort(): void {
    const s = state.get();
    if (!s.map?.contactMap) {
      this.showToast('No contact map loaded');
      return;
    }
    const input = prompt('Link threshold (0.05-0.8, default 0.20):');
    if (input === null) return;
    const hardThreshold = input.trim() ? parseFloat(input) : undefined;
    if (hardThreshold !== undefined && (isNaN(hardThreshold) || hardThreshold <= 0 || hardThreshold > 1)) {
      this.showToast('Invalid threshold'); return;
    }
    this.showToast('Auto sorting...');
    setTimeout(() => {
      const result = autoSortContigs(hardThreshold !== undefined ? { hardThreshold } : undefined);
      this.refreshAfterCuration();
      this.showToast(result.description);
    }, 50);
  }

  private runAutoCut(): void {
    const s = state.get();
    if (!s.map?.contactMap) {
      this.showToast('No contact map loaded');
      return;
    }
    const input = prompt('Cut sensitivity (0.05-0.5, default 0.20):');
    if (input === null) return;
    const cutThreshold = input.trim() ? parseFloat(input) : undefined;
    if (cutThreshold !== undefined && (isNaN(cutThreshold) || cutThreshold <= 0 || cutThreshold > 1)) {
      this.showToast('Invalid threshold'); return;
    }
    this.showToast('Auto cutting...');
    setTimeout(() => {
      const result = autoCutContigs(cutThreshold !== undefined ? { cutThreshold } : undefined);
      this.refreshAfterCuration();
      this.showToast(result.description);
    }, 50);
  }

  private undoLastBatch(prefix: string): void {
    const s = state.get();
    const lastOp = [...s.undoStack].reverse().find(op => op.batchId?.startsWith(prefix));
    if (!lastOp?.batchId) {
      this.showToast(`No ${prefix} operations to undo`);
      return;
    }
    const count = undoBatch(lastOp.batchId);
    this.refreshAfterCuration();
    this.showToast(`Undid ${count} ${prefix} operation(s)`);
  }

  // ─── Stats Panel ──────────────────────────────────────────

  private updateStatsPanel(): void {
    const el = document.getElementById('stats-content');
    if (!el) return;

    const summary = this.metricsTracker.getSummary();
    if (!summary) {
      el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No data loaded</div>';
      return;
    }

    const m = summary.current;
    const excluded = contigExclusion.getExcludedCount();

    const fmtBp = (bp: number) => {
      if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(2)} Gb`;
      if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
      if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
      return `${bp} bp`;
    };

    const delta = (val: number) => {
      if (val === 0) return '';
      const sign = val > 0 ? '+' : '';
      return ` <span style="color:${val > 0 ? '#4caf50' : '#e94560'};font-size:10px;">(${sign}${val})</span>`;
    };

    let html = '';
    html += `<div class="stats-row"><span>Contigs</span><span>${m.contigCount}${delta(summary.contigCountDelta)}</span></div>`;
    if (excluded > 0) {
      html += `<div class="stats-row"><span>Excluded</span><span style="color:#f39c12;">${excluded}</span></div>`;
    }
    html += `<div class="stats-row"><span>Total length</span><span>${fmtBp(m.totalLength)}</span></div>`;
    html += `<div class="stats-row"><span>N50</span><span>${fmtBp(m.n50)}${delta(summary.n50Delta)}</span></div>`;
    html += `<div class="stats-row"><span>L50</span><span>${m.l50}</span></div>`;
    html += `<div class="stats-row"><span>N90</span><span>${fmtBp(m.n90)}</span></div>`;
    html += `<div class="stats-row"><span>L90</span><span>${m.l90}</span></div>`;
    html += `<div class="stats-row"><span>Longest</span><span>${fmtBp(m.longestContig)}</span></div>`;
    html += `<div class="stats-row"><span>Shortest</span><span>${fmtBp(m.shortestContig)}</span></div>`;
    html += `<div class="stats-row"><span>Median</span><span>${fmtBp(m.medianLength)}</span></div>`;
    html += `<div class="stats-row"><span>Scaffolds</span><span>${m.scaffoldCount}${delta(summary.scaffoldCountDelta)}</span></div>`;
    html += `<div class="stats-row"><span>Operations</span><span>${m.operationCount}</span></div>`;

    el.innerHTML = html;
  }

  // ─── Track Configuration ──────────────────────────────────

  private updateTrackConfigPanel(): void {
    const el = document.getElementById('track-config-list');
    if (!el) return;

    const tracks = this.trackRenderer.getTracks();
    if (tracks.length === 0) {
      el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No tracks loaded. Press X to toggle visibility.</div>';
      return;
    }

    const html = tracks.map((track, i) =>
      `<div class="track-config-item" data-track-index="${i}">
        <label class="track-config-toggle">
          <input type="checkbox" ${track.visible ? 'checked' : ''} data-track-name="${track.name}" class="track-vis-checkbox">
          <span class="track-config-name" style="border-left: 3px solid ${track.color}; padding-left: 6px;">${track.name}</span>
        </label>
        <div class="track-config-controls">
          <input type="color" value="${track.color}" data-track-name="${track.name}" class="track-color-input" title="Track color">
          <select data-track-name="${track.name}" class="track-type-select" title="Track type">
            <option value="line" ${track.type === 'line' ? 'selected' : ''}>Line</option>
            <option value="heatmap" ${track.type === 'heatmap' ? 'selected' : ''}>Heatmap</option>
            <option value="marker" ${track.type === 'marker' ? 'selected' : ''}>Marker</option>
          </select>
          <button class="track-remove-btn" data-track-name="${track.name}" title="Remove track">&times;</button>
        </div>
      </div>`
    ).join('');

    el.innerHTML = html;

    // Wire up event listeners
    el.querySelectorAll('.track-vis-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const name = (cb as HTMLInputElement).dataset.trackName!;
        this.trackRenderer.setTrackVisibility(name, (cb as HTMLInputElement).checked);
      });
    });

    el.querySelectorAll('.track-color-input').forEach((input) => {
      input.addEventListener('input', () => {
        const name = (input as HTMLInputElement).dataset.trackName!;
        const track = this.trackRenderer.getTrack(name);
        if (track) (track as any).color = (input as HTMLInputElement).value;
      });
    });

    el.querySelectorAll('.track-type-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const name = (sel as HTMLSelectElement).dataset.trackName!;
        const track = this.trackRenderer.getTrack(name);
        if (track) (track as any).type = (sel as HTMLSelectElement).value;
      });
    });

    el.querySelectorAll('.track-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = (btn as HTMLElement).dataset.trackName!;
        this.trackRenderer.removeTrack(name);
        this.updateTrackConfigPanel();
        this.showToast(`Removed track: ${name}`);
      });
    });
  }

  // ─── Comparison Mode ──────────────────────────────────────

  private toggleComparisonMode(): void {
    const s = state.get();
    if (!s.map) {
      this.showToast('No data loaded');
      return;
    }
    if (!this.comparisonSnapshot) {
      this.showToast('No comparison snapshot available');
      return;
    }
    this.comparisonVisible = !this.comparisonVisible;
    this.showToast(`Comparison: ${this.comparisonVisible ? 'ON' : 'OFF'}`);
  }

  private renderComparisonOverlay(ctx: CanvasRenderingContext2D, cam: CameraState, canvasWidth: number, canvasHeight: number): void {
    if (!this.comparisonVisible || !this.comparisonSnapshot) return;
    const s = state.get();
    if (!s.map) return;

    // Build boundary arrays for original order
    const totalPixels = s.map.textureSize;
    const origBoundaries: number[] = [];
    let acc = 0;
    for (const contigId of this.comparisonSnapshot) {
      const contig = s.map.contigs[contigId];
      if (contig) {
        acc += (contig.pixelEnd - contig.pixelStart);
        origBoundaries.push(acc / totalPixels);
      }
    }

    // Draw original boundaries as semi-transparent blue lines
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
    ctx.lineWidth = 1;

    for (const boundary of origBoundaries) {
      const screenX = (boundary - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;
      const screenY = (boundary - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;

      if (screenX > 0 && screenX < canvasWidth) {
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvasHeight);
        ctx.stroke();
      }
      if (screenY > 0 && screenY < canvasHeight) {
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(canvasWidth, screenY);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ─── UI Setup ─────────────────────────────────────────────

  private setupToolbar(): void {
    document.getElementById('btn-open')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
    document.getElementById('btn-welcome-open')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
    document.getElementById('btn-demo')?.addEventListener('click', () => {
      this.loadDemoData();
    });

    document.getElementById('btn-save-agp')?.addEventListener('click', () => {
      this.exportAGP();
    });
    document.getElementById('btn-save-bed')?.addEventListener('click', () => {
      this.exportBEDFile();
    });
    document.getElementById('btn-save-fasta')?.addEventListener('click', () => {
      this.exportFASTAFile();
    });
    document.getElementById('btn-load-fasta')?.addEventListener('click', () => {
      document.getElementById('fasta-file-input')?.click();
    });
    document.getElementById('btn-load-track')?.addEventListener('click', () => {
      document.getElementById('track-file-input')?.click();
    });

    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      this.takeScreenshot();
    });
    document.getElementById('btn-save-session')?.addEventListener('click', () => {
      this.saveSession();
    });
    document.getElementById('btn-load-session')?.addEventListener('click', () => {
      document.getElementById('session-file-input')?.click();
    });

    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setMode((btn as HTMLElement).dataset.mode as InteractionMode);
      });
    });

    document.getElementById('btn-grid')?.addEventListener('click', () => {
      const s = state.get();
      state.update({ showGrid: !s.showGrid });
    });
    document.getElementById('btn-minimap')?.addEventListener('click', () => {
      this.minimap.toggle();
    });
    document.getElementById('btn-tracks')?.addEventListener('click', () => {
      this.tracksVisible = !this.tracksVisible;
      this.showToast(`Tracks: ${this.tracksVisible ? 'visible' : 'hidden'}`);
      this.updateTrackConfigPanel();
    });
    document.getElementById('btn-sidebar')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('visible');
      this.updateSidebarContigList();
      this.updateStatsPanel();
      this.updateTrackConfigPanel();
    });

    // Color map dropdown
    const colormapSelect = document.getElementById('colormap-select') as HTMLSelectElement;
    colormapSelect?.addEventListener('change', () => {
      this.currentColorMap = colormapSelect.value as ColorMapName;
      this.renderer.setColorMap(this.currentColorMap);
      this.showToast(`Color map: ${this.currentColorMap}`);
      events.emit('colormap:changed', { name: this.currentColorMap });
    });

    // Gamma slider
    const gammaSlider = document.getElementById('gamma-slider') as HTMLInputElement;
    const gammaValue = document.getElementById('gamma-value')!;
    gammaSlider?.addEventListener('input', () => {
      const gamma = parseFloat(gammaSlider.value);
      state.update({ gamma });
      gammaValue.textContent = gamma.toFixed(2);
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => {
      this.performUndo();
    });
    document.getElementById('btn-redo')?.addEventListener('click', () => {
      this.performRedo();
    });

    this.setMode('navigate');
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const cmd = e.metaKey || e.ctrlKey;

      switch (e.key.toLowerCase()) {
        case 'e': this.setMode('edit'); break;
        case 's':
          if (cmd) { e.preventDefault(); this.takeScreenshot(); }
          else this.setMode('scaffold');
          break;
        case 'w': this.setMode('waypoint'); break;
        case 'l': state.update({ showGrid: !state.get().showGrid }); break;
        case 'i':
          document.getElementById('sidebar')?.classList.toggle('visible');
          this.updateSidebarContigList();
          this.updateStatsPanel();
          this.updateTrackConfigPanel();
          break;
        case 'escape':
          if (this.commandPaletteVisible) {
            this.toggleCommandPalette();
          } else {
            SelectionManager.clearSelection();
            this.setMode('navigate');
          }
          break;

        case 'arrowup': this.cycleColorMap(); break;
        case 'arrowdown': this.cycleColorMap(); break;

        case 'arrowleft': {
          const newGamma = Math.max(0.1, state.get().gamma - 0.05);
          state.update({ gamma: newGamma });
          this.syncGammaSlider(newGamma);
          break;
        }
        case 'arrowright': {
          const newGamma = Math.min(2.0, state.get().gamma + 0.05);
          state.update({ gamma: newGamma });
          this.syncGammaSlider(newGamma);
          break;
        }

        case 'm':
          this.minimap.toggle();
          break;

        case 'k':
          if (cmd) {
            e.preventDefault();
            this.toggleCommandPalette();
          }
          break;

        case 'z':
          if (cmd && e.shiftKey) this.performRedo();
          else if (cmd) this.performUndo();
          break;

        case 'o':
          if (cmd) {
            e.preventDefault();
            document.getElementById('file-input')?.click();
          }
          break;

        case 'c':
          if (this.currentMode === 'edit') {
            this.cutAtCursorPosition();
          }
          break;

        case 'j':
          if (this.currentMode === 'edit') {
            this.joinSelectedContigs();
          } else {
            this.camera.jumpToDiagonal();
          }
          break;

        case 'f':
          if (this.currentMode === 'edit') {
            this.invertSelectedContigs();
          }
          break;

        case 'h':
          if (this.currentMode === 'edit') {
            this.toggleContigExclusion();
          }
          break;

        case 'p':
          this.toggleComparisonMode();
          break;

        case 'a':
          if (cmd && this.currentMode === 'edit') {
            e.preventDefault();
            SelectionManager.selectAll();
            this.updateSidebarContigList();
          }
          break;

        case 'x':
          this.tracksVisible = !this.tracksVisible;
          this.showToast(`Tracks: ${this.tracksVisible ? 'visible' : 'hidden'}`);
          break;

        case 'n':
          if (this.currentMode === 'scaffold') {
            const id = this.scaffoldManager.createScaffold();
            this.scaffoldManager.setActiveScaffoldId(id);
            const sc = this.scaffoldManager.getScaffold(id);
            this.showToast(`Created: ${sc?.name ?? 'Scaffold'}`);
            this.updateSidebarScaffoldList();
          }
          break;

        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9':
          if (this.currentMode === 'scaffold') {
            const scaffolds = this.scaffoldManager.getAllScaffolds();
            const idx = parseInt(e.key) - 1;
            if (idx < scaffolds.length) {
              this.scaffoldManager.setActiveScaffoldId(scaffolds[idx].id);
              this.showToast(`Active: ${scaffolds[idx].name}`);
              this.updateSidebarScaffoldList();
            }
          }
          break;

        case 'delete':
        case 'backspace':
          if (this.currentMode === 'edit') {
            SelectionManager.clearSelection();
            this.updateSidebarContigList();
          }
          if (this.currentMode === 'waypoint') {
            this.waypointManager.clearAll();
            this.currentWaypointId = null;
            this.showToast('All waypoints cleared');
          }
          break;

        case 'g':
          if (cmd) {
            e.preventDefault();
            this.exportAGP();
          }
          break;

        case '`':
          this.toggleScriptConsole();
          break;

        case '?':
          this.toggleShortcutsModal();
          break;

        case ']':
        case '.': {
          // Next waypoint
          const cam = this.camera.getState();
          const nextWp = this.waypointManager.getNextWaypoint(cam.x, cam.y);
          if (nextWp) {
            this.currentWaypointId = nextWp.id;
            this.camera.animateTo({ x: nextWp.mapX, y: nextWp.mapY }, 250);
            this.showToast(`Waypoint: ${nextWp.label}`);
          }
          break;
        }
        case '[':
        case ',': {
          // Previous waypoint
          const cam = this.camera.getState();
          const prevWp = this.waypointManager.getPrevWaypoint(cam.x, cam.y);
          if (prevWp) {
            this.currentWaypointId = prevWp.id;
            this.camera.animateTo({ x: prevWp.mapX, y: prevWp.mapY }, 250);
            this.showToast(`Waypoint: ${prevWp.label}`);
          }
          break;
        }
      }
    });
  }

  private setupFileDrop(): void {
    const overlay = document.getElementById('drop-overlay')!;

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      overlay.classList.add('visible');
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        overlay.classList.remove('visible');
      }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      overlay.classList.remove('visible');
      const file = e.dataTransfer?.files[0];
      if (file) await this.loadPretextFile(file);
    });
  }

  private setupFileInput(): void {
    const input = document.getElementById('file-input') as HTMLInputElement;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await this.loadPretextFile(file);
      input.value = '';
    });

    const sessionInput = document.getElementById('session-file-input') as HTMLInputElement;
    sessionInput?.addEventListener('change', async () => {
      const file = sessionInput.files?.[0];
      if (file) await this.loadSession(file);
      sessionInput.value = '';
    });
  }

  // ─── Command Palette ──────────────────────────────────────

  private commandPaletteVisible = false;

  private toggleCommandPalette(): void {
    this.commandPaletteVisible = !this.commandPaletteVisible;
    const el = document.getElementById('command-palette')!;
    el.classList.toggle('visible', this.commandPaletteVisible);
    if (this.commandPaletteVisible) {
      const input = document.getElementById('command-input') as HTMLInputElement;
      input.value = '';
      input.focus();
      this.updateCommandResults('');
    }
  }

  private setupCommandPalette(): void {
    const input = document.getElementById('command-input') as HTMLInputElement;

    input.addEventListener('input', () => {
      this.updateCommandResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggleCommandPalette();
      } else if (e.key === 'Enter') {
        this.executeSelectedCommand();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveCommandSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveCommandSelection(-1);
      }
    });
  }

  private commands = [
    { name: 'Open file', shortcut: '\u2318O', action: () => document.getElementById('file-input')?.click() },
    { name: 'Load demo data', shortcut: '', action: () => this.loadDemoData() },
    { name: 'Navigate mode', shortcut: 'Esc', action: () => this.setMode('navigate') },
    { name: 'Edit mode', shortcut: 'E', action: () => this.setMode('edit') },
    { name: 'Scaffold mode', shortcut: 'S', action: () => this.setMode('scaffold') },
    { name: 'Waypoint mode', shortcut: 'W', action: () => this.setMode('waypoint') },
    { name: 'Toggle grid', shortcut: 'L', action: () => state.update({ showGrid: !state.get().showGrid }) },
    { name: 'Toggle sidebar', shortcut: 'I', action: () => { document.getElementById('sidebar')?.classList.toggle('visible'); this.updateSidebarContigList(); } },
    { name: 'Cycle color map', shortcut: '\u2191/\u2193', action: () => this.cycleColorMap() },
    { name: 'Toggle minimap', shortcut: 'M', action: () => this.minimap.toggle() },
    { name: 'Reset view', shortcut: 'Home', action: () => this.camera.resetView() },
    { name: 'Jump to diagonal', shortcut: 'J', action: () => this.camera.jumpToDiagonal() },
    { name: 'Undo', shortcut: '\u2318Z', action: () => this.performUndo() },
    { name: 'Redo', shortcut: '\u2318\u21e7Z', action: () => this.performRedo() },
    { name: 'Invert selected', shortcut: 'F', action: () => this.invertSelectedContigs() },
    { name: 'Cut contig at cursor', shortcut: 'C', action: () => this.cutAtCursorPosition() },
    { name: 'Join selected contigs', shortcut: 'J', action: () => this.joinSelectedContigs() },
    { name: 'Export AGP', shortcut: '\u2318G', action: () => this.exportAGP() },
    { name: 'Screenshot', shortcut: '\u2318S', action: () => this.takeScreenshot() },
    { name: 'Select all contigs', shortcut: '\u2318A', action: () => { SelectionManager.selectAll(); this.updateSidebarContigList(); } },
    { name: 'Clear selection', shortcut: 'Esc', action: () => { SelectionManager.clearSelection(); this.updateSidebarContigList(); } },
    { name: 'Toggle tracks', shortcut: 'X', action: () => { this.tracksVisible = !this.tracksVisible; this.showToast(`Tracks: ${this.tracksVisible ? 'visible' : 'hidden'}`); } },
    { name: 'New scaffold', shortcut: 'N', action: () => { const id = this.scaffoldManager.createScaffold(); this.scaffoldManager.setActiveScaffoldId(id); this.updateSidebarScaffoldList(); } },
    { name: 'Next waypoint', shortcut: '] or .', action: () => { const cam = this.camera.getState(); const wp = this.waypointManager.getNextWaypoint(cam.x, cam.y); if (wp) { this.currentWaypointId = wp.id; this.camera.animateTo({ x: wp.mapX, y: wp.mapY }, 250); } } },
    { name: 'Previous waypoint', shortcut: '[ or ,', action: () => { const cam = this.camera.getState(); const wp = this.waypointManager.getPrevWaypoint(cam.x, cam.y); if (wp) { this.currentWaypointId = wp.id; this.camera.animateTo({ x: wp.mapX, y: wp.mapY }, 250); } } },
    { name: 'Clear all waypoints', shortcut: 'Del', action: () => { this.waypointManager.clearAll(); this.currentWaypointId = null; this.showToast('All waypoints cleared'); } },
    { name: 'Save session', shortcut: '', action: () => this.saveSession() },
    { name: 'Load session', shortcut: '', action: () => document.getElementById('session-file-input')?.click() },
    { name: 'Script console', shortcut: '`', action: () => this.toggleScriptConsole() },
    { name: 'Keyboard shortcuts', shortcut: '?', action: () => this.toggleShortcutsModal() },
    { name: 'Generate script from log', action: () => { document.getElementById('btn-generate-from-log')?.click(); this.toggleScriptConsole(); } },
    { name: 'Export BED', shortcut: '', action: () => this.exportBEDFile() },
    { name: 'Export FASTA', shortcut: '', action: () => this.exportFASTAFile() },
    { name: 'Load reference FASTA', shortcut: '', action: () => document.getElementById('fasta-file-input')?.click() },
    { name: 'Load BedGraph track', shortcut: '', action: () => document.getElementById('track-file-input')?.click() },
    { name: 'Toggle contig exclusion', shortcut: 'H', action: () => this.toggleContigExclusion() },
    { name: 'Toggle comparison mode', shortcut: 'P', action: () => this.toggleComparisonMode() },
    { name: 'Batch: select by pattern', shortcut: '', action: () => this.runBatchSelectByPattern() },
    { name: 'Batch: select by size', shortcut: '', action: () => this.runBatchSelectBySize() },
    { name: 'Batch: cut large contigs', shortcut: '', action: () => this.runBatchCut() },
    { name: 'Batch: join selected', shortcut: '', action: () => this.runBatchJoin() },
    { name: 'Batch: invert selected', shortcut: '', action: () => this.runBatchInvert() },
    { name: 'Sort contigs by length', shortcut: '', action: () => this.runSortByLength() },
    { name: 'Auto sort: Union Find', shortcut: '', action: () => this.runAutoSort() },
    { name: 'Auto cut: detect breakpoints', shortcut: '', action: () => this.runAutoCut() },
    { name: 'Undo all auto-cut', shortcut: '', action: () => this.undoLastBatch('autocut') },
    { name: 'Undo all auto-sort', shortcut: '', action: () => this.undoLastBatch('autosort') },
  ];

  private selectedCommandIndex = 0;

  private updateCommandResults(query: string): void {
    const results = document.getElementById('command-results')!;
    const filtered = this.commands.filter(c =>
      c.name.toLowerCase().includes(query.toLowerCase())
    );

    this.selectedCommandIndex = 0;
    results.innerHTML = filtered.map((cmd, i) =>
      `<div class="result-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <span>${cmd.name}</span>
        <kbd>${cmd.shortcut}</kbd>
      </div>`
    ).join('');

    results.querySelectorAll('.result-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        filtered[i].action();
        this.toggleCommandPalette();
      });
    });
  }

  private moveCommandSelection(delta: number): void {
    const results = document.getElementById('command-results')!;
    const items = results.querySelectorAll('.result-item');
    if (items.length === 0) return;

    items[this.selectedCommandIndex]?.classList.remove('selected');
    this.selectedCommandIndex = Math.max(0, Math.min(items.length - 1, this.selectedCommandIndex + delta));
    items[this.selectedCommandIndex]?.classList.add('selected');
    items[this.selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private executeSelectedCommand(): void {
    const query = (document.getElementById('command-input') as HTMLInputElement).value;
    const filtered = this.commands.filter(c =>
      c.name.toLowerCase().includes(query.toLowerCase())
    );
    if (filtered[this.selectedCommandIndex]) {
      filtered[this.selectedCommandIndex].action();
    }
    this.toggleCommandPalette();
  }

  // ─── Script Console ──────────────────────────────────────

  private scriptConsoleVisible = false;

  private toggleScriptConsole(): void {
    this.scriptConsoleVisible = !this.scriptConsoleVisible;
    const el = document.getElementById('script-console');
    if (el) el.classList.toggle('visible', this.scriptConsoleVisible);
    if (this.scriptConsoleVisible) {
      const input = document.getElementById('script-input') as HTMLTextAreaElement;
      input?.focus();
    }
  }

  private setupScriptConsole(): void {
    document.getElementById('btn-console')?.addEventListener('click', () => {
      this.toggleScriptConsole();
    });
    document.getElementById('btn-close-console')?.addEventListener('click', () => {
      this.scriptConsoleVisible = false;
      document.getElementById('script-console')?.classList.remove('visible');
    });
    document.getElementById('btn-run-script')?.addEventListener('click', () => {
      this.runScript();
    });
    document.getElementById('btn-clear-script')?.addEventListener('click', () => {
      const input = document.getElementById('script-input') as HTMLTextAreaElement;
      const output = document.getElementById('script-output');
      if (input) input.value = '';
      if (output) output.innerHTML = '<span class="script-output-info">Output cleared.</span>';
    });

    // Generate script from operation log
    document.getElementById('btn-generate-from-log')?.addEventListener('click', () => {
      const s = state.get();
      if (s.undoStack.length === 0) {
        const output = document.getElementById('script-output');
        if (output) output.innerHTML = '<span class="script-output-info">No operations in log. Perform some curation operations first.</span>';
        return;
      }
      const contigs = s.map?.contigs ?? [];
      const scaffoldNames = new Map<number, string>();
      for (const sc of this.scaffoldManager.getAllScaffolds()) {
        scaffoldNames.set(sc.id, sc.name);
      }
      const script = operationsToScript(s.undoStack, contigs, {
        includeTimestamps: true,
        includeHeader: true,
        scaffoldNames,
      });
      const scriptInput = document.getElementById('script-input') as HTMLTextAreaElement;
      if (scriptInput) scriptInput.value = script;
      const output = document.getElementById('script-output');
      if (output) output.innerHTML = `<span class="script-output-info">Generated ${s.undoStack.length} operation(s) as script. Edit and re-run as needed.</span>`;
    });

    // Ctrl+Enter to run script
    const input = document.getElementById('script-input') as HTMLTextAreaElement;
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.runScript();
      }
      // Tab key inserts spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + '  ' + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + 2;
      }
    });
  }

  private runScript(): void {
    const input = document.getElementById('script-input') as HTMLTextAreaElement;
    const outputEl = document.getElementById('script-output');
    if (!input || !outputEl) return;

    const text = input.value.trim();
    if (!text) {
      outputEl.innerHTML = '<span class="script-output-info">No script to run.</span>';
      return;
    }

    const parseResult = parseScript(text);

    // Build script context
    const echoMessages: string[] = [];
    const ctx: ScriptContext = {
      curation: CurationEngine,
      selection: SelectionManager,
      scaffold: this.scaffoldManager,
      state: state,
      batch: { autoCutContigs, autoSortContigs },
      onEcho: (msg) => echoMessages.push(msg),
    };

    // Show parse errors
    let html = '';
    if (parseResult.errors.length > 0) {
      for (const err of parseResult.errors) {
        html += `<div class="script-output-error">Parse error (line ${err.line}): ${err.message}</div>`;
      }
    }

    // Execute commands
    if (parseResult.commands.length > 0) {
      const results = executeScript(parseResult.commands, ctx);
      for (const result of results) {
        const cls = result.success ? 'script-output-success' : 'script-output-error';
        html += `<div class="${cls}">Line ${result.line}: ${result.message}</div>`;
      }

      // Show echo output
      for (const msg of echoMessages) {
        html += `<div class="script-output-info">${msg}</div>`;
      }

      // Refresh UI after script execution
      this.refreshAfterCuration();
      this.updateSidebarScaffoldList();

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      html += `<div class="script-output-info">---</div>`;
      html += `<div class="script-output-info">${successCount} succeeded, ${failCount} failed (${results.length} total)</div>`;
    }

    outputEl.innerHTML = html || '<span class="script-output-info">No commands to execute.</span>';
  }

  // ─── Keyboard Shortcuts Modal ─────────────────────────────

  private toggleShortcutsModal(): void {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.classList.toggle('visible');
  }

  private setupShortcutsModal(): void {
    const modal = document.getElementById('shortcuts-modal');
    if (!modal) return;
    // Click backdrop to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    });
    // Esc to close
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('visible')) {
        modal.classList.remove('visible');
        e.stopPropagation();
      }
    });
  }

  // ─── Contig Search ──────────────────────────────────────

  private setupContigSearch(): void {
    const searchInput = document.getElementById('contig-search') as HTMLInputElement;
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
      this.updateSidebarContigList();
    });
    // Prevent keyboard shortcuts from firing while typing in search
    searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });
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
