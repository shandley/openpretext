import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock factories are hoisted above imports)
// ---------------------------------------------------------------------------

const { mockIsFlagged, mockState } = vi.hoisted(() => {
  const mockIsFlagged = vi.fn(() => false);
  const mockState = {
    map: {
      contigs: [
        { name: 'ctg0', length: 1000, pixelStart: 0, pixelEnd: 32, scaffoldId: null, inverted: false },
        { name: 'ctg1', length: 5000, pixelStart: 32, pixelEnd: 64, scaffoldId: 1, inverted: false },
        { name: 'ctg2', length: 3000, pixelStart: 64, pixelEnd: 96, scaffoldId: null, inverted: false },
      ],
      contactMap: new Float32Array(64 * 64),
      textureSize: 64,
      filename: 'test.pretext',
    },
    contigOrder: [0, 1, 2],
    selectedContigs: new Set<number>(),
    mode: 'edit',
  };
  return { mockIsFlagged, mockState };
});

// ---------------------------------------------------------------------------
// Mock dependencies before importing module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => mockState),
    update: vi.fn(),
    select: vi.fn(() => () => {}),
  },
}));

vi.mock('../../src/curation/SelectionManager', () => ({
  SelectionManager: {
    selectSingle: vi.fn(),
    selectRange: vi.fn(),
    selectToggle: vi.fn(),
  },
}));

vi.mock('../../src/curation/ContigExclusion', () => ({
  contigExclusion: {
    isExcluded: vi.fn(() => false),
    clearAll: vi.fn(),
  },
}));

vi.mock('../../src/curation/MisassemblyFlags', () => ({
  misassemblyFlags: {
    isFlagged: mockIsFlagged,
    clearAll: vi.fn(),
    setFlags: vi.fn(),
    getFlaggedCount: vi.fn(() => 0),
    getAllFlags: vi.fn(() => []),
  },
}));

vi.mock('../../src/curation/CurationEngine', () => ({
  move: vi.fn(),
}));

vi.mock('../../src/analysis/ScaffoldDetection', () => ({
  detectChromosomeBlocks: vi.fn(() => ({ blocks: [] })),
}));

vi.mock('../../src/ui/AnalysisPanel', () => ({
  recomputeScaffoldDecay: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

const mockElements: Record<string, any> = {};

function createMockElement(tag?: string): any {
  const children: any[] = [];
  const listeners: Record<string, Function[]> = {};
  const el: any = {
    tagName: tag ?? 'DIV',
    innerHTML: '',
    textContent: '',
    style: {},
    disabled: false,
    value: '',
    dataset: {},
    classList: {
      _classes: new Set<string>(),
      add(c: string) { this._classes.add(c); },
      remove(c: string) { this._classes.delete(c); },
      contains(c: string) { return this._classes.has(c); },
      toggle(c: string) { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c); },
    },
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn(),
    appendChild: vi.fn((child: any) => { children.push(child); }),
    removeChild: vi.fn(),
    getAttribute: vi.fn(),
    setAttribute: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    _listeners: listeners,
    _children: children,
  };
  return el;
}

function resetMockElements() {
  for (const key of Object.keys(mockElements)) delete mockElements[key];
}

vi.stubGlobal('document', {
  getElementById: vi.fn((id: string) => {
    if (!mockElements[id]) {
      mockElements[id] = createMockElement();
    }
    return mockElements[id];
  }),
  createElement: vi.fn(() => createMockElement()),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
});

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { formatBp, updateSidebarContigList, updateSidebarScaffoldList, getContigColorMetric, setupContigSearch } from '../../src/ui/Sidebar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(overrides?: Partial<any>): any {
  return {
    currentMode: 'edit',
    showToast: vi.fn(),
    refreshAfterCuration: vi.fn(),
    updateSidebarContigList: vi.fn(),
    updateSidebarScaffoldList: vi.fn(),
    camera: { zoomToRegion: vi.fn() },
    contigBoundaries: [0.33, 0.66, 1.0],
    scaffoldManager: {
      getAllScaffolds: vi.fn(() => []),
      getActiveScaffoldId: vi.fn(() => null),
      getContigsInScaffold: vi.fn(() => []),
      getScaffold: vi.fn((id: number) => ({ id, name: `Scaffold${id}`, color: '#ff0000' })),
      setActiveScaffoldId: vi.fn(),
      paintContigs: vi.fn(),
      createScaffold: vi.fn(),
      deleteScaffold: vi.fn(),
    },
    ...overrides,
  };
}

/** Simulate a DragEvent with dataTransfer */
function makeDragEvent(type: string, data?: string): any {
  const storedData: Record<string, string> = {};
  if (data !== undefined) storedData['text/plain'] = data;
  return {
    type,
    preventDefault: vi.fn(),
    dataTransfer: {
      dropEffect: '',
      effectAllowed: '',
      setData: vi.fn((k: string, v: string) => { storedData[k] = v; }),
      getData: vi.fn((k: string) => storedData[k] ?? ''),
    },
  };
}

// ---------------------------------------------------------------------------
// formatBp tests
// ---------------------------------------------------------------------------

describe('formatBp', () => {
  describe('base pair range (< 1000)', () => {
    it('should format 500 as "500 bp"', () => {
      expect(formatBp(500)).toBe('500 bp');
    });

    it('should format 0 as "0 bp"', () => {
      expect(formatBp(0)).toBe('0 bp');
    });

    it('should format 999 as "999 bp"', () => {
      expect(formatBp(999)).toBe('999 bp');
    });

    it('should format 1 as "1 bp"', () => {
      expect(formatBp(1)).toBe('1 bp');
    });
  });

  describe('kilobase range (1000 - 999_999)', () => {
    it('should format 1500 as "1.5 kb"', () => {
      expect(formatBp(1500)).toBe('1.5 kb');
    });

    it('should format 1000 as "1.0 kb"', () => {
      expect(formatBp(1000)).toBe('1.0 kb');
    });

    it('should format 999_999 as "1000.0 kb"', () => {
      expect(formatBp(999_999)).toBe('1000.0 kb');
    });

    it('should format 50_000 as "50.0 kb"', () => {
      expect(formatBp(50_000)).toBe('50.0 kb');
    });
  });

  describe('megabase range (1_000_000 - 999_999_999)', () => {
    it('should format 2_500_000 as "2.5 Mb"', () => {
      expect(formatBp(2_500_000)).toBe('2.5 Mb');
    });

    it('should format 1_000_000 as "1.0 Mb"', () => {
      expect(formatBp(1_000_000)).toBe('1.0 Mb');
    });

    it('should format 999_999_999 as "1000.0 Mb"', () => {
      expect(formatBp(999_999_999)).toBe('1000.0 Mb');
    });

    it('should format 150_000_000 as "150.0 Mb"', () => {
      expect(formatBp(150_000_000)).toBe('150.0 Mb');
    });
  });

  describe('gigabase range (>= 1_000_000_000)', () => {
    it('should format 1_500_000_000 as "1.5 Gb"', () => {
      expect(formatBp(1_500_000_000)).toBe('1.5 Gb');
    });

    it('should format 1_000_000_000 as "1.0 Gb"', () => {
      expect(formatBp(1_000_000_000)).toBe('1.0 Gb');
    });

    it('should format 3_200_000_000 as "3.2 Gb"', () => {
      expect(formatBp(3_200_000_000)).toBe('3.2 Gb');
    });
  });
});

// ---------------------------------------------------------------------------
// Drag-drop scaffold assignment
// ---------------------------------------------------------------------------

describe('scaffold drag-drop assignment', () => {
  let ctx: any;

  beforeEach(() => {
    resetMockElements();
    mockState.selectedContigs = new Set();
    ctx = createMockCtx({
      scaffoldManager: {
        getAllScaffolds: vi.fn(() => [
          { id: 1, name: 'Chr1', color: '#e94560' },
          { id: 2, name: 'Chr2', color: '#3498db' },
        ]),
        getActiveScaffoldId: vi.fn(() => 1),
        getContigsInScaffold: vi.fn(() => [0, 1]),
        getScaffold: vi.fn((id: number) => ({ id, name: `Chr${id}`, color: '#e94560' })),
        setActiveScaffoldId: vi.fn(),
        paintContigs: vi.fn(),
        createScaffold: vi.fn(),
        deleteScaffold: vi.fn(),
      },
    });
  });

  it('scaffold rows accept drop events and call paintContigs', () => {
    // Build the scaffold list with real DOM-like parsing
    updateSidebarScaffoldList(ctx);

    const listEl = mockElements['scaffold-list'];
    // The innerHTML was set; let's inspect that scaffold rows are generated
    expect(listEl.innerHTML).toContain('data-scaffold-id="1"');
    expect(listEl.innerHTML).toContain('data-scaffold-id="2"');

    // Verify querySelectorAll was called for wiring
    expect(listEl.querySelectorAll).toHaveBeenCalledWith('.contig-item');
  });

  it('drop handler calls paintContigs with single contig when not in selection', () => {
    // We need to test the drop handler directly by inspecting
    // the listeners attached to scaffold row elements
    const scaffoldRow = createMockElement();
    scaffoldRow.dataset.scaffoldId = '1';

    // Mock querySelectorAll to return our scaffold row
    const scaffoldListEl = mockElements['scaffold-list'] ?? createMockElement();
    mockElements['scaffold-list'] = scaffoldListEl;
    scaffoldListEl.querySelectorAll = vi.fn(() => [scaffoldRow]);

    updateSidebarScaffoldList(ctx);

    // Find the drop listener on the scaffold row
    const dropListeners = scaffoldRow._listeners['drop'];
    expect(dropListeners).toBeDefined();
    expect(dropListeners.length).toBeGreaterThan(0);

    // Simulate drop of contig index 0
    const dropEvent = makeDragEvent('drop', '0');
    dropListeners[0](dropEvent);

    expect(ctx.scaffoldManager.paintContigs).toHaveBeenCalledWith([0], 1);
    expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('1 contig(s)'));
  });

  it('drop handler moves all selected contigs when dragged contig is in selection', () => {
    mockState.selectedContigs = new Set([0, 2]);

    const scaffoldRow = createMockElement();
    scaffoldRow.dataset.scaffoldId = '2';

    const scaffoldListEl = createMockElement();
    mockElements['scaffold-list'] = scaffoldListEl;
    scaffoldListEl.querySelectorAll = vi.fn(() => [scaffoldRow]);

    updateSidebarScaffoldList(ctx);

    const dropListeners = scaffoldRow._listeners['drop'];
    const dropEvent = makeDragEvent('drop', '0'); // 0 is in selection
    dropListeners[0](dropEvent);

    expect(ctx.scaffoldManager.paintContigs).toHaveBeenCalledWith(
      expect.arrayContaining([0, 2]),
      2,
    );
    expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('2 contig(s)'));
  });

  it('unassign drop zone calls paintContigs with null', () => {
    const scaffoldListEl = createMockElement();
    mockElements['scaffold-list'] = scaffoldListEl;
    scaffoldListEl.querySelectorAll = vi.fn(() => []);

    // Create the unassign zone element before calling updateSidebarScaffoldList
    const unassignZone = createMockElement();
    mockElements['scaffold-drop-unassign'] = unassignZone;

    updateSidebarScaffoldList(ctx);

    const dropListeners = unassignZone._listeners['drop'];
    expect(dropListeners).toBeDefined();

    const dropEvent = makeDragEvent('drop', '1');
    dropListeners[0](dropEvent);

    expect(ctx.scaffoldManager.paintContigs).toHaveBeenCalledWith([1], null);
    expect(ctx.showToast).toHaveBeenCalledWith(expect.stringContaining('Unassigned'));
  });
});

// ---------------------------------------------------------------------------
// Contig metric coloring
// ---------------------------------------------------------------------------

describe('contig metric coloring', () => {
  let ctx: any;

  beforeEach(() => {
    resetMockElements();
    mockState.selectedContigs = new Set();
    mockState.map!.contigs[1].scaffoldId = 1;
    mockIsFlagged.mockImplementation(() => false);
    ctx = createMockCtx({
      scaffoldManager: {
        getAllScaffolds: vi.fn(() => [
          { id: 1, name: 'Chr1', color: '#e94560' },
        ]),
        getActiveScaffoldId: vi.fn(() => null),
        getContigsInScaffold: vi.fn(() => []),
        getScaffold: vi.fn(),
        setActiveScaffoldId: vi.fn(),
        paintContigs: vi.fn(),
      },
    });
  });

  it('default metric is "none" with no border-left styles', () => {
    // Ensure contig list element returns an empty querySelectorAll
    const listEl = createMockElement();
    mockElements['contig-list'] = listEl;
    listEl.querySelectorAll = vi.fn(() => []);

    updateSidebarContigList(ctx);
    expect(listEl.innerHTML).not.toContain('border-left');
  });

  it('length metric applies border-left styles to all contigs', () => {
    const metricSelect = createMockElement('SELECT');
    mockElements['contig-color-metric'] = metricSelect;
    metricSelect.value = 'length';

    const searchInput = createMockElement('INPUT');
    mockElements['contig-search'] = searchInput;
    setupContigSearch(ctx);

    // Fire the change listener to set contigColorMetric
    const changeListeners = metricSelect._listeners['change'];
    expect(changeListeners).toBeDefined();
    changeListeners[0]();

    const listEl = createMockElement();
    mockElements['contig-list'] = listEl;
    listEl.querySelectorAll = vi.fn(() => []);

    updateSidebarContigList(ctx);
    expect(listEl.innerHTML).toContain('border-left:3px solid rgb(');
  });

  it('scaffold metric uses scaffold colors for assigned contigs', () => {
    const metricSelect = createMockElement('SELECT');
    mockElements['contig-color-metric'] = metricSelect;
    metricSelect.value = 'scaffold';

    const searchInput = createMockElement('INPUT');
    mockElements['contig-search'] = searchInput;
    setupContigSearch(ctx);
    metricSelect._listeners['change'][0]();

    const listEl = createMockElement();
    mockElements['contig-list'] = listEl;
    listEl.querySelectorAll = vi.fn(() => []);

    updateSidebarContigList(ctx);
    // ctg1 (index 1) has scaffoldId=1 → should have scaffold color #e94560
    expect(listEl.innerHTML).toContain('border-left:3px solid #e94560');
    // Only 1 contig has scaffold → only 1 border-left
    const matches = listEl.innerHTML.match(/border-left:3px solid/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('misassembly metric highlights flagged contigs', () => {
    mockIsFlagged.mockImplementation((idx: number) => idx === 2);

    const metricSelect = createMockElement('SELECT');
    mockElements['contig-color-metric'] = metricSelect;
    metricSelect.value = 'misassembly';

    const searchInput = createMockElement('INPUT');
    mockElements['contig-search'] = searchInput;
    setupContigSearch(ctx);
    metricSelect._listeners['change'][0]();

    const listEl = createMockElement();
    mockElements['contig-list'] = listEl;
    listEl.querySelectorAll = vi.fn(() => []);

    updateSidebarContigList(ctx);
    expect(listEl.innerHTML).toContain('border-left:3px solid #e74c3c');
    const matches = listEl.innerHTML.match(/border-left:3px solid/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('"none" metric removes border styles', () => {
    const metricSelect = createMockElement('SELECT');
    mockElements['contig-color-metric'] = metricSelect;
    metricSelect.value = 'none';

    const searchInput = createMockElement('INPUT');
    mockElements['contig-search'] = searchInput;
    setupContigSearch(ctx);
    metricSelect._listeners['change'][0]();

    const listEl = createMockElement();
    mockElements['contig-list'] = listEl;
    listEl.querySelectorAll = vi.fn(() => []);

    updateSidebarContigList(ctx);
    expect(listEl.innerHTML).not.toContain('border-left');
  });
});
