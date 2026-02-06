/**
 * OpenPretext — Main Entry Point
 *
 * Modern web-based Hi-C contact map viewer for genome assembly curation.
 */

import { WebGLRenderer } from './renderer/WebGLRenderer';
import { Camera, type CameraState } from './renderer/Camera';
import { LabelRenderer } from './renderer/LabelRenderer';
import { type ColorMapName } from './renderer/ColorMaps';
import { generateSyntheticMap } from './formats/SyntheticData';
import { parsePretextFile, isPretextFile } from './formats/PretextParser';
import { events } from './core/EventBus';
import { state, type InteractionMode } from './core/State';
import { CurationEngine } from './curation/CurationEngine';
import { SelectionManager } from './curation/SelectionManager';
import { downloadAGP } from './export/AGPWriter';
import { downloadSnapshot } from './export/SnapshotExporter';

class OpenPretextApp {
  private renderer!: WebGLRenderer;
  private labelRenderer!: LabelRenderer;
  private camera!: Camera;
  private animFrameId: number = 0;
  private currentColorMap: ColorMapName = 'red-white';
  private contigBoundaries: number[] = [];
  private currentMode: InteractionMode = 'navigate';
  private hoveredContigIndex: number = -1;
  private mouseMapPos: { x: number; y: number } = { x: 0, y: 0 };

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

    this.camera = new Camera(canvas, (cam) => this.onCameraChange(cam));

    this.setupToolbar();
    this.setupKeyboardShortcuts();
    this.setupFileDrop();
    this.setupFileInput();
    this.setupCommandPalette();
    this.setupMouseTracking(canvas);
    this.setupClickInteractions(canvas);
    this.setupEventListeners();
    this.startRenderLoop();

    console.log('OpenPretext initialized');
  }

  // ─── Event Listeners ─────────────────────────────────────

  private setupEventListeners(): void {
    events.on('file:loaded', () => {
      this.updateSidebarContigList();
    });

    events.on('curation:cut', () => this.refreshAfterCuration());
    events.on('curation:join', () => this.refreshAfterCuration());
    events.on('curation:invert', () => this.refreshAfterCuration());
    events.on('curation:move', () => this.refreshAfterCuration());
  }

  private refreshAfterCuration(): void {
    this.rebuildContigBoundaries();
    this.updateSidebarContigList();
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

  // ─── File Loading ─────────────────────────────────────────

  private async loadPretextFile(file: File): Promise<void> {
    const statusEl = document.getElementById('status-file')!;
    statusEl.textContent = `Loading ${file.name}...`;

    try {
      const buffer = await file.arrayBuffer();

      if (isPretextFile(buffer)) {
        const parsed = await parsePretextFile(buffer);
        const h = parsed.header;
        const mapSize = h.numberOfPixels1D;

        // Assemble the full contact map from decoded tiles (mipmap level 0).
        const contactMap = new Float32Array(mapSize * mapSize);
        const N = h.numberOfTextures1D;
        const tRes = h.textureResolution;

        for (let tx = 0; tx < N; tx++) {
          for (let ty = tx; ty < N; ty++) {
            const linIdx = (((2 * N - tx - 1) * tx) >> 1) + ty;
            const tileData = parsed.tilesDecoded[linIdx]?.[0];
            if (!tileData) continue;

            for (let py = 0; py < tRes; py++) {
              for (let px = 0; px < tRes; px++) {
                const val = tileData[py * tRes + px];
                const gx = tx * tRes + px;
                const gy = ty * tRes + py;
                if (gx < mapSize && gy < mapSize) {
                  contactMap[gy * mapSize + gx] = val;
                  contactMap[gx * mapSize + gy] = val;
                }
              }
            }
          }
        }

        this.renderer.uploadContactMap(contactMap, mapSize);
        this.contigBoundaries = parsed.contigs.map(c => c.pixelEnd / mapSize);
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
            extensions: new Map(parsed.extensions.map(e => [e.name, e.data])),
          },
          contigOrder: parsed.contigs.map((_, i) => i),
        });
        statusEl.textContent = file.name;
        document.getElementById('status-contigs')!.textContent = `${parsed.contigs.length} contigs`;
        events.emit('file:loaded', { filename: file.name, contigs: parsed.contigs.length, textureSize: mapSize });
      } else {
        statusEl.textContent = 'Invalid file format';
      }
    } catch (err) {
      console.error('Error loading file:', err);
      statusEl.textContent = 'Error loading file';
    }

    document.getElementById('welcome')!.style.display = 'none';
  }

  private loadDemoData(): void {
    const { data, size, contigs } = generateSyntheticMap(1024, 12);
    this.renderer.uploadContactMap(data, size);
    this.contigBoundaries = contigs.map(c => c.end / size);

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
        extensions: new Map(),
      },
      contigOrder: contigs.map((_, i) => i),
    });

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
    });

    canvas.addEventListener('mouseleave', () => {
      this.hoveredContigIndex = -1;
      document.getElementById('status-position')!.textContent = '\u2014';
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

  // ─── Click Interactions ──────────────────────────────────

  private setupClickInteractions(canvas: HTMLCanvasElement): void {
    let mouseDownPos = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mouseup', (e) => {
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

    const selected = s.selectedContigs;
    const html = s.contigOrder.map((contigId, orderIdx) => {
      const contig = s.map!.contigs[contigId];
      if (!contig) return '';
      const isSelected = selected.has(orderIdx);
      const lengthStr = this.formatBp(contig.length);
      const invertedBadge = contig.inverted ? '<span class="contig-badge inverted">INV</span>' : '';
      const scaffoldBadge = contig.scaffoldId !== null
        ? `<span class="contig-badge scaffold">S${contig.scaffoldId}</span>`
        : '';

      return `<div class="contig-item ${isSelected ? 'selected' : ''}" data-order-index="${orderIdx}">
        <span class="contig-name">${contig.name}</span>
        <span class="contig-meta">${lengthStr} ${invertedBadge}${scaffoldBadge}</span>
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

      if (this.labelRenderer && s.map) {
        const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
        const contigNames = s.contigOrder.map(id => s.map!.contigs[id]?.name ?? '');
        this.labelRenderer.render({
          contigBoundaries: this.contigBoundaries,
          contigNames,
          camera: cam,
          hoveredIndex: this.hoveredContigIndex,
          canvasWidth: canvas.clientWidth,
          canvasHeight: canvas.clientHeight,
        });
      }

      document.getElementById('status-zoom')!.textContent = `${Math.round(cam.zoom * 100)}%`;

      this.animFrameId = requestAnimationFrame(renderFrame);
    };
    renderFrame();
  }

  private onCameraChange(cam: CameraState): void {
    events.emit('camera:changed', cam);
  }

  // ─── Mode Management ──────────────────────────────────────

  private setMode(mode: InteractionMode): void {
    const previous = this.currentMode;
    this.currentMode = mode;
    state.update({ mode });

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
    events.emit('colormap:changed', { name: this.currentColorMap });
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

    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      this.takeScreenshot();
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
    document.getElementById('btn-sidebar')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('visible');
      this.updateSidebarContigList();
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

        case 'arrowleft':
          state.update({ gamma: Math.max(0.1, state.get().gamma - 0.05) });
          break;
        case 'arrowright':
          state.update({ gamma: Math.min(2.0, state.get().gamma + 0.05) });
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

        case 'f':
          if (this.currentMode === 'edit') {
            this.invertSelectedContigs();
          }
          break;

        case 'a':
          if (cmd && this.currentMode === 'edit') {
            e.preventDefault();
            SelectionManager.selectAll();
            this.updateSidebarContigList();
          }
          break;

        case 'delete':
        case 'backspace':
          if (this.currentMode === 'edit') {
            SelectionManager.clearSelection();
            this.updateSidebarContigList();
          }
          break;

        case 'g':
          if (cmd) {
            e.preventDefault();
            this.exportAGP();
          }
          break;
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
    { name: 'Reset view', shortcut: 'Home', action: () => this.camera.resetView() },
    { name: 'Jump to diagonal', shortcut: 'J', action: () => this.camera.jumpToDiagonal() },
    { name: 'Undo', shortcut: '\u2318Z', action: () => this.performUndo() },
    { name: 'Redo', shortcut: '\u2318\u21e7Z', action: () => this.performRedo() },
    { name: 'Invert selected', shortcut: 'F', action: () => this.invertSelectedContigs() },
    { name: 'Export AGP', shortcut: '\u2318G', action: () => this.exportAGP() },
    { name: 'Screenshot', shortcut: '\u2318S', action: () => this.takeScreenshot() },
    { name: 'Select all contigs', shortcut: '\u2318A', action: () => { SelectionManager.selectAll(); this.updateSidebarContigList(); } },
    { name: 'Clear selection', shortcut: 'Esc', action: () => { SelectionManager.clearSelection(); this.updateSidebarContigList(); } },
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
}

// ─── Boot ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  new OpenPretextApp();
});
