import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUndoStack, mockRedoStack, mockUndo, mockRedo } = vi.hoisted(() => ({
  mockUndoStack: { value: [] as any[] },
  mockRedoStack: { value: [] as any[] },
  mockUndo: vi.fn(() => true),
  mockRedo: vi.fn(() => true),
}));

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({
      undoStack: mockUndoStack.value,
      redoStack: mockRedoStack.value,
      contigOrder: [0, 1],
      selectedContigs: new Set(),
    })),
    update: vi.fn(),
    select: vi.fn(() => () => {}),
  },
}));

vi.mock('../../src/curation/CurationEngine', () => ({
  undo: mockUndo,
  redo: mockRedo,
}));

// ---------------------------------------------------------------------------
// DOM mock
// ---------------------------------------------------------------------------

const mockElements: Record<string, any> = {};

function createMockElement(): any {
  const listeners: Record<string, Function[]> = {};
  return {
    innerHTML: '',
    style: {},
    dataset: {},
    classList: {
      _classes: new Set<string>(),
      add(c: string) { this._classes.add(c); },
      remove(c: string) { this._classes.delete(c); },
      contains(c: string) { return this._classes.has(c); },
    },
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    querySelectorAll: vi.fn(() => []),
    _listeners: listeners,
  };
}

function resetMockElements() {
  for (const key of Object.keys(mockElements)) delete mockElements[key];
}

vi.stubGlobal('document', {
  getElementById: vi.fn((id: string) => {
    if (!mockElements[id]) mockElements[id] = createMockElement();
    return mockElements[id];
  }),
  createElement: vi.fn(() => createMockElement()),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
});

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { updateUndoHistoryPanel, groupOps, relativeTime } from '../../src/ui/UndoHistoryPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(overrides: Partial<any> = {}): any {
  return {
    type: 'cut',
    timestamp: Date.now(),
    description: 'Cut contig "ctg0" at pixel offset 100',
    data: {},
    ...overrides,
  };
}

function createMockCtx(): any {
  return {
    showToast: vi.fn(),
    refreshAfterCuration: vi.fn(),
    updateSidebarContigList: vi.fn(),
    updateSidebarScaffoldList: vi.fn(),
    updateStatsPanel: vi.fn(),
    updateTrackConfigPanel: vi.fn(),
    updateUndoHistoryPanel: vi.fn(),
    setMode: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('relativeTime', () => {
  it('formats seconds', () => {
    const result = relativeTime(Date.now() - 5000);
    expect(result).toBe('5s ago');
  });

  it('formats minutes', () => {
    const result = relativeTime(Date.now() - 120_000);
    expect(result).toBe('2m ago');
  });

  it('formats hours', () => {
    const result = relativeTime(Date.now() - 7_200_000);
    expect(result).toBe('2h ago');
  });

  it('returns at least 1s ago', () => {
    const result = relativeTime(Date.now() - 100);
    expect(result).toBe('1s ago');
  });
});

describe('groupOps', () => {
  it('returns empty array for empty input', () => {
    expect(groupOps([])).toEqual([]);
  });

  it('groups single non-batch ops individually', () => {
    const ops = [
      makeOp({ type: 'cut', description: 'cut A' }),
      makeOp({ type: 'invert', description: 'inv B' }),
    ];
    const groups = groupOps(ops);
    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe('single'); // newest first (inv B)
    expect(groups[0].label).toBe('inv B');
    expect(groups[1].label).toBe('cut A');
  });

  it('groups consecutive ops with same batchId', () => {
    const ops = [
      makeOp({ batchId: 'autosort-123', description: 'move 1' }),
      makeOp({ batchId: 'autosort-123', description: 'move 2' }),
      makeOp({ batchId: 'autosort-123', description: 'move 3' }),
    ];
    const groups = groupOps(ops);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('batch');
    expect(groups[0].opCount).toBe(3);
    expect(groups[0].label).toContain('3 ops');
  });

  it('separates different batchIds', () => {
    const ops = [
      makeOp({ batchId: 'autocut-1' }),
      makeOp({ batchId: 'autocut-1' }),
      makeOp({ type: 'invert', description: 'inv' }),
      makeOp({ batchId: 'autosort-2' }),
    ];
    const groups = groupOps(ops);
    expect(groups).toHaveLength(3);
    // Newest first: autosort-2 (single batch), then inv, then autocut-1 (batch of 2)
    expect(groups[0].type).toBe('batch');
    expect(groups[0].opCount).toBe(1);
    expect(groups[1].type).toBe('single');
    expect(groups[2].type).toBe('batch');
    expect(groups[2].opCount).toBe(2);
  });
});

describe('updateUndoHistoryPanel', () => {
  let ctx: any;

  beforeEach(() => {
    resetMockElements();
    mockUndoStack.value = [];
    mockRedoStack.value = [];
    mockUndo.mockClear();
    mockRedo.mockClear();
    ctx = createMockCtx();
  });

  it('shows placeholder when both stacks are empty', () => {
    const el = createMockElement();
    mockElements['undo-history-content'] = el;

    updateUndoHistoryPanel(ctx);
    expect(el.innerHTML).toContain('No operations yet');
  });

  it('renders single operation with type icon and description', () => {
    mockUndoStack.value = [makeOp({ type: 'cut', description: 'Cut contig "c0"' })];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => []);

    updateUndoHistoryPanel(ctx);
    expect(el.innerHTML).toContain('\u2702'); // ✂ icon
    expect(el.innerHTML).toContain('Cut contig');
    expect(el.innerHTML).toContain('ago');
  });

  it('renders multiple ops newest-first', () => {
    mockUndoStack.value = [
      makeOp({ type: 'cut', description: 'First op', timestamp: 1000 }),
      makeOp({ type: 'invert', description: 'Second op', timestamp: 2000 }),
    ];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => []);

    updateUndoHistoryPanel(ctx);
    const firstIdx = el.innerHTML.indexOf('Second op');
    const secondIdx = el.innerHTML.indexOf('First op');
    expect(firstIdx).toBeLessThan(secondIdx); // Newest first
  });

  it('groups batch ops into single row with count', () => {
    mockUndoStack.value = [
      makeOp({ batchId: 'autosort-1', description: 'move 1' }),
      makeOp({ batchId: 'autosort-1', description: 'move 2' }),
      makeOp({ batchId: 'autosort-1', description: 'move 3' }),
    ];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => []);

    updateUndoHistoryPanel(ctx);
    expect(el.innerHTML).toContain('history-batch-count');
    expect(el.innerHTML).toContain('3');
    // Should be a single history-item, not three
    const itemCount = (el.innerHTML.match(/history-item/g) ?? []).length;
    expect(itemCount).toBe(1);
  });

  it('shows redo items with redo class', () => {
    mockUndoStack.value = [makeOp({ description: 'undo item' })];
    mockRedoStack.value = [makeOp({ description: 'redo item' })];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => []);

    updateUndoHistoryPanel(ctx);
    expect(el.innerHTML).toContain('class="history-item redo"');
    expect(el.innerHTML).toContain('redo item');
  });

  it('shows separator between undo and redo sections', () => {
    mockUndoStack.value = [makeOp()];
    mockRedoStack.value = [makeOp()];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => []);

    updateUndoHistoryPanel(ctx);
    expect(el.innerHTML).toContain('history-separator');
    expect(el.innerHTML).toContain('redo');
  });

  it('click on undo item calls undo() correct number of times', () => {
    mockUndoStack.value = [
      makeOp({ description: 'op1' }),
      makeOp({ description: 'op2' }),
      makeOp({ description: 'op3' }),
    ];

    // Create mock items that capture click handlers
    const items: any[] = [];
    const el = createMockElement();
    mockElements['undo-history-content'] = el;
    el.querySelectorAll = vi.fn(() => {
      // Return mock items with captured listeners
      return items;
    });

    updateUndoHistoryPanel(ctx);

    // The panel creates 3 groups (all single), newest first with cumulative counts 1, 2, 3
    // Parse the HTML to check data-count attributes
    const countMatches = el.innerHTML.match(/data-count="(\d+)"/g) ?? [];
    expect(countMatches).toContain('data-count="1"');
    expect(countMatches).toContain('data-count="2"');
    expect(countMatches).toContain('data-count="3"');
  });

  it('click on redo item calls redo()', () => {
    mockRedoStack.value = [makeOp({ description: 'redo op' })];

    const el = createMockElement();
    mockElements['undo-history-content'] = el;

    // Capture the click handler from querySelectorAll items
    const mockItem = createMockElement();
    mockItem.dataset = { stack: 'redo', count: '1' };
    el.querySelectorAll = vi.fn(() => [mockItem]);

    updateUndoHistoryPanel(ctx);

    // Trigger the click handler
    const clickHandlers = mockItem._listeners['click'];
    expect(clickHandlers).toBeDefined();
    clickHandlers[0]();

    expect(mockRedo).toHaveBeenCalledTimes(1);
    expect(ctx.refreshAfterCuration).toHaveBeenCalled();
  });
});
