import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub global `document` before anything else (node environment has none)
// ---------------------------------------------------------------------------

const mockGetElementById = vi.fn(() => null);
vi.stubGlobal('document', {
  getElementById: mockGetElementById,
});

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      map: null,
      contigOrder: [],
      undoStack: [],
    })),
  },
}));

vi.mock('../../src/curation/CurationEngine', () => ({
  CurationEngine: {
    cut: vi.fn(),
    join: vi.fn(),
    invert: vi.fn(),
    move: vi.fn(),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectSingle: vi.fn(),
    selectRange: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedIndices: vi.fn(() => []),
  },
}));

const mockParseScript = vi.fn(() => ({ commands: [], errors: [] }));
vi.mock('../../src/scripting/ScriptParser', () => ({
  parseScript: (...args: any[]) => mockParseScript(...args),
}));

const mockExecuteScript = vi.fn(() => []);
vi.mock('../../src/scripting/ScriptExecutor', () => ({
  executeScript: (...args: any[]) => mockExecuteScript(...args),
}));

vi.mock('../../src/scripting/ScriptReplay', () => ({
  operationsToScript: vi.fn(() => '# generated script'),
}));

vi.mock('../../src/curation/BatchOperations', () => ({
  autoSortContigs: vi.fn(),
  autoCutContigs: vi.fn(),
}));

import {
  isScriptConsoleVisible,
  toggleScriptConsole,
  setupScriptConsole,
  runScript,
} from '../../src/ui/ScriptConsole';

import { state } from '../../src/core/State';
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
    setMode: vi.fn(),
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
    renderer: {} as any,
    labelRenderer: {} as any,
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {} as any,
    dragReorder: {} as any,
    scaffoldManager: { getAllScaffolds: vi.fn(() => []) } as any,
    waypointManager: {} as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: create fake DOM elements
// ---------------------------------------------------------------------------

interface FakeElement {
  id: string;
  classList: {
    toggle: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
  addEventListener: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  value: string;
  innerHTML: string;
  selectionStart: number;
  selectionEnd: number;
}

function createFakeElement(id: string): FakeElement {
  return {
    id,
    classList: {
      toggle: vi.fn(),
      remove: vi.fn(),
      add: vi.fn(),
    },
    addEventListener: vi.fn(),
    focus: vi.fn(),
    value: '',
    innerHTML: '',
    selectionStart: 0,
    selectionEnd: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptConsole', () => {
  let elements: Record<string, FakeElement>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Build a map of fake DOM elements
    elements = {
      'script-console': createFakeElement('script-console'),
      'script-input': createFakeElement('script-input'),
      'script-output': createFakeElement('script-output'),
      'btn-console': createFakeElement('btn-console'),
      'btn-close-console': createFakeElement('btn-close-console'),
      'btn-run-script': createFakeElement('btn-run-script'),
      'btn-clear-script': createFakeElement('btn-clear-script'),
      'btn-generate-from-log': createFakeElement('btn-generate-from-log'),
    };

    // Wire mockGetElementById to return our fake elements
    mockGetElementById.mockImplementation((id: string) => {
      return (elements[id] as any) ?? null;
    });

    // Reset the module-local scriptConsoleVisible state to false.
    while (isScriptConsoleVisible()) {
      toggleScriptConsole();
    }
    // Clear mocks dirtied by the reset loop
    vi.clearAllMocks();
    // Re-wire after clearing
    mockGetElementById.mockImplementation((id: string) => {
      return (elements[id] as any) ?? null;
    });
  });

  // -------------------------------------------------------------------------
  // isScriptConsoleVisible
  // -------------------------------------------------------------------------
  describe('isScriptConsoleVisible', () => {
    it('should return false initially (after reset)', () => {
      expect(isScriptConsoleVisible()).toBe(false);
    });

    it('should return true after toggling once', () => {
      toggleScriptConsole();
      expect(isScriptConsoleVisible()).toBe(true);
    });

    it('should return false after toggling twice', () => {
      toggleScriptConsole();
      toggleScriptConsole();
      expect(isScriptConsoleVisible()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // toggleScriptConsole
  // -------------------------------------------------------------------------
  describe('toggleScriptConsole', () => {
    it('should toggle visibility class on the script-console element', () => {
      toggleScriptConsole();

      expect(elements['script-console'].classList.toggle).toHaveBeenCalledWith('visible', true);
    });

    it('should focus the input when becoming visible', () => {
      toggleScriptConsole(); // false -> true

      expect(elements['script-input'].focus).toHaveBeenCalled();
    });

    it('should not focus the input when becoming hidden', () => {
      toggleScriptConsole(); // false -> true
      vi.clearAllMocks();
      mockGetElementById.mockImplementation((id: string) => (elements[id] as any) ?? null);

      toggleScriptConsole(); // true -> false

      expect(elements['script-input'].focus).not.toHaveBeenCalled();
    });

    it('should handle missing DOM elements gracefully', () => {
      mockGetElementById.mockReturnValue(null);

      // Should not throw
      expect(() => toggleScriptConsole()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // setupScriptConsole
  // -------------------------------------------------------------------------
  describe('setupScriptConsole', () => {
    it('should attach click listener to btn-console', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['btn-console'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
      );
    });

    it('should attach click listener to btn-close-console', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['btn-close-console'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
      );
    });

    it('should attach click listener to btn-run-script', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['btn-run-script'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
      );
    });

    it('should attach click listener to btn-clear-script', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['btn-clear-script'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
      );
    });

    it('should attach click listener to btn-generate-from-log', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['btn-generate-from-log'].addEventListener).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
      );
    });

    it('should attach keydown listener to script-input', () => {
      const ctx = createMockCtx();

      setupScriptConsole(ctx);

      expect(elements['script-input'].addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
      );
    });

    it('should call toggleScriptConsole when btn-console is clicked', () => {
      const ctx = createMockCtx();
      setupScriptConsole(ctx);

      // Extract the click handler and invoke it
      const clickHandler = elements['btn-console'].addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'click',
      )![1] as () => void;

      clickHandler();

      expect(isScriptConsoleVisible()).toBe(true);
    });

    it('should close console when btn-close-console is clicked', () => {
      const ctx = createMockCtx();

      // Open the console first
      toggleScriptConsole();
      expect(isScriptConsoleVisible()).toBe(true);

      setupScriptConsole(ctx);

      // Extract the close handler
      const closeHandler = elements['btn-close-console'].addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'click',
      )![1] as () => void;

      closeHandler();

      expect(isScriptConsoleVisible()).toBe(false);
      expect(elements['script-console'].classList.remove).toHaveBeenCalledWith('visible');
    });

    it('should clear input and output when btn-clear-script is clicked', () => {
      const ctx = createMockCtx();
      setupScriptConsole(ctx);

      elements['script-input'].value = 'echo hello';
      elements['script-output'].innerHTML = 'some output';

      const clearHandler = elements['btn-clear-script'].addEventListener.mock.calls.find(
        (call: any[]) => call[0] === 'click',
      )![1] as () => void;

      clearHandler();

      expect(elements['script-input'].value).toBe('');
      expect(elements['script-output'].innerHTML).toBe(
        '<span class="script-output-info">Output cleared.</span>',
      );
    });
  });

  // -------------------------------------------------------------------------
  // runScript
  // -------------------------------------------------------------------------
  describe('runScript', () => {
    it('should return early when input element is not found', () => {
      mockGetElementById.mockReturnValue(null);
      const ctx = createMockCtx();

      // Should not throw
      expect(() => runScript(ctx)).not.toThrow();
      expect(mockParseScript).not.toHaveBeenCalled();
    });

    it('should show info message when script is empty', () => {
      elements['script-input'].value = '  ';
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toBe(
        '<span class="script-output-info">No script to run.</span>',
      );
      expect(mockParseScript).not.toHaveBeenCalled();
    });

    it('should display parse errors in output', () => {
      elements['script-input'].value = 'bad command';
      mockParseScript.mockReturnValue({
        commands: [],
        errors: [{ line: 1, message: "Unknown command 'bad'" }],
      });
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toContain('script-output-error');
      expect(elements['script-output'].innerHTML).toContain("Unknown command 'bad'");
      expect(elements['script-output'].innerHTML).toContain('line 1');
    });

    it('should execute commands and show success results', () => {
      elements['script-input'].value = 'echo hello';
      mockParseScript.mockReturnValue({
        commands: [{ type: 'echo', args: { message: 'hello' }, line: 1 }],
        errors: [],
      });
      mockExecuteScript.mockReturnValue([
        { success: true, message: 'hello', line: 1 },
      ]);
      const ctx = createMockCtx();

      runScript(ctx);

      expect(mockExecuteScript).toHaveBeenCalled();
      expect(elements['script-output'].innerHTML).toContain('script-output-success');
      expect(elements['script-output'].innerHTML).toContain('hello');
    });

    it('should show failed results with error class', () => {
      elements['script-input'].value = 'invert missing';
      mockParseScript.mockReturnValue({
        commands: [{ type: 'invert', args: {}, line: 1 }],
        errors: [],
      });
      mockExecuteScript.mockReturnValue([
        { success: false, message: "Contig 'missing' not found", line: 1 },
      ]);
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toContain('script-output-error');
      expect(elements['script-output'].innerHTML).toContain("Contig 'missing' not found");
    });

    it('should show summary line with success and fail counts', () => {
      elements['script-input'].value = 'echo a\necho b\ninvert missing';
      mockParseScript.mockReturnValue({
        commands: [
          { type: 'echo', args: { message: 'a' }, line: 1 },
          { type: 'echo', args: { message: 'b' }, line: 2 },
          { type: 'invert', args: {}, line: 3 },
        ],
        errors: [],
      });
      mockExecuteScript.mockReturnValue([
        { success: true, message: 'a', line: 1 },
        { success: true, message: 'b', line: 2 },
        { success: false, message: 'error', line: 3 },
      ]);
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toContain('2 succeeded, 1 failed (3 total)');
    });

    it('should call refreshAfterCuration and updateSidebarScaffoldList after execution', () => {
      elements['script-input'].value = 'echo test';
      mockParseScript.mockReturnValue({
        commands: [{ type: 'echo', args: { message: 'test' }, line: 1 }],
        errors: [],
      });
      mockExecuteScript.mockReturnValue([
        { success: true, message: 'test', line: 1 },
      ]);
      const ctx = createMockCtx();

      runScript(ctx);

      expect(ctx.refreshAfterCuration).toHaveBeenCalled();
      expect(ctx.updateSidebarScaffoldList).toHaveBeenCalled();
    });

    it('should show "No commands to execute" when parseResult has no commands and no errors', () => {
      elements['script-input'].value = '# just a comment';
      mockParseScript.mockReturnValue({
        commands: [],
        errors: [],
      });
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toBe(
        '<span class="script-output-info">No commands to execute.</span>',
      );
    });

    it('should pass the script text to parseScript', () => {
      elements['script-input'].value = 'echo hello world';
      mockParseScript.mockReturnValue({
        commands: [],
        errors: [],
      });
      const ctx = createMockCtx();

      runScript(ctx);

      expect(mockParseScript).toHaveBeenCalledWith('echo hello world');
    });

    it('should display echo messages from script context', () => {
      elements['script-input'].value = 'echo msg';
      mockParseScript.mockReturnValue({
        commands: [{ type: 'echo', args: { message: 'msg' }, line: 1 }],
        errors: [],
      });
      // The executeScript mock needs to invoke the onEcho callback
      // provided in the ScriptContext. We capture the scriptCtx to
      // trigger onEcho ourselves.
      mockExecuteScript.mockImplementation((commands: any, scriptCtx: any) => {
        if (scriptCtx.onEcho) {
          scriptCtx.onEcho('Echo output here');
        }
        return [{ success: true, message: 'msg', line: 1 }];
      });
      const ctx = createMockCtx();

      runScript(ctx);

      expect(elements['script-output'].innerHTML).toContain('Echo output here');
      expect(elements['script-output'].innerHTML).toContain('script-output-info');
    });

    it('should handle both parse errors and successful commands together', () => {
      elements['script-input'].value = 'bad line\necho ok';
      mockParseScript.mockReturnValue({
        commands: [{ type: 'echo', args: { message: 'ok' }, line: 2 }],
        errors: [{ line: 1, message: 'Unknown command' }],
      });
      mockExecuteScript.mockReturnValue([
        { success: true, message: 'ok', line: 2 },
      ]);
      const ctx = createMockCtx();

      runScript(ctx);

      const output = elements['script-output'].innerHTML;
      expect(output).toContain('script-output-error');
      expect(output).toContain('Unknown command');
      expect(output).toContain('script-output-success');
      expect(output).toContain('1 succeeded, 0 failed (1 total)');
    });
  });
});
