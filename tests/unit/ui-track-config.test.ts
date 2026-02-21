import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { updateTrackConfigPanel } from '../../src/ui/TrackConfig';
import type { AppContext } from '../../src/ui/AppContext';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(): any {
  const listeners: Record<string, Function[]> = {};
  const childElements: any[] = [];

  return {
    innerHTML: '',
    querySelectorAll: vi.fn((_selector: string) => childElements),
    _listeners: listeners,
    _childElements: childElements,
  };
}

function createMockChildElement(dataset: Record<string, string>, extras: Record<string, any> = {}): any {
  const listeners: Record<string, Function[]> = {};
  return {
    dataset,
    addEventListener: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    _listeners: listeners,
    ...extras,
  };
}

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
    trackRenderer: {
      getTracks: vi.fn(() => []),
      setTrackVisibility: vi.fn(),
      getTrack: vi.fn(),
      removeTrack: vi.fn(),
    } as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: {} as any,
    camera: {} as any,
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
// Tests
// ---------------------------------------------------------------------------

describe('TrackConfig', () => {
  let trackListEl: ReturnType<typeof createMockElement>;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    vi.clearAllMocks();

    trackListEl = createMockElement();

    originalDocument = globalThis.document;
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'track-config-list') return trackListEl;
        return null;
      }),
    } as any;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  // -------------------------------------------------------------------------
  // updateTrackConfigPanel
  // -------------------------------------------------------------------------
  describe('updateTrackConfigPanel', () => {
    it('should do nothing when track-config-list element is not found', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const ctx = createMockCtx();

      updateTrackConfigPanel(ctx);

      expect(ctx.trackRenderer.getTracks).not.toHaveBeenCalled();
    });

    it('should show empty state message when no tracks are loaded', () => {
      const ctx = createMockCtx();

      updateTrackConfigPanel(ctx);

      expect(trackListEl.innerHTML).toContain('No tracks loaded');
      expect(trackListEl.innerHTML).toContain('Press X to toggle visibility');
    });

    it('should render track items when tracks are available', () => {
      const tracks = [
        { name: 'GC Content', visible: true, color: '#ff0000', type: 'line' },
        { name: 'Coverage', visible: false, color: '#00ff00', type: 'heatmap' },
      ];

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      updateTrackConfigPanel(ctx);

      // Check that tracks are rendered
      expect(trackListEl.innerHTML).toContain('GC Content');
      expect(trackListEl.innerHTML).toContain('Coverage');

      // Check checkbox states
      expect(trackListEl.innerHTML).toContain('checked');
      // 'Coverage' is not visible, so its checkbox should not have 'checked'
      // (The first track has 'checked', the second does not)

      // Check colors are applied
      expect(trackListEl.innerHTML).toContain('#ff0000');
      expect(trackListEl.innerHTML).toContain('#00ff00');

      // Check track types are rendered
      expect(trackListEl.innerHTML).toContain('line');
      expect(trackListEl.innerHTML).toContain('heatmap');
    });

    it('should render track-config-item with data-track-index attributes', () => {
      const tracks = [
        { name: 'Track1', visible: true, color: '#aaa', type: 'line' },
        { name: 'Track2', visible: true, color: '#bbb', type: 'marker' },
      ];

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      updateTrackConfigPanel(ctx);

      expect(trackListEl.innerHTML).toContain('data-track-index="0"');
      expect(trackListEl.innerHTML).toContain('data-track-index="1"');
    });

    it('should render remove buttons for each track', () => {
      const tracks = [
        { name: 'MyTrack', visible: true, color: '#123456', type: 'line' },
      ];

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      updateTrackConfigPanel(ctx);

      expect(trackListEl.innerHTML).toContain('track-remove-btn');
      expect(trackListEl.innerHTML).toContain('data-track-name="MyTrack"');
    });

    it('should render type select with the correct option selected', () => {
      const tracks = [
        { name: 'HeatTrack', visible: true, color: '#000', type: 'heatmap' },
      ];

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      updateTrackConfigPanel(ctx);

      // The heatmap option should be selected
      expect(trackListEl.innerHTML).toContain('value="heatmap" selected');
      // The line option should NOT be selected
      expect(trackListEl.innerHTML).not.toContain('value="line" selected');
    });

    it('should wire up visibility checkbox event listeners', () => {
      const tracks = [
        { name: 'Track1', visible: true, color: '#aaa', type: 'line' },
      ];

      const mockSetVisibility = vi.fn();
      const checkboxEl = createMockChildElement(
        { trackName: 'Track1' },
        { checked: false },
      );

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: mockSetVisibility,
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      // Make querySelectorAll return appropriate elements for each selector
      trackListEl.querySelectorAll = vi.fn((selector: string) => {
        if (selector === '.track-vis-checkbox') return [checkboxEl];
        return [];
      });

      updateTrackConfigPanel(ctx);

      // The checkbox should have an event listener attached
      expect(checkboxEl.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      // Trigger the change event
      const changeCb = checkboxEl._listeners['change'][0];
      changeCb();

      expect(mockSetVisibility).toHaveBeenCalledWith('Track1', false);
    });

    it('should wire up remove button event listeners', () => {
      const tracks = [
        { name: 'RemovableTrack', visible: true, color: '#fff', type: 'line' },
      ];

      const mockRemoveTrack = vi.fn();
      const mockUpdatePanel = vi.fn();
      const mockShowToast = vi.fn();
      const removeBtn = createMockChildElement({ trackName: 'RemovableTrack' });

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: mockRemoveTrack,
        } as any,
        updateTrackConfigPanel: mockUpdatePanel,
        showToast: mockShowToast,
      });

      trackListEl.querySelectorAll = vi.fn((selector: string) => {
        if (selector === '.track-remove-btn') return [removeBtn];
        return [];
      });

      updateTrackConfigPanel(ctx);

      expect(removeBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));

      // Trigger the click event
      const clickCb = removeBtn._listeners['click'][0];
      clickCb();

      expect(mockRemoveTrack).toHaveBeenCalledWith('RemovableTrack');
      expect(mockUpdatePanel).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith('Removed track: RemovableTrack');
    });

    it('should wire up color input event listeners', () => {
      const tracks = [
        { name: 'ColorTrack', visible: true, color: '#ff0000', type: 'line' },
      ];

      const mockTrack = { color: '#ff0000', type: 'line' };
      const colorInput = createMockChildElement(
        { trackName: 'ColorTrack' },
        { value: '#00ff00' },
      );

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(() => mockTrack),
          removeTrack: vi.fn(),
        } as any,
      });

      trackListEl.querySelectorAll = vi.fn((selector: string) => {
        if (selector === '.track-color-input') return [colorInput];
        return [];
      });

      updateTrackConfigPanel(ctx);

      expect(colorInput.addEventListener).toHaveBeenCalledWith('input', expect.any(Function));

      // Trigger the input event
      const inputCb = colorInput._listeners['input'][0];
      inputCb();

      expect(mockTrack.color).toBe('#00ff00');
    });

    it('should wire up type select event listeners', () => {
      const tracks = [
        { name: 'TypeTrack', visible: true, color: '#000', type: 'line' },
      ];

      const mockTrack = { color: '#000', type: 'line' };
      const typeSelect = createMockChildElement(
        { trackName: 'TypeTrack' },
        { value: 'heatmap' },
      );

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(() => mockTrack),
          removeTrack: vi.fn(),
        } as any,
      });

      trackListEl.querySelectorAll = vi.fn((selector: string) => {
        if (selector === '.track-type-select') return [typeSelect];
        return [];
      });

      updateTrackConfigPanel(ctx);

      expect(typeSelect.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      // Trigger the change event
      const changeCb = typeSelect._listeners['change'][0];
      changeCb();

      expect(mockTrack.type).toBe('heatmap');
    });

    it('should render unchecked checkbox for non-visible tracks', () => {
      const tracks = [
        { name: 'HiddenTrack', visible: false, color: '#888', type: 'line' },
      ];

      const ctx = createMockCtx({
        trackRenderer: {
          getTracks: vi.fn(() => tracks),
          setTrackVisibility: vi.fn(),
          getTrack: vi.fn(),
          removeTrack: vi.fn(),
        } as any,
      });

      updateTrackConfigPanel(ctx);

      // The checkbox should NOT have 'checked' (since visible is false)
      // We can verify by checking that the HTML has the checkbox without 'checked'
      expect(trackListEl.innerHTML).toContain('type="checkbox"');
      // It should contain empty string where checked would be
      expect(trackListEl.innerHTML).not.toMatch(/data-track-name="HiddenTrack"[^>]*checked/);
    });
  });
});
