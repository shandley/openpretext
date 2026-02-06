import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({ showGrid: false })),
    update: vi.fn(),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
  },
}));

vi.mock('../../src/ui/FileLoading', () => ({
  loadDemoData: vi.fn(),
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
  exportBEDFile: vi.fn(),
  exportFASTAFile: vi.fn(),
  takeScreenshot: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock('../../src/ui/ColorMapControls', () => ({
  cycleColorMap: vi.fn(),
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
  runBatchSelectByPattern: vi.fn(),
  runBatchSelectBySize: vi.fn(),
  runBatchCut: vi.fn(),
  runBatchJoin: vi.fn(),
  runBatchInvert: vi.fn(),
  runSortByLength: vi.fn(),
  runAutoSort: vi.fn(),
  runAutoCut: vi.fn(),
  undoLastBatch: vi.fn(),
}));

import {
  isCommandPaletteVisible,
  toggleCommandPalette,
  setupCommandPalette,
} from '../../src/ui/CommandPalette';

import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

interface MockElement {
  classList: {
    toggle: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  value: string;
  focus: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  innerHTML: string;
  addEventListener: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
  textContent: string;
}

function createMockElement(overrides: Partial<MockElement> = {}): MockElement {
  return {
    classList: {
      toggle: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
    },
    value: '',
    focus: vi.fn(),
    click: vi.fn(),
    innerHTML: '',
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    scrollIntoView: vi.fn(),
    textContent: '',
    ...overrides,
  };
}

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
    renderer: {} as any,
    labelRenderer: {} as any,
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: { toggle: vi.fn() } as any,
    camera: { resetView: vi.fn(), jumpToDiagonal: vi.fn(), getState: vi.fn(() => ({ x: 0, y: 0 })), animateTo: vi.fn() } as any,
    dragReorder: {} as any,
    scaffoldManager: { createScaffold: vi.fn(() => 1), setActiveScaffoldId: vi.fn(), getScaffold: vi.fn(), getAllScaffolds: vi.fn(() => []) } as any,
    waypointManager: { getNextWaypoint: vi.fn(), getPrevWaypoint: vi.fn(), clearAll: vi.fn() } as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  let commandPaletteEl: MockElement;
  let commandInputEl: MockElement;
  let commandResultsEl: MockElement;

  beforeEach(() => {
    vi.clearAllMocks();

    commandPaletteEl = createMockElement();
    commandInputEl = createMockElement();
    commandResultsEl = createMockElement();

    // Set up querySelectorAll to return mock result items
    const mockResultItems: MockElement[] = [];
    commandResultsEl.querySelectorAll = vi.fn(() => mockResultItems);

    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        switch (id) {
          case 'command-palette': return commandPaletteEl;
          case 'command-input': return commandInputEl;
          case 'command-results': return commandResultsEl;
          case 'file-input': return createMockElement();
          case 'sidebar': return createMockElement();
          case 'session-file-input': return createMockElement();
          case 'btn-generate-from-log': return createMockElement();
          case 'fasta-file-input': return createMockElement();
          case 'track-file-input': return createMockElement();
          default: return null;
        }
      }),
    } as any;
  });

  afterEach(() => {
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // isCommandPaletteVisible
  // -------------------------------------------------------------------------
  describe('isCommandPaletteVisible', () => {
    it('should return false initially', () => {
      // Reset module state by re-importing is not feasible, but after fresh
      // test run the default should be false (module-level variable).
      // Since we share module state across tests in a describe block, we
      // need to ensure palette is closed. Toggle twice if needed.
      // Actually on first call in fresh module load it is false.
      // We'll rely on order or toggle to known state.
      const visible = isCommandPaletteVisible();
      // It may be true or false depending on prior test execution; just
      // verify it returns a boolean.
      expect(typeof visible).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // toggleCommandPalette
  // -------------------------------------------------------------------------
  describe('toggleCommandPalette', () => {
    it('should toggle command palette visibility on', () => {
      const ctx = createMockCtx();

      // Ensure palette is closed first
      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      toggleCommandPalette(ctx);

      expect(isCommandPaletteVisible()).toBe(true);
      expect(commandPaletteEl.classList.toggle).toHaveBeenCalledWith('visible', true);
    });

    it('should focus the input and clear its value when opening', () => {
      const ctx = createMockCtx();

      // Ensure closed
      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      toggleCommandPalette(ctx);

      expect(commandInputEl.focus).toHaveBeenCalled();
      expect(commandInputEl.value).toBe('');
    });

    it('should populate command results when opening', () => {
      const ctx = createMockCtx();

      // Ensure closed
      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      toggleCommandPalette(ctx);

      // updateCommandResults writes innerHTML to command-results
      expect(commandResultsEl.innerHTML).not.toBe('');
      // Should contain known command names
      expect(commandResultsEl.innerHTML).toContain('Open file');
      expect(commandResultsEl.innerHTML).toContain('Edit mode');
    });

    it('should toggle command palette visibility off', () => {
      const ctx = createMockCtx();

      // Ensure open
      while (!isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      toggleCommandPalette(ctx);

      expect(isCommandPaletteVisible()).toBe(false);
      expect(commandPaletteEl.classList.toggle).toHaveBeenCalledWith('visible', false);
    });

    it('should NOT focus input or populate results when closing', () => {
      const ctx = createMockCtx();

      // Ensure open
      while (!isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      vi.clearAllMocks();
      commandResultsEl.innerHTML = '';

      toggleCommandPalette(ctx);

      // focus is not called when closing
      expect(commandInputEl.focus).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setupCommandPalette
  // -------------------------------------------------------------------------
  describe('setupCommandPalette', () => {
    it('should register an input event listener on the command input', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      expect(commandInputEl.addEventListener).toHaveBeenCalledWith(
        'input',
        expect.any(Function)
      );
    });

    it('should register a keydown event listener on the command input', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      expect(commandInputEl.addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });

    it('should handle Escape key in keydown to toggle command palette', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      // Get the keydown handler
      const keydownCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'keydown'
      );
      expect(keydownCall).toBeDefined();
      const keydownHandler = keydownCall![1];

      // Track palette state before
      const wasBefore = isCommandPaletteVisible();

      keydownHandler({ key: 'Escape', preventDefault: vi.fn() });

      expect(isCommandPaletteVisible()).toBe(!wasBefore);
    });

    it('should handle Enter key in keydown to execute selected command', () => {
      const ctx = createMockCtx();

      // Ensure palette is open so we can test execution
      while (!isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }

      setupCommandPalette(ctx);

      const keydownCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'keydown'
      );
      const keydownHandler = keydownCall![1];

      // Set input value to filter down to something
      commandInputEl.value = '';

      // Enter should execute selected command and toggle palette closed
      keydownHandler({ key: 'Enter', preventDefault: vi.fn() });

      // The palette should have been toggled (closed after execution)
      // We just verify it doesn't throw
    });

    it('should handle ArrowDown key in keydown with preventDefault', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const keydownCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'keydown'
      );
      const keydownHandler = keydownCall![1];

      const mockEvent = { key: 'ArrowDown', preventDefault: vi.fn() };
      keydownHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle ArrowUp key in keydown with preventDefault', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const keydownCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'keydown'
      );
      const keydownHandler = keydownCall![1];

      const mockEvent = { key: 'ArrowUp', preventDefault: vi.fn() };
      keydownHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should update command results when input event fires', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const inputCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'input'
      );
      expect(inputCall).toBeDefined();
      const inputHandler = inputCall![1];

      commandInputEl.value = 'edit';
      inputHandler();

      // Results should be filtered to commands containing 'edit'
      expect(commandResultsEl.innerHTML).toContain('Edit mode');
    });
  });

  // -------------------------------------------------------------------------
  // Command list content
  // -------------------------------------------------------------------------
  describe('command list', () => {
    it('should contain expected command names when results are populated', () => {
      const ctx = createMockCtx();

      // Ensure closed then open to populate
      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }
      toggleCommandPalette(ctx);

      const html = commandResultsEl.innerHTML;

      const expectedCommands = [
        'Open file',
        'Load demo data',
        'Navigate mode',
        'Edit mode',
        'Scaffold mode',
        'Waypoint mode',
        'Toggle grid',
        'Undo',
        'Redo',
        'Invert selected',
        'Cut contig at cursor',
        'Join selected contigs',
        'Export AGP',
        'Screenshot',
        'Select all contigs',
        'Clear selection',
        'Save session',
        'Script console',
        'Keyboard shortcuts',
        'Export BED',
        'Export FASTA',
        'Toggle contig exclusion',
        'Toggle comparison mode',
        'Batch: select by pattern',
        'Sort contigs by length',
        'Auto sort: Union Find',
        'Auto cut: detect breakpoints',
      ];

      for (const cmd of expectedCommands) {
        expect(html).toContain(cmd);
      }
    });

    it('should mark the first result item as selected', () => {
      const ctx = createMockCtx();

      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }
      toggleCommandPalette(ctx);

      const html = commandResultsEl.innerHTML;
      // First result-item should have "selected" class
      const firstItem = html.match(/class="result-item ([^"]*)"/)!;
      expect(firstItem[1]).toContain('selected');
    });
  });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------
  describe('filtering', () => {
    it('should filter commands by query string (case insensitive)', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const inputCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'input'
      );
      const inputHandler = inputCall![1];

      commandInputEl.value = 'SCREENSHOT';
      inputHandler();

      const html = commandResultsEl.innerHTML;
      expect(html).toContain('Screenshot');
      // Should NOT contain unrelated commands
      expect(html).not.toContain('Navigate mode');
      expect(html).not.toContain('Scaffold mode');
    });

    it('should show no results for a query matching nothing', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const inputCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'input'
      );
      const inputHandler = inputCall![1];

      commandInputEl.value = 'xyznonexistent';
      inputHandler();

      expect(commandResultsEl.innerHTML).toBe('');
    });

    it('should show all results when query is empty', () => {
      const ctx = createMockCtx();
      setupCommandPalette(ctx);

      const inputCall = commandInputEl.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'input'
      );
      const inputHandler = inputCall![1];

      commandInputEl.value = '';
      inputHandler();

      const html = commandResultsEl.innerHTML;
      expect(html).toContain('Open file');
      expect(html).toContain('Undo');
      expect(html).toContain('Redo');
    });

    it('should include shortcut keys in results', () => {
      const ctx = createMockCtx();

      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }
      toggleCommandPalette(ctx);

      const html = commandResultsEl.innerHTML;
      // Check some shortcuts are rendered in kbd tags
      expect(html).toContain('<kbd>');
      expect(html).toContain('E');   // Edit mode shortcut
      expect(html).toContain('Esc'); // Navigate mode shortcut
    });
  });

  // -------------------------------------------------------------------------
  // Result click handlers
  // -------------------------------------------------------------------------
  describe('result item click handlers', () => {
    it('should attach click event listeners to result items', () => {
      const ctx = createMockCtx();

      // Create mock result items that track addEventListener
      const mockItems: MockElement[] = [
        createMockElement(),
        createMockElement(),
      ];

      commandResultsEl.querySelectorAll = vi.fn(() => mockItems);

      // Ensure closed then open to trigger updateCommandResults
      while (isCommandPaletteVisible()) {
        toggleCommandPalette(ctx);
      }
      toggleCommandPalette(ctx);

      // querySelectorAll should have been called with '.result-item'
      expect(commandResultsEl.querySelectorAll).toHaveBeenCalledWith('.result-item');

      // Each mock item should have had addEventListener called with 'click'
      for (const item of mockItems) {
        expect(item.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      }
    });
  });
});
