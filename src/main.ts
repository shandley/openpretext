/**
 * OpenPretext — Main Entry Point
 * 
 * Modern web-based Hi-C contact map viewer for genome assembly curation.
 */

import { WebGLRenderer } from './renderer/WebGLRenderer';
import { Camera, type CameraState } from './renderer/Camera';
import { type ColorMapName } from './renderer/ColorMaps';
import { generateSyntheticMap } from './formats/SyntheticData';
import { parsePretextFile, isPretextFile } from './formats/PretextParser';
import { events } from './core/EventBus';
import { state, type InteractionMode } from './core/State';

class OpenPretextApp {
  private renderer!: WebGLRenderer;
  private camera!: Camera;
  private animFrameId: number = 0;
  private currentColorMap: ColorMapName = 'red-white';
  private contigBoundaries: number[] = [];
  private currentMode: InteractionMode = 'navigate';

  constructor() {
    this.init();
  }

  private init(): void {
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas not found');

    this.renderer = new WebGLRenderer(canvas);
    this.camera = new Camera(canvas, (cam) => this.onCameraChange(cam));

    this.setupToolbar();
    this.setupKeyboardShortcuts();
    this.setupFileDrop();
    this.setupFileInput();
    this.setupCommandPalette();
    this.startRenderLoop();

    console.log('OpenPretext initialized');
  }

  // ─── File Loading ─────────────────────────────────────────

  private async loadPretextFile(file: File): Promise<void> {
    const statusEl = document.getElementById('status-file')!;
    statusEl.textContent = `Loading ${file.name}...`;

    try {
      const buffer = await file.arrayBuffer();

      if (isPretextFile(buffer)) {
        const parsed = await parsePretextFile(buffer);
        if (parsed.textures.length > 0) {
          this.renderer.uploadContactMap(parsed.textures[0], parsed.textureSize);
        }
        this.contigBoundaries = parsed.contigs.map(c => c.pixelEnd / parsed.textureSize);
        state.update({
          map: {
            filename: file.name,
            textureSize: parsed.textureSize,
            numMipMaps: parsed.numMipMaps,
            contigs: parsed.contigs.map((c, i) => ({
              name: c.name, originalIndex: i, length: c.length,
              pixelStart: c.pixelStart, pixelEnd: c.pixelEnd,
              inverted: false, scaffoldId: null,
            })),
            textures: parsed.textures,
            extensions: new Map(parsed.extensions.map(e => [e.name, e.data])),
          },
          contigOrder: parsed.contigs.map((_, i) => i),
        });
        statusEl.textContent = file.name;
        document.getElementById('status-contigs')!.textContent = `${parsed.contigs.length} contigs`;
        events.emit('file:loaded', { filename: file.name, contigs: parsed.contigs.length, textureSize: parsed.textureSize });
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
        contigs: contigs.map((c, i) => ({
          name: c.name, originalIndex: i,
          length: (c.end - c.start) * 1000000,
          pixelStart: c.start, pixelEnd: c.end,
          inverted: false, scaffoldId: null,
        })),
        textures: [data],
        extensions: new Map(),
      },
      contigOrder: contigs.map((_, i) => i),
    });

    document.getElementById('status-file')!.textContent = 'Demo data';
    document.getElementById('status-contigs')!.textContent = `${contigs.length} contigs`;
    document.getElementById('welcome')!.style.display = 'none';
  }

  // ─── Rendering ────────────────────────────────────────────

  private startRenderLoop(): void {
    const renderFrame = () => {
      const cam = this.camera.getState();
      const s = state.get();

      this.renderer.render(cam, {
        gamma: s.gamma,
        showGrid: s.showGrid,
        gridOpacity: 0.4,
        contigBoundaries: this.contigBoundaries,
      });

      // Update status bar
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

    // Update toolbar button states
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });

    document.getElementById('status-mode')!.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    events.emit('mode:changed', { mode, previous });
  }

  // ─── Color Map ────────────────────────────────────────────

  private cycleColorMap(): void {
    const maps: ColorMapName[] = ['red-white', 'blue-white-red', 'viridis', 'hot', 'cool', 'grayscale'];
    const idx = maps.indexOf(this.currentColorMap);
    this.currentColorMap = maps[(idx + 1) % maps.length];
    this.renderer.setColorMap(this.currentColorMap);
    events.emit('colormap:changed', { name: this.currentColorMap });
  }

  // ─── UI Setup ─────────────────────────────────────────────

  private setupToolbar(): void {
    // File operations
    document.getElementById('btn-open')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
    document.getElementById('btn-welcome-open')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
    document.getElementById('btn-demo')?.addEventListener('click', () => {
      this.loadDemoData();
    });

    // Mode buttons
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setMode((btn as HTMLElement).dataset.mode as InteractionMode);
      });
    });

    // Toggle buttons
    document.getElementById('btn-grid')?.addEventListener('click', () => {
      const s = state.get();
      state.update({ showGrid: !s.showGrid });
    });
    document.getElementById('btn-sidebar')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('visible');
    });

    // Undo/redo
    document.getElementById('btn-undo')?.addEventListener('click', () => {
      events.emit('curation:undo', {});
    });
    document.getElementById('btn-redo')?.addEventListener('click', () => {
      events.emit('curation:redo', {});
    });

    // Set initial mode
    this.setMode('navigate');
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      // Don't handle shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const cmd = e.metaKey || e.ctrlKey;

      switch (e.key.toLowerCase()) {
        case 'e': this.setMode('edit'); break;
        case 's':
          if (cmd) { e.preventDefault(); /* screenshot */ }
          else this.setMode('scaffold');
          break;
        case 'w': this.setMode('waypoint'); break;
        case 'l': state.update({ showGrid: !state.get().showGrid }); break;
        case 'i': document.getElementById('sidebar')?.classList.toggle('visible'); break;
        case 'escape': this.setMode('navigate'); break;

        // Color map cycling (up/down arrows like PretextView)
        case 'arrowup': this.cycleColorMap(); break;
        case 'arrowdown': this.cycleColorMap(); break;

        // Gamma (left/right arrows)
        case 'arrowleft':
          state.update({ gamma: Math.max(0.1, state.get().gamma - 0.05) });
          break;
        case 'arrowright':
          state.update({ gamma: Math.min(2.0, state.get().gamma + 0.05) });
          break;

        // Command palette
        case 'k':
          if (cmd) {
            e.preventDefault();
            this.toggleCommandPalette();
          }
          break;

        // Undo/redo
        case 'z':
          if (cmd && e.shiftKey) events.emit('curation:redo', {});
          else if (cmd) events.emit('curation:undo', {});
          break;

        // Open file
        case 'o':
          if (cmd) {
            e.preventDefault();
            document.getElementById('file-input')?.click();
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
      input.value = ''; // Reset so same file can be re-selected
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
      }
    });
  }

  private commands = [
    { name: 'Open file', shortcut: '⌘O', action: () => document.getElementById('file-input')?.click() },
    { name: 'Load demo data', shortcut: '', action: () => this.loadDemoData() },
    { name: 'Navigate mode', shortcut: 'Esc', action: () => this.setMode('navigate') },
    { name: 'Edit mode', shortcut: 'E', action: () => this.setMode('edit') },
    { name: 'Scaffold mode', shortcut: 'S', action: () => this.setMode('scaffold') },
    { name: 'Waypoint mode', shortcut: 'W', action: () => this.setMode('waypoint') },
    { name: 'Toggle grid', shortcut: 'L', action: () => state.update({ showGrid: !state.get().showGrid }) },
    { name: 'Toggle sidebar', shortcut: 'I', action: () => document.getElementById('sidebar')?.classList.toggle('visible') },
    { name: 'Cycle color map', shortcut: '↑/↓', action: () => this.cycleColorMap() },
    { name: 'Reset view', shortcut: 'Home', action: () => this.camera.resetView() },
    { name: 'Jump to diagonal', shortcut: 'J', action: () => this.camera.jumpToDiagonal() },
    { name: 'Undo', shortcut: '⌘Z', action: () => events.emit('curation:undo', {}) },
    { name: 'Redo', shortcut: '⌘⇧Z', action: () => events.emit('curation:redo', {}) },
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
