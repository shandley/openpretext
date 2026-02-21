import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
      mode: 'navigate',
    })),
    update: vi.fn(),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    clearSelection: vi.fn(),
  },
}));

vi.mock('../../src/core/EventBus', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('../../src/ui/MouseTracking', () => ({
  updateCursor: vi.fn(),
}));

import { setMode } from '../../src/ui/ModeManager';
import { state } from '../../src/core/State';
import { SelectionManager } from '../../src/curation/SelectionManager';
import { events } from '../../src/core/EventBus';
import { updateCursor } from '../../src/ui/MouseTracking';
import type { AppContext } from '../../src/ui/AppContext';

// Cast mocked functions for inspection
const mockEventsEmit = events.emit as ReturnType<typeof vi.fn>;
const mockUpdateCursor = updateCursor as ReturnType<typeof vi.fn>;

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
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: { leftClickBlocked: false } as any,
    dragReorder: {} as any,
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DOM mocking
// ---------------------------------------------------------------------------

let originalDocument: typeof globalThis.document;

beforeEach(() => {
  originalDocument = globalThis.document;
});

afterEach(() => {
  if (originalDocument) {
    globalThis.document = originalDocument;
  } else {
    (globalThis as any).document = undefined;
  }
});

function createMockButton(mode: string): any {
  return {
    dataset: { mode },
    classList: {
      toggle: vi.fn(),
    },
  };
}

function setupMockDocument(options: {
  buttons?: any[];
  elements?: Record<string, any>;
} = {}): void {
  const buttons = options.buttons ?? [];
  const elements = options.elements ?? {};

  globalThis.document = {
    querySelectorAll: vi.fn((_selector: string) => buttons),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // setMode
  // -------------------------------------------------------------------------
  describe('setMode', () => {
    it('should update ctx.currentMode to the new mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(ctx.currentMode).toBe('edit');
    });

    it('should call state.update with the new mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'scaffold');

      expect(state.update).toHaveBeenCalledWith({ mode: 'scaffold' });
    });

    it('should block camera left-click panning in non-navigate modes', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(ctx.camera.leftClickBlocked).toBe(true);
    });

    it('should not block camera left-click panning in navigate mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'navigate');

      expect(ctx.camera.leftClickBlocked).toBe(false);
    });

    it('should clear selection when switching from edit to another mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'navigate');

      expect(SelectionManager.clearSelection).toHaveBeenCalled();
    });

    it('should not clear selection when switching from navigate to edit', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(SelectionManager.clearSelection).not.toHaveBeenCalled();
    });

    it('should not clear selection when staying in edit mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'edit');

      expect(SelectionManager.clearSelection).not.toHaveBeenCalled();
    });

    it('should toggle active class on toolbar buttons matching the mode', () => {
      const navigateBtn = createMockButton('navigate');
      const editBtn = createMockButton('edit');
      const scaffoldBtn = createMockButton('scaffold');
      const waypointBtn = createMockButton('waypoint');
      const statusModeEl = { textContent: '' };

      setupMockDocument({
        buttons: [navigateBtn, editBtn, scaffoldBtn, waypointBtn],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(navigateBtn.classList.toggle).toHaveBeenCalledWith('active', false);
      expect(editBtn.classList.toggle).toHaveBeenCalledWith('active', true);
      expect(scaffoldBtn.classList.toggle).toHaveBeenCalledWith('active', false);
      expect(waypointBtn.classList.toggle).toHaveBeenCalledWith('active', false);
    });

    it('should update status-mode text to capitalized mode name for navigate', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'navigate');

      expect(statusModeEl.textContent).toBe('Navigate');
    });

    it('should update status-mode text to capitalized mode name for edit', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(statusModeEl.textContent).toBe('Edit');
    });

    it('should update status-mode text to capitalized mode name for scaffold', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'scaffold');

      expect(statusModeEl.textContent).toBe('Scaffold');
    });

    it('should update status-mode text to capitalized mode name for waypoint', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'waypoint');

      expect(statusModeEl.textContent).toBe('Waypoint');
    });

    it('should emit mode:changed event with mode and previous', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(mockEventsEmit).toHaveBeenCalledWith('mode:changed', {
        mode: 'edit',
        previous: 'navigate',
      });
    });

    it('should call updateCursor when canvas exists', () => {
      const statusModeEl = { textContent: '' };
      const canvasEl = { id: 'map-canvas' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': canvasEl },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(mockUpdateCursor).toHaveBeenCalledWith(ctx, canvasEl);
    });

    it('should not call updateCursor when canvas does not exist', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'edit');

      expect(mockUpdateCursor).not.toHaveBeenCalled();
    });

    it('should handle switching from edit to scaffold (clears selection)', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'scaffold');

      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.currentMode).toBe('scaffold');
      expect(ctx.camera.leftClickBlocked).toBe(true);
      expect(statusModeEl.textContent).toBe('Scaffold');
    });

    it('should handle switching from edit to waypoint (clears selection)', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'edit' });
      setMode(ctx, 'waypoint');

      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.currentMode).toBe('waypoint');
      expect(ctx.camera.leftClickBlocked).toBe(true);
      expect(statusModeEl.textContent).toBe('Waypoint');
    });

    it('should handle switching from scaffold to navigate (no selection clear)', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'scaffold' });
      setMode(ctx, 'navigate');

      expect(SelectionManager.clearSelection).not.toHaveBeenCalled();
      expect(ctx.currentMode).toBe('navigate');
      expect(ctx.camera.leftClickBlocked).toBe(false);
    });

    it('should block camera left-click for scaffold mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'scaffold');

      expect(ctx.camera.leftClickBlocked).toBe(true);
    });

    it('should block camera left-click for waypoint mode', () => {
      const statusModeEl = { textContent: '' };
      setupMockDocument({
        buttons: [],
        elements: { 'status-mode': statusModeEl, 'map-canvas': null },
      });

      const ctx = createMockCtx({ currentMode: 'navigate' });
      setMode(ctx, 'waypoint');

      expect(ctx.camera.leftClickBlocked).toBe(true);
    });
  });
});
