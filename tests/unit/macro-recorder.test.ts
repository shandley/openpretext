import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub global `document` (node has none)
// ---------------------------------------------------------------------------

const mockGetElementById = vi.fn(() => null);
vi.stubGlobal('document', {
  getElementById: mockGetElementById,
});

// ---------------------------------------------------------------------------
// Mock State: a controllable undo stack + map.contigs for name resolution.
// The real EventBus and real operationsToScript are used so the test exercises
// the true event → slice → DSL path.
// ---------------------------------------------------------------------------

const fakeState = {
  undoStack: [] as any[],
  map: { contigs: [{ name: 'chr1' }, { name: 'chr2' }] } as any,
};

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => fakeState),
  },
}));

import { events } from '../../src/core/EventBus';
import { setupMacroRecorder, isMacroRecording } from '../../src/ui/MacroRecorder';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// Fake DOM elements
// ---------------------------------------------------------------------------

function createFakeElement(id: string) {
  return {
    id,
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    addEventListener: vi.fn(),
    value: '',
    innerHTML: '',
    textContent: '',
  };
}

function createMockCtx(): AppContext {
  return {
    showToast: vi.fn(),
    scaffoldManager: { getAllScaffolds: vi.fn(() => []) } as any,
  } as unknown as AppContext;
}

/** Push a cut op into the fake undo stack (data shape matches operationToDSL). */
function pushCut(originalContigId: number, pixelOffset: number) {
  fakeState.undoStack.push({
    type: 'cut',
    timestamp: Date.now(),
    description: `Cut contig at ${pixelOffset}`,
    data: { originalContigId, pixelOffset, contigOrderIndex: originalContigId },
  });
}

describe('MacroRecorder', () => {
  let elements: Record<string, ReturnType<typeof createFakeElement>>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeState.undoStack = [];

    elements = {
      'script-input': createFakeElement('script-input'),
      'script-output': createFakeElement('script-output'),
      'btn-record-macro': createFakeElement('btn-record-macro'),
    };
    mockGetElementById.mockImplementation((id: string) => (elements[id] as any) ?? null);

    // Ensure we start from a not-recording state (module state persists).
    const ctx = createMockCtx();
    setupMacroRecorder(ctx);
    if (isMacroRecording()) getClickHandler()(); // stop if left recording
    vi.clearAllMocks();
    mockGetElementById.mockImplementation((id: string) => (elements[id] as any) ?? null);
  });

  function getClickHandler(): () => void {
    const btn = elements['btn-record-macro'];
    const call = btn.addEventListener.mock.calls.find((c: any[]) => c[0] === 'click');
    return call![1] as () => void;
  }

  it('wires a click listener on btn-record-macro', () => {
    setupMacroRecorder(createMockCtx());
    expect(elements['btn-record-macro'].addEventListener).toHaveBeenCalledWith(
      'click',
      expect.any(Function),
    );
  });

  it('ignores curation events when not recording', () => {
    setupMacroRecorder(createMockCtx());
    pushCut(0, 100);
    events.emit('curation:cut', { contigIndex: 0, position: 100 });
    expect(elements['script-input'].value).toBe('');
  });

  it('fills #script-input with DSL as operations happen while recording', () => {
    setupMacroRecorder(createMockCtx());
    const start = getClickHandler();
    start(); // begin recording (undoStack empty → startDepth 0)
    expect(isMacroRecording()).toBe(true);

    pushCut(0, 100);
    events.emit('curation:cut', { contigIndex: 0, position: 100 });

    expect(elements['script-input'].value).toContain('cut chr1 100');

    pushCut(1, 50);
    events.emit('curation:cut', { contigIndex: 1, position: 50 });
    expect(elements['script-input'].value).toContain('cut chr1 100');
    expect(elements['script-input'].value).toContain('cut chr2 50');
  });

  it('only records ops appended after recording started (snapshots start depth)', () => {
    // Pre-existing op present before recording begins.
    pushCut(0, 999);
    setupMacroRecorder(createMockCtx());
    getClickHandler()(); // start: startDepth = 1

    pushCut(1, 50);
    events.emit('curation:cut', { contigIndex: 1, position: 50 });

    const val = elements['script-input'].value;
    expect(val).toContain('cut chr2 50');
    expect(val).not.toContain('999'); // the pre-existing op is excluded
  });

  it('finalizes and reports the op count when recording stops', () => {
    const ctx = createMockCtx();
    setupMacroRecorder(ctx);
    const toggle = getClickHandler();
    toggle(); // start
    pushCut(0, 100);
    events.emit('curation:cut', { contigIndex: 0, position: 100 });
    toggle(); // stop

    expect(isMacroRecording()).toBe(false);
    expect(ctx.showToast).toHaveBeenCalledWith('Recorded 1 operation(s)');
    expect(elements['script-input'].value).toContain('cut chr1 100');
  });

  it('preserves pre-existing script-input text as a prefix', () => {
    setupMacroRecorder(createMockCtx());
    elements['script-input'].value = 'echo hello';
    getClickHandler()(); // start: basePrefix = "echo hello"
    pushCut(0, 100);
    events.emit('curation:cut', { contigIndex: 0, position: 100 });

    const val = elements['script-input'].value;
    expect(val.startsWith('echo hello')).toBe(true);
    expect(val).toContain('cut chr1 100');
  });

  it('clamps start depth and self-heals when undo goes past the record point', () => {
    // Two pre-existing ops; recording starts at depth 2.
    pushCut(0, 100);
    pushCut(1, 200);
    setupMacroRecorder(createMockCtx());
    getClickHandler()(); // start: startDepth = 2

    // Undo below the record point. In the app, undo pops the stack AND emits
    // 'curation:undo'; the recorder clamps startDepth down to the new length.
    fakeState.undoStack.pop(); // undo op #1 → length 1 (below startDepth 2)
    events.emit('curation:undo', {});
    expect(elements['script-input'].value).not.toContain('cut chr1 100'); // nothing recorded yet

    // A fresh op after the undo is captured (start depth re-anchored to 1).
    pushCut(0, 7);
    events.emit('curation:cut', { contigIndex: 0, position: 7 });
    expect(elements['script-input'].value).toContain('cut chr1 7');
  });
});
