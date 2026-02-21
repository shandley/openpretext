import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Provide DOM globals that don't exist in node environment
// ---------------------------------------------------------------------------

if (typeof globalThis.HTMLInputElement === 'undefined') {
  (globalThis as any).HTMLInputElement = class HTMLInputElement {};
}
if (typeof globalThis.HTMLTextAreaElement === 'undefined') {
  (globalThis as any).HTMLTextAreaElement = class HTMLTextAreaElement {};
}

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({ showGrid: false, gamma: 1.0 })),
    update: vi.fn(),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
  },
}));

vi.mock('../../src/ui/ColorMapControls', () => ({
  cycleColorMap: vi.fn(),
  syncGammaSlider: vi.fn(),
}));

vi.mock('../../src/ui/CurationActions', () => ({
  performUndo: vi.fn(),
  performRedo: vi.fn(),
  invertSelectedContigs: vi.fn(),
  cutAtCursorPosition: vi.fn(),
  joinSelectedContigs: vi.fn(),
  toggleContigExclusion: vi.fn(),
}));

vi.mock('../../src/ui/ExportSession', () => ({
  exportAGP: vi.fn(),
  takeScreenshot: vi.fn(),
}));

vi.mock('../../src/ui/ComparisonMode', () => ({
  toggleComparisonMode: vi.fn(),
}));

vi.mock('../../src/ui/ScriptConsole', () => ({
  toggleScriptConsole: vi.fn(),
}));

vi.mock('../../src/ui/ShortcutsModal', () => ({
  toggleShortcutsModal: vi.fn(),
}));

vi.mock('../../src/ui/BatchActions', () => ({
  runAutoSort: vi.fn(),
  runAutoCut: vi.fn(),
}));

let mockCommandPaletteVisible = false;
vi.mock('../../src/ui/CommandPalette', () => ({
  isCommandPaletteVisible: vi.fn(() => mockCommandPaletteVisible),
  toggleCommandPalette: vi.fn(),
}));

import { setupKeyboardShortcuts } from '../../src/ui/KeyboardShortcuts';
import { state } from '../../src/core/State';
import { SelectionManager } from '../../src/curation/SelectionManager';
import { cycleColorMap, syncGammaSlider } from '../../src/ui/ColorMapControls';
import { performUndo, performRedo, invertSelectedContigs, cutAtCursorPosition, joinSelectedContigs, toggleContigExclusion } from '../../src/ui/CurationActions';
import { exportAGP, takeScreenshot } from '../../src/ui/ExportSession';
import { toggleComparisonMode } from '../../src/ui/ComparisonMode';
import { toggleScriptConsole } from '../../src/ui/ScriptConsole';
import { toggleShortcutsModal } from '../../src/ui/ShortcutsModal';
import { isCommandPaletteVisible, toggleCommandPalette } from '../../src/ui/CommandPalette';
import { runAutoSort, runAutoCut } from '../../src/ui/BatchActions';

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
    minimap: { toggle: vi.fn() } as any,
    camera: {
      resetView: vi.fn(),
      jumpToDiagonal: vi.fn(),
      getState: vi.fn(() => ({ x: 0, y: 0 })),
      animateTo: vi.fn(),
    } as any,
    dragReorder: {} as any,
    scaffoldManager: {
      createScaffold: vi.fn(() => 1),
      setActiveScaffoldId: vi.fn(),
      getScaffold: vi.fn(() => ({ name: 'Scaffold_1' })),
      getAllScaffolds: vi.fn(() => []),
    } as any,
    waypointManager: {
      getNextWaypoint: vi.fn(),
      getPrevWaypoint: vi.fn(),
      clearAll: vi.fn(),
    } as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: capture the keydown handler registered on window
// ---------------------------------------------------------------------------

let capturedKeydownHandler: ((e: any) => void) | null = null;

function dispatchKey(key: string, opts: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: any;
} = {}) {
  const event = {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    target: opts.target ?? {},
    preventDefault: vi.fn(),
  };
  capturedKeydownHandler!(event);
  return event;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeyboardShortcuts', () => {
  let ctx: AppContext;
  let mockSidebarEl: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCommandPaletteVisible = false;

    ctx = createMockCtx();
    capturedKeydownHandler = null;

    mockSidebarEl = {
      classList: { toggle: vi.fn() },
    };

    // Mock window.addEventListener
    globalThis.window = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'keydown') {
          capturedKeydownHandler = handler;
        }
      }),
    } as any;

    // Mock document.getElementById for sidebar toggle
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'sidebar') return mockSidebarEl;
        if (id === 'file-input') return { click: vi.fn() };
        return null;
      }),
    } as any;

    setupKeyboardShortcuts(ctx);
  });

  afterEach(() => {
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // setupKeyboardShortcuts
  // -------------------------------------------------------------------------
  describe('setupKeyboardShortcuts', () => {
    it('should add a keydown event listener on window', () => {
      expect(globalThis.window.addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });

    it('should capture exactly one keydown listener', () => {
      expect(capturedKeydownHandler).not.toBeNull();
      expect(typeof capturedKeydownHandler).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Input/textarea element guard
  // -------------------------------------------------------------------------
  describe('input/textarea guard', () => {
    it('should ignore events from HTMLInputElement targets', () => {
      // Simulate target being an HTMLInputElement
      const inputTarget = Object.create(HTMLInputElement.prototype);
      dispatchKey('e', { target: inputTarget });

      expect(ctx.setMode).not.toHaveBeenCalled();
    });

    it('should ignore events from HTMLTextAreaElement targets', () => {
      const textareaTarget = Object.create(HTMLTextAreaElement.prototype);
      dispatchKey('e', { target: textareaTarget });

      expect(ctx.setMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Mode switching keys
  // -------------------------------------------------------------------------
  describe('mode switching', () => {
    it('should set edit mode when "e" is pressed', () => {
      dispatchKey('e');
      expect(ctx.setMode).toHaveBeenCalledWith('edit');
    });

    it('should set scaffold mode when "s" is pressed (no cmd)', () => {
      dispatchKey('s');
      expect(ctx.setMode).toHaveBeenCalledWith('scaffold');
    });

    it('should set waypoint mode when "w" is pressed', () => {
      dispatchKey('w');
      expect(ctx.setMode).toHaveBeenCalledWith('waypoint');
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+S -> screenshot
  // -------------------------------------------------------------------------
  describe('Cmd+S screenshot', () => {
    it('should take screenshot when Cmd+S is pressed', () => {
      const event = dispatchKey('s', { metaKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(takeScreenshot).toHaveBeenCalledWith(ctx);
    });

    it('should take screenshot when Ctrl+S is pressed', () => {
      const event = dispatchKey('s', { ctrlKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(takeScreenshot).toHaveBeenCalledWith(ctx);
    });

    it('should NOT set scaffold mode when Cmd+S is pressed', () => {
      dispatchKey('s', { metaKey: true });
      expect(ctx.setMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+Z -> undo, Cmd+Shift+Z -> redo
  // -------------------------------------------------------------------------
  describe('undo/redo', () => {
    it('should call performUndo when Cmd+Z is pressed', () => {
      dispatchKey('z', { metaKey: true });
      expect(performUndo).toHaveBeenCalledWith(ctx);
    });

    it('should call performRedo when Cmd+Shift+Z is pressed', () => {
      dispatchKey('z', { metaKey: true, shiftKey: true });
      expect(performRedo).toHaveBeenCalledWith(ctx);
    });

    it('should NOT call performUndo when Cmd+Shift+Z is pressed (redo takes precedence)', () => {
      dispatchKey('z', { metaKey: true, shiftKey: true });
      expect(performUndo).not.toHaveBeenCalled();
    });

    it('should NOT call undo/redo without cmd key', () => {
      dispatchKey('z');
      expect(performUndo).not.toHaveBeenCalled();
      expect(performRedo).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Escape key
  // -------------------------------------------------------------------------
  describe('Escape key', () => {
    it('should close command palette if visible', () => {
      mockCommandPaletteVisible = true;
      (isCommandPaletteVisible as ReturnType<typeof vi.fn>).mockReturnValue(true);

      dispatchKey('Escape');

      expect(toggleCommandPalette).toHaveBeenCalledWith(ctx);
      expect(SelectionManager.clearSelection).not.toHaveBeenCalled();
      expect(ctx.setMode).not.toHaveBeenCalled();
    });

    it('should clear selection and set navigate mode when palette is not visible', () => {
      mockCommandPaletteVisible = false;
      (isCommandPaletteVisible as ReturnType<typeof vi.fn>).mockReturnValue(false);

      dispatchKey('Escape');

      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(ctx.setMode).toHaveBeenCalledWith('navigate');
      expect(toggleCommandPalette).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Arrow keys for colormap/gamma
  // -------------------------------------------------------------------------
  describe('arrow keys', () => {
    it('should cycle color map on ArrowUp', () => {
      dispatchKey('ArrowUp');
      expect(cycleColorMap).toHaveBeenCalledWith(ctx);
    });

    it('should cycle color map on ArrowDown', () => {
      dispatchKey('ArrowDown');
      expect(cycleColorMap).toHaveBeenCalledWith(ctx);
    });

    it('should decrease gamma on ArrowLeft', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ gamma: 1.0 });
      dispatchKey('ArrowLeft');

      expect(state.update).toHaveBeenCalledWith({ gamma: expect.closeTo(0.95, 5) });
      expect(syncGammaSlider).toHaveBeenCalledWith(expect.closeTo(0.95, 5));
    });

    it('should increase gamma on ArrowRight', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ gamma: 1.0 });
      dispatchKey('ArrowRight');

      expect(state.update).toHaveBeenCalledWith({ gamma: expect.closeTo(1.05, 5) });
      expect(syncGammaSlider).toHaveBeenCalledWith(expect.closeTo(1.05, 5));
    });

    it('should clamp gamma to minimum 0.1 on ArrowLeft', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ gamma: 0.1 });
      dispatchKey('ArrowLeft');

      expect(state.update).toHaveBeenCalledWith({ gamma: 0.1 });
      expect(syncGammaSlider).toHaveBeenCalledWith(0.1);
    });

    it('should clamp gamma to maximum 2.0 on ArrowRight', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ gamma: 2.0 });
      dispatchKey('ArrowRight');

      expect(state.update).toHaveBeenCalledWith({ gamma: 2.0 });
      expect(syncGammaSlider).toHaveBeenCalledWith(2.0);
    });
  });

  // -------------------------------------------------------------------------
  // Toggle grid (l)
  // -------------------------------------------------------------------------
  describe('toggle grid', () => {
    it('should toggle showGrid state when "l" is pressed', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ showGrid: false, gamma: 1.0 });
      dispatchKey('l');
      expect(state.update).toHaveBeenCalledWith({ showGrid: true });
    });

    it('should toggle showGrid off when currently on', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ showGrid: true, gamma: 1.0 });
      dispatchKey('l');
      expect(state.update).toHaveBeenCalledWith({ showGrid: false });
    });
  });

  // -------------------------------------------------------------------------
  // Sidebar toggle (i)
  // -------------------------------------------------------------------------
  describe('sidebar toggle', () => {
    it('should toggle sidebar visibility and update panels when "i" is pressed', () => {
      dispatchKey('i');

      expect(mockSidebarEl.classList.toggle).toHaveBeenCalledWith('visible');
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateStatsPanel).toHaveBeenCalled();
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Minimap toggle (m)
  // -------------------------------------------------------------------------
  describe('minimap toggle', () => {
    it('should toggle minimap when "m" is pressed', () => {
      dispatchKey('m');
      expect(ctx.minimap.toggle).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+K -> command palette
  // -------------------------------------------------------------------------
  describe('Cmd+K command palette', () => {
    it('should toggle command palette when Cmd+K is pressed', () => {
      const event = dispatchKey('k', { metaKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(toggleCommandPalette).toHaveBeenCalledWith(ctx);
    });

    it('should not toggle command palette when K is pressed without cmd', () => {
      dispatchKey('k');
      expect(toggleCommandPalette).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+O -> open file
  // -------------------------------------------------------------------------
  describe('Cmd+O open file', () => {
    it('should click file-input when Cmd+O is pressed', () => {
      const mockFileInput = { click: vi.fn() };
      (document.getElementById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === 'file-input') return mockFileInput;
        return null;
      });

      const event = dispatchKey('o', { metaKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockFileInput.click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Mode-specific keys in edit mode
  // -------------------------------------------------------------------------
  describe('edit mode keys', () => {
    let editCtx: AppContext;

    beforeEach(() => {
      editCtx = createMockCtx({ currentMode: 'edit' });

      // Re-setup with edit context
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(editCtx);
    });

    it('should call cutAtCursorPosition when "c" is pressed in edit mode', () => {
      dispatchKey('c');
      expect(cutAtCursorPosition).toHaveBeenCalledWith(editCtx);
    });

    it('should call joinSelectedContigs when "j" is pressed in edit mode', () => {
      dispatchKey('j');
      expect(joinSelectedContigs).toHaveBeenCalledWith(editCtx);
    });

    it('should NOT call jumpToDiagonal when "j" is pressed in edit mode', () => {
      dispatchKey('j');
      expect(editCtx.camera.jumpToDiagonal).not.toHaveBeenCalled();
    });

    it('should call invertSelectedContigs when "f" is pressed in edit mode', () => {
      dispatchKey('f');
      expect(invertSelectedContigs).toHaveBeenCalledWith(editCtx);
    });

    it('should call toggleContigExclusion when "h" is pressed in edit mode', () => {
      dispatchKey('h');
      expect(toggleContigExclusion).toHaveBeenCalledWith(editCtx);
    });

    it('should select all contigs when Cmd+A is pressed in edit mode', () => {
      const event = dispatchKey('a', { metaKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(SelectionManager.selectAll).toHaveBeenCalled();
      expect(editCtx.updateSidebarContigList).toHaveBeenCalled();
    });

    it('should clear selection on Delete in edit mode', () => {
      dispatchKey('Delete');
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(editCtx.updateSidebarContigList).toHaveBeenCalled();
    });

    it('should clear selection on Backspace in edit mode', () => {
      dispatchKey('Backspace');
      expect(SelectionManager.clearSelection).toHaveBeenCalled();
      expect(editCtx.updateSidebarContigList).toHaveBeenCalled();
    });

    it('should call runAutoSort when Alt+S is pressed in edit mode', () => {
      const event = dispatchKey('s', { altKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(runAutoSort).toHaveBeenCalledWith(editCtx);
      expect(editCtx.setMode).not.toHaveBeenCalled();
    });

    it('should call runAutoCut when Alt+C is pressed in edit mode', () => {
      const event = dispatchKey('c', { altKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(runAutoCut).toHaveBeenCalledWith(editCtx);
      expect(cutAtCursorPosition).not.toHaveBeenCalled();
    });

    it('should NOT call runAutoSort when Alt+S is pressed in navigate mode', () => {
      // Use navigate mode ctx
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(ctx);

      dispatchKey('s', { altKey: true });
      expect(runAutoSort).not.toHaveBeenCalled();
    });

    it('should NOT call runAutoCut when Alt+C is pressed in navigate mode', () => {
      // Use navigate mode ctx
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(ctx);

      dispatchKey('c', { altKey: true });
      expect(runAutoCut).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Mode-specific: navigate mode (j should jumpToDiagonal)
  // -------------------------------------------------------------------------
  describe('navigate mode keys', () => {
    it('should call jumpToDiagonal when "j" is pressed in navigate mode', () => {
      dispatchKey('j');
      expect(ctx.camera.jumpToDiagonal).toHaveBeenCalled();
    });

    it('should NOT call cutAtCursorPosition when "c" is pressed in navigate mode', () => {
      dispatchKey('c');
      expect(cutAtCursorPosition).not.toHaveBeenCalled();
    });

    it('should NOT call invertSelectedContigs when "f" is pressed in navigate mode', () => {
      dispatchKey('f');
      expect(invertSelectedContigs).not.toHaveBeenCalled();
    });

    it('should NOT call toggleContigExclusion when "h" is pressed in navigate mode', () => {
      dispatchKey('h');
      expect(toggleContigExclusion).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Scaffold mode keys
  // -------------------------------------------------------------------------
  describe('scaffold mode keys', () => {
    let scaffoldCtx: AppContext;

    beforeEach(() => {
      scaffoldCtx = createMockCtx({ currentMode: 'scaffold' });
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(scaffoldCtx);
    });

    it('should create new scaffold when "n" is pressed in scaffold mode', () => {
      dispatchKey('n');

      expect(scaffoldCtx.scaffoldManager.createScaffold).toHaveBeenCalled();
      expect(scaffoldCtx.scaffoldManager.setActiveScaffoldId).toHaveBeenCalledWith(1);
      expect(scaffoldCtx.showToast).toHaveBeenCalled();
      expect(scaffoldCtx.updateSidebarScaffoldList).toHaveBeenCalled();
    });

    it('should NOT create scaffold when "n" is pressed in navigate mode', () => {
      // Use the main ctx (navigate mode)
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(ctx);

      dispatchKey('n');
      expect(ctx.scaffoldManager.createScaffold).not.toHaveBeenCalled();
    });

    it('should switch to scaffold by number key in scaffold mode', () => {
      const scaffolds = [
        { id: 10, name: 'Scaffold_1' },
        { id: 20, name: 'Scaffold_2' },
        { id: 30, name: 'Scaffold_3' },
      ];
      (scaffoldCtx.scaffoldManager.getAllScaffolds as ReturnType<typeof vi.fn>).mockReturnValue(scaffolds);

      dispatchKey('2');

      expect(scaffoldCtx.scaffoldManager.setActiveScaffoldId).toHaveBeenCalledWith(20);
      expect(scaffoldCtx.showToast).toHaveBeenCalledWith('Active: Scaffold_2');
      expect(scaffoldCtx.updateSidebarScaffoldList).toHaveBeenCalled();
    });

    it('should do nothing for number key beyond scaffold count', () => {
      (scaffoldCtx.scaffoldManager.getAllScaffolds as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 10, name: 'Scaffold_1' },
      ]);

      dispatchKey('5');

      // setActiveScaffoldId is called once already from 'n' test, but we
      // cleared mocks in beforeEach so this should be 0 calls
      expect(scaffoldCtx.scaffoldManager.setActiveScaffoldId).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Waypoint mode keys
  // -------------------------------------------------------------------------
  describe('waypoint mode keys', () => {
    let waypointCtx: AppContext;

    beforeEach(() => {
      waypointCtx = createMockCtx({ currentMode: 'waypoint' });
      capturedKeydownHandler = null;
      (globalThis.window.addEventListener as ReturnType<typeof vi.fn>).mockClear();
      setupKeyboardShortcuts(waypointCtx);
    });

    it('should clear all waypoints on Delete in waypoint mode', () => {
      dispatchKey('Delete');
      expect(waypointCtx.waypointManager.clearAll).toHaveBeenCalled();
      expect(waypointCtx.currentWaypointId).toBeNull();
      expect(waypointCtx.showToast).toHaveBeenCalledWith('All waypoints cleared');
    });

    it('should clear all waypoints on Backspace in waypoint mode', () => {
      dispatchKey('Backspace');
      expect(waypointCtx.waypointManager.clearAll).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Waypoint navigation (] . [ ,)
  // -------------------------------------------------------------------------
  describe('waypoint navigation', () => {
    it('should navigate to next waypoint on "]"', () => {
      const nextWp = { id: 5, mapX: 100, mapY: 200, label: 'WP1' };
      (ctx.waypointManager.getNextWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(nextWp);

      dispatchKey(']');

      expect(ctx.waypointManager.getNextWaypoint).toHaveBeenCalled();
      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 100, y: 200 }, 250);
      expect(ctx.currentWaypointId).toBe(5);
      expect(ctx.showToast).toHaveBeenCalledWith('Waypoint: WP1');
    });

    it('should navigate to next waypoint on "."', () => {
      const nextWp = { id: 7, mapX: 300, mapY: 400, label: 'WP2' };
      (ctx.waypointManager.getNextWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(nextWp);

      dispatchKey('.');

      expect(ctx.waypointManager.getNextWaypoint).toHaveBeenCalled();
      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 300, y: 400 }, 250);
    });

    it('should do nothing when no next waypoint exists', () => {
      (ctx.waypointManager.getNextWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      dispatchKey(']');

      expect(ctx.camera.animateTo).not.toHaveBeenCalled();
    });

    it('should navigate to previous waypoint on "["', () => {
      const prevWp = { id: 3, mapX: 50, mapY: 60, label: 'WP0' };
      (ctx.waypointManager.getPrevWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(prevWp);

      dispatchKey('[');

      expect(ctx.waypointManager.getPrevWaypoint).toHaveBeenCalled();
      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 50, y: 60 }, 250);
      expect(ctx.currentWaypointId).toBe(3);
      expect(ctx.showToast).toHaveBeenCalledWith('Waypoint: WP0');
    });

    it('should navigate to previous waypoint on ","', () => {
      const prevWp = { id: 2, mapX: 10, mapY: 20, label: 'WP_prev' };
      (ctx.waypointManager.getPrevWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(prevWp);

      dispatchKey(',');

      expect(ctx.waypointManager.getPrevWaypoint).toHaveBeenCalled();
      expect(ctx.camera.animateTo).toHaveBeenCalledWith({ x: 10, y: 20 }, 250);
    });

    it('should do nothing when no previous waypoint exists', () => {
      (ctx.waypointManager.getPrevWaypoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      dispatchKey('[');

      expect(ctx.camera.animateTo).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Toggle tracks (x)
  // -------------------------------------------------------------------------
  describe('toggle tracks', () => {
    it('should toggle tracksVisible and show toast', () => {
      expect(ctx.tracksVisible).toBe(false);
      dispatchKey('x');
      expect(ctx.tracksVisible).toBe(true);
      expect(ctx.showToast).toHaveBeenCalledWith('Tracks: visible');
    });

    it('should toggle tracksVisible off and show toast', () => {
      ctx.tracksVisible = true;
      dispatchKey('x');
      expect(ctx.tracksVisible).toBe(false);
      expect(ctx.showToast).toHaveBeenCalledWith('Tracks: hidden');
    });
  });

  // -------------------------------------------------------------------------
  // Comparison mode (p)
  // -------------------------------------------------------------------------
  describe('comparison mode', () => {
    it('should toggle comparison mode when "p" is pressed', () => {
      dispatchKey('p');
      expect(toggleComparisonMode).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // Script console (`)
  // -------------------------------------------------------------------------
  describe('script console', () => {
    it('should toggle script console when backtick is pressed', () => {
      dispatchKey('`');
      expect(toggleScriptConsole).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Shortcuts modal (?)
  // -------------------------------------------------------------------------
  describe('shortcuts modal', () => {
    it('should toggle shortcuts modal when "?" is pressed', () => {
      dispatchKey('?');
      expect(toggleShortcutsModal).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+G -> export AGP
  // -------------------------------------------------------------------------
  describe('Cmd+G export AGP', () => {
    it('should export AGP when Cmd+G is pressed', () => {
      const event = dispatchKey('g', { metaKey: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(exportAGP).toHaveBeenCalledWith(ctx);
    });

    it('should NOT export AGP when G is pressed without cmd', () => {
      dispatchKey('g');
      expect(exportAGP).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cmd+A -> select all (only in edit mode)
  // -------------------------------------------------------------------------
  describe('Cmd+A select all', () => {
    it('should NOT select all when not in edit mode', () => {
      dispatchKey('a', { metaKey: true });
      expect(SelectionManager.selectAll).not.toHaveBeenCalled();
    });
  });
});
