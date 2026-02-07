import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: {
    get: vi.fn(() => ({ showGrid: false, gamma: 1.0 })),
    update: vi.fn(),
  },
}));

vi.mock('../../src/core/EventBus', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('../../src/ui/ExportSession', () => ({
  exportAGP: vi.fn(),
  exportBEDFile: vi.fn(),
  exportFASTAFile: vi.fn(),
  takeScreenshot: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock('../../src/ui/FileLoading', () => ({
  loadExampleDataset: vi.fn(),
}));

vi.mock('../../src/ui/CurationActions', () => ({
  performUndo: vi.fn(),
  performRedo: vi.fn(),
}));

import { setupToolbar } from '../../src/ui/Toolbar';
import { state } from '../../src/core/State';
import { events } from '../../src/core/EventBus';
import { exportAGP, exportBEDFile, exportFASTAFile, takeScreenshot, saveSession } from '../../src/ui/ExportSession';
import { loadExampleDataset } from '../../src/ui/FileLoading';
import { performUndo, performRedo } from '../../src/ui/CurationActions';

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
    comparisonVisible: false,
    renderer: { setColorMap: vi.fn() } as any,
    labelRenderer: {} as any,
    trackRenderer: {} as any,
    scaffoldOverlay: {} as any,
    waypointOverlay: {} as any,
    minimap: { toggle: vi.fn() } as any,
    camera: {} as any,
    dragReorder: {} as any,
    scaffoldManager: {} as any,
    waypointManager: {} as any,
    metricsTracker: {} as any,
    tileManager: null,
    cancelTileDecode: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// DOM mock helpers
// ---------------------------------------------------------------------------

interface MockElement {
  click: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  classList: { toggle: ReturnType<typeof vi.fn> };
  value: string;
  textContent: string;
  dataset: Record<string, string>;
}

function createMockElement(overrides: Partial<MockElement> = {}): MockElement {
  return {
    click: vi.fn(),
    addEventListener: vi.fn(),
    classList: { toggle: vi.fn() },
    value: '',
    textContent: '',
    dataset: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Toolbar', () => {
  let ctx: AppContext;
  let elements: Record<string, MockElement>;
  let dataModeButtons: MockElement[];

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createMockCtx();

    // Set up a registry of mock DOM elements by ID
    elements = {
      'btn-open': createMockElement(),
      'btn-welcome-open': createMockElement(),
      'btn-example': createMockElement(),
      'btn-save-agp': createMockElement(),
      'btn-save-bed': createMockElement(),
      'btn-save-fasta': createMockElement(),
      'btn-load-fasta': createMockElement(),
      'btn-load-track': createMockElement(),
      'btn-screenshot': createMockElement(),
      'btn-save-session': createMockElement(),
      'btn-load-session': createMockElement(),
      'btn-grid': createMockElement(),
      'btn-minimap': createMockElement(),
      'btn-tracks': createMockElement(),
      'btn-sidebar': createMockElement(),
      'btn-undo': createMockElement(),
      'btn-redo': createMockElement(),
      'file-input': createMockElement(),
      'fasta-file-input': createMockElement(),
      'track-file-input': createMockElement(),
      'session-file-input': createMockElement(),
      'sidebar': createMockElement(),
      'colormap-select': createMockElement({ value: 'viridis' }),
      'gamma-slider': createMockElement({ value: '1.50' }),
      'gamma-value': createMockElement(),
    };

    // data-mode buttons
    dataModeButtons = [
      createMockElement({ dataset: { mode: 'edit' } }),
      createMockElement({ dataset: { mode: 'navigate' } }),
      createMockElement({ dataset: { mode: 'scaffold' } }),
    ];

    // Mock document.getElementById
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        return elements[id] ?? null;
      }),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '[data-mode]') {
          return dataModeButtons;
        }
        return [];
      }),
    } as any;
  });

  afterEach(() => {
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // setupToolbar - basic wiring
  // -------------------------------------------------------------------------
  describe('setupToolbar', () => {
    it('should call setMode("navigate") at the end', () => {
      setupToolbar(ctx);
      expect(ctx.setMode).toHaveBeenCalledWith('navigate');
    });

    it('should register click event listeners on all buttons', () => {
      setupToolbar(ctx);

      const buttonsWithClick = [
        'btn-open', 'btn-welcome-open', 'btn-example',
        'btn-save-agp', 'btn-save-bed', 'btn-save-fasta',
        'btn-load-fasta', 'btn-load-track',
        'btn-screenshot', 'btn-save-session', 'btn-load-session',
        'btn-grid', 'btn-minimap', 'btn-tracks', 'btn-sidebar',
        'btn-undo', 'btn-redo',
      ];

      for (const id of buttonsWithClick) {
        expect(elements[id].addEventListener).toHaveBeenCalledWith(
          'click',
          expect.any(Function),
        );
      }
    });

    it('should register change listener on colormap-select', () => {
      setupToolbar(ctx);
      expect(elements['colormap-select'].addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('should register input listener on gamma-slider', () => {
      setupToolbar(ctx);
      expect(elements['gamma-slider'].addEventListener).toHaveBeenCalledWith(
        'input',
        expect.any(Function),
      );
    });

    it('should register click listeners on all data-mode buttons', () => {
      setupToolbar(ctx);
      for (const btn of dataModeButtons) {
        expect(btn.addEventListener).toHaveBeenCalledWith(
          'click',
          expect.any(Function),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Helper to get the registered handler for a given element and event type
  // -------------------------------------------------------------------------
  function getHandler(elementId: string, eventType: string = 'click'): () => void {
    const el = elements[elementId];
    const call = el.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === eventType,
    );
    if (!call) {
      throw new Error(`No '${eventType}' handler registered on '${elementId}'`);
    }
    return call[1];
  }

  function getDataModeHandler(index: number): () => void {
    const btn = dataModeButtons[index];
    const call = btn.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'click',
    );
    if (!call) {
      throw new Error(`No 'click' handler registered on data-mode button ${index}`);
    }
    return call[1];
  }

  // -------------------------------------------------------------------------
  // btn-open -> clicks file-input
  // -------------------------------------------------------------------------
  describe('btn-open', () => {
    it('should click file-input when btn-open is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-open');
      handler();
      expect(elements['file-input'].click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-welcome-open -> clicks file-input
  // -------------------------------------------------------------------------
  describe('btn-welcome-open', () => {
    it('should click file-input when btn-welcome-open is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-welcome-open');
      handler();
      expect(elements['file-input'].click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-example -> calls loadExampleDataset
  // -------------------------------------------------------------------------
  describe('btn-example', () => {
    it('should call loadExampleDataset(ctx) when btn-example is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-example');
      handler();
      expect(loadExampleDataset).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-save-agp -> calls exportAGP
  // -------------------------------------------------------------------------
  describe('btn-save-agp', () => {
    it('should call exportAGP(ctx) when btn-save-agp is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-save-agp');
      handler();
      expect(exportAGP).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-save-bed -> calls exportBEDFile
  // -------------------------------------------------------------------------
  describe('btn-save-bed', () => {
    it('should call exportBEDFile(ctx) when btn-save-bed is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-save-bed');
      handler();
      expect(exportBEDFile).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-save-fasta -> calls exportFASTAFile
  // -------------------------------------------------------------------------
  describe('btn-save-fasta', () => {
    it('should call exportFASTAFile(ctx) when btn-save-fasta is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-save-fasta');
      handler();
      expect(exportFASTAFile).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-load-fasta -> clicks fasta-file-input
  // -------------------------------------------------------------------------
  describe('btn-load-fasta', () => {
    it('should click fasta-file-input when btn-load-fasta is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-load-fasta');
      handler();
      expect(elements['fasta-file-input'].click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-load-track -> clicks track-file-input
  // -------------------------------------------------------------------------
  describe('btn-load-track', () => {
    it('should click track-file-input when btn-load-track is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-load-track');
      handler();
      expect(elements['track-file-input'].click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-screenshot -> calls takeScreenshot
  // -------------------------------------------------------------------------
  describe('btn-screenshot', () => {
    it('should call takeScreenshot(ctx) when btn-screenshot is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-screenshot');
      handler();
      expect(takeScreenshot).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-save-session -> calls saveSession
  // -------------------------------------------------------------------------
  describe('btn-save-session', () => {
    it('should call saveSession(ctx) when btn-save-session is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-save-session');
      handler();
      expect(saveSession).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-load-session -> clicks session-file-input
  // -------------------------------------------------------------------------
  describe('btn-load-session', () => {
    it('should click session-file-input when btn-load-session is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-load-session');
      handler();
      expect(elements['session-file-input'].click).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-grid -> toggles showGrid in state
  // -------------------------------------------------------------------------
  describe('btn-grid', () => {
    it('should toggle showGrid from false to true', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ showGrid: false });
      setupToolbar(ctx);
      const handler = getHandler('btn-grid');
      handler();
      expect(state.update).toHaveBeenCalledWith({ showGrid: true });
    });

    it('should toggle showGrid from true to false', () => {
      (state.get as ReturnType<typeof vi.fn>).mockReturnValue({ showGrid: true });
      setupToolbar(ctx);
      const handler = getHandler('btn-grid');
      handler();
      expect(state.update).toHaveBeenCalledWith({ showGrid: false });
    });
  });

  // -------------------------------------------------------------------------
  // btn-minimap -> calls minimap.toggle()
  // -------------------------------------------------------------------------
  describe('btn-minimap', () => {
    it('should call minimap.toggle() when btn-minimap is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-minimap');
      handler();
      expect(ctx.minimap.toggle).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-tracks -> toggles tracksVisible, shows toast, updates track config
  // -------------------------------------------------------------------------
  describe('btn-tracks', () => {
    it('should toggle tracksVisible from false to true, show toast, and update track config', () => {
      ctx.tracksVisible = false;
      setupToolbar(ctx);
      const handler = getHandler('btn-tracks');
      handler();
      expect(ctx.tracksVisible).toBe(true);
      expect(ctx.showToast).toHaveBeenCalledWith('Tracks: visible');
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });

    it('should toggle tracksVisible from true to false, show toast, and update track config', () => {
      ctx.tracksVisible = true;
      setupToolbar(ctx);
      const handler = getHandler('btn-tracks');
      handler();
      expect(ctx.tracksVisible).toBe(false);
      expect(ctx.showToast).toHaveBeenCalledWith('Tracks: hidden');
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-sidebar -> toggles sidebar visibility, updates panels
  // -------------------------------------------------------------------------
  describe('btn-sidebar', () => {
    it('should toggle sidebar classList and update all three panels', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-sidebar');
      handler();
      expect(elements['sidebar'].classList.toggle).toHaveBeenCalledWith('visible');
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateStatsPanel).toHaveBeenCalled();
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // btn-undo -> calls performUndo
  // -------------------------------------------------------------------------
  describe('btn-undo', () => {
    it('should call performUndo(ctx) when btn-undo is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-undo');
      handler();
      expect(performUndo).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // btn-redo -> calls performRedo
  // -------------------------------------------------------------------------
  describe('btn-redo', () => {
    it('should call performRedo(ctx) when btn-redo is clicked', () => {
      setupToolbar(ctx);
      const handler = getHandler('btn-redo');
      handler();
      expect(performRedo).toHaveBeenCalledWith(ctx);
    });
  });

  // -------------------------------------------------------------------------
  // data-mode buttons -> calls setMode with the mode value
  // -------------------------------------------------------------------------
  describe('data-mode buttons', () => {
    it('should call setMode with "edit" for the edit data-mode button', () => {
      setupToolbar(ctx);
      const handler = getDataModeHandler(0);
      handler();
      expect(ctx.setMode).toHaveBeenCalledWith('edit');
    });

    it('should call setMode with "navigate" for the navigate data-mode button', () => {
      setupToolbar(ctx);
      const handler = getDataModeHandler(1);
      handler();
      // setMode is also called with 'navigate' at setup end, so check the last call
      expect(ctx.setMode).toHaveBeenCalledWith('navigate');
    });

    it('should call setMode with "scaffold" for the scaffold data-mode button', () => {
      setupToolbar(ctx);
      const handler = getDataModeHandler(2);
      handler();
      expect(ctx.setMode).toHaveBeenCalledWith('scaffold');
    });
  });

  // -------------------------------------------------------------------------
  // colormap-select -> updates colormap on renderer, shows toast, emits event
  // -------------------------------------------------------------------------
  describe('colormap-select', () => {
    it('should update currentColorMap, call renderer.setColorMap, show toast, and emit event', () => {
      setupToolbar(ctx);
      // Simulate the select value being 'viridis'
      elements['colormap-select'].value = 'viridis';
      const handler = getHandler('colormap-select', 'change');
      handler();

      expect(ctx.currentColorMap).toBe('viridis');
      expect(ctx.renderer.setColorMap).toHaveBeenCalledWith('viridis');
      expect(ctx.showToast).toHaveBeenCalledWith('Color map: viridis');
      expect(events.emit).toHaveBeenCalledWith('colormap:changed', { name: 'viridis' });
    });

    it('should handle different colormap values', () => {
      setupToolbar(ctx);
      elements['colormap-select'].value = 'hot';
      const handler = getHandler('colormap-select', 'change');
      handler();

      expect(ctx.currentColorMap).toBe('hot');
      expect(ctx.renderer.setColorMap).toHaveBeenCalledWith('hot');
      expect(ctx.showToast).toHaveBeenCalledWith('Color map: hot');
      expect(events.emit).toHaveBeenCalledWith('colormap:changed', { name: 'hot' });
    });
  });

  // -------------------------------------------------------------------------
  // gamma-slider -> updates gamma in state, updates label text
  // -------------------------------------------------------------------------
  describe('gamma-slider', () => {
    it('should update gamma state and label text on input', () => {
      setupToolbar(ctx);
      elements['gamma-slider'].value = '1.50';
      const handler = getHandler('gamma-slider', 'input');
      handler();

      expect(state.update).toHaveBeenCalledWith({ gamma: 1.5 });
      expect(elements['gamma-value'].textContent).toBe('1.50');
    });

    it('should handle gamma value of 0.50', () => {
      setupToolbar(ctx);
      elements['gamma-slider'].value = '0.50';
      const handler = getHandler('gamma-slider', 'input');
      handler();

      expect(state.update).toHaveBeenCalledWith({ gamma: 0.5 });
      expect(elements['gamma-value'].textContent).toBe('0.50');
    });

    it('should handle gamma value of 2.00', () => {
      setupToolbar(ctx);
      elements['gamma-slider'].value = '2.00';
      const handler = getHandler('gamma-slider', 'input');
      handler();

      expect(state.update).toHaveBeenCalledWith({ gamma: 2 });
      expect(elements['gamma-value'].textContent).toBe('2.00');
    });
  });

  // -------------------------------------------------------------------------
  // Graceful handling when DOM elements are missing
  // -------------------------------------------------------------------------
  describe('missing DOM elements', () => {
    it('should not throw when all DOM elements are missing', () => {
      (globalThis.document as any) = {
        getElementById: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
      };

      expect(() => setupToolbar(ctx)).not.toThrow();
    });

    it('should still call setMode("navigate") even when all elements are missing', () => {
      (globalThis.document as any) = {
        getElementById: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      expect(ctx.setMode).toHaveBeenCalledWith('navigate');
    });

    it('should not throw when btn-open exists but file-input does not', () => {
      const btnOpen = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-open') return btnOpen;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      // Trigger the handler -- file-input is null so click should be no-op via ?.
      const call = btnOpen.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
    });

    it('should not throw when btn-load-fasta exists but fasta-file-input does not', () => {
      const btnLoadFasta = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-load-fasta') return btnLoadFasta;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      const call = btnLoadFasta.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
    });

    it('should not throw when btn-load-track exists but track-file-input does not', () => {
      const btnLoadTrack = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-load-track') return btnLoadTrack;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      const call = btnLoadTrack.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
    });

    it('should not throw when btn-load-session exists but session-file-input does not', () => {
      const btnLoadSession = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-load-session') return btnLoadSession;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      const call = btnLoadSession.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
    });

    it('should not throw when btn-sidebar exists but sidebar element does not', () => {
      const btnSidebar = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-sidebar') return btnSidebar;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      const call = btnSidebar.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
      // updateSidebarContigList etc. should still be called
      expect(ctx.updateSidebarContigList).toHaveBeenCalled();
      expect(ctx.updateStatsPanel).toHaveBeenCalled();
      expect(ctx.updateTrackConfigPanel).toHaveBeenCalled();
    });

    it('should not throw when btn-welcome-open exists but file-input does not', () => {
      const btnWelcomeOpen = createMockElement();
      (globalThis.document as any) = {
        getElementById: vi.fn((id: string) => {
          if (id === 'btn-welcome-open') return btnWelcomeOpen;
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
      };

      setupToolbar(ctx);
      const call = btnWelcomeOpen.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'click',
      );
      expect(() => call[1]()).not.toThrow();
    });
  });
});
