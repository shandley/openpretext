import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(): any {
  const classes = new Set<string>();
  const listeners: Record<string, Function[]> = {};
  return {
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      toggle: vi.fn((cls: string) => {
        if (classes.has(cls)) {
          classes.delete(cls);
        } else {
          classes.add(cls);
        }
      }),
      contains: (cls: string) => classes.has(cls),
      has: (cls: string) => classes.has(cls),
    },
    addEventListener: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    _classes: classes,
    _listeners: listeners,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShortcutsModal', () => {
  let modalEl: ReturnType<typeof createMockElement>;
  let originalDocument: typeof globalThis.document;
  let originalWindow: typeof globalThis.window;
  let windowListeners: Record<string, Function[]>;

  // Re-import for each test to reset module state
  let toggleShortcutsModal: typeof import('../../src/ui/ShortcutsModal').toggleShortcutsModal;
  let setupShortcutsModal: typeof import('../../src/ui/ShortcutsModal').setupShortcutsModal;

  beforeEach(async () => {
    vi.clearAllMocks();

    modalEl = createMockElement();
    windowListeners = {};

    originalDocument = globalThis.document;
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'shortcuts-modal') return modalEl;
        return null;
      }),
    } as any;

    originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener: vi.fn((event: string, cb: Function) => {
        if (!windowListeners[event]) windowListeners[event] = [];
        windowListeners[event].push(cb);
      }),
    } as any;

    vi.resetModules();
    const mod = await import('../../src/ui/ShortcutsModal');
    toggleShortcutsModal = mod.toggleShortcutsModal;
    setupShortcutsModal = mod.setupShortcutsModal;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  // -------------------------------------------------------------------------
  // toggleShortcutsModal
  // -------------------------------------------------------------------------
  describe('toggleShortcutsModal', () => {
    it('should toggle "visible" class on the modal element', () => {
      toggleShortcutsModal();

      expect(modalEl.classList.toggle).toHaveBeenCalledWith('visible');
    });

    it('should do nothing when modal element is not found', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      // Should not throw
      toggleShortcutsModal();

      expect(modalEl.classList.toggle).not.toHaveBeenCalled();
    });

    it('should toggle visibility on repeated calls', () => {
      toggleShortcutsModal(); // becomes visible
      expect(modalEl._classes.has('visible')).toBe(true);

      toggleShortcutsModal(); // becomes hidden
      expect(modalEl._classes.has('visible')).toBe(false);

      toggleShortcutsModal(); // becomes visible again
      expect(modalEl._classes.has('visible')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // setupShortcutsModal
  // -------------------------------------------------------------------------
  describe('setupShortcutsModal', () => {
    it('should do nothing when modal element is not found', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      setupShortcutsModal();

      expect(modalEl.addEventListener).not.toHaveBeenCalled();
    });

    it('should add a click listener to the modal for backdrop close', () => {
      setupShortcutsModal();

      expect(modalEl.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should add a keydown listener to window for Escape key', () => {
      setupShortcutsModal();

      expect(globalThis.window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should close modal when clicking the backdrop (e.target === modal)', () => {
      setupShortcutsModal();

      // Make modal visible first
      modalEl._classes.add('visible');

      // Get the click handler
      const clickCb = modalEl._listeners['click'][0];

      // Simulate click on backdrop (e.target === modal)
      clickCb({ target: modalEl });

      expect(modalEl.classList.remove).toHaveBeenCalledWith('visible');
    });

    it('should NOT close modal when clicking inside modal content (e.target !== modal)', () => {
      setupShortcutsModal();

      // Make modal visible first
      modalEl._classes.add('visible');

      // Get the click handler
      const clickCb = modalEl._listeners['click'][0];

      // Simulate click on some child element inside the modal
      clickCb({ target: { someChild: true } });

      expect(modalEl.classList.remove).not.toHaveBeenCalledWith('visible');
    });

    it('should close modal on Escape key when modal is visible', () => {
      setupShortcutsModal();

      // Make modal visible first
      modalEl._classes.add('visible');

      // Get the keydown handler
      const keydownCb = windowListeners['keydown'][0];

      const event = {
        key: 'Escape',
        stopPropagation: vi.fn(),
      };
      keydownCb(event);

      expect(modalEl.classList.remove).toHaveBeenCalledWith('visible');
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should NOT close modal on Escape key when modal is already hidden', () => {
      setupShortcutsModal();

      // Modal is not visible (no 'visible' class)
      const keydownCb = windowListeners['keydown'][0];

      const event = {
        key: 'Escape',
        stopPropagation: vi.fn(),
      };
      keydownCb(event);

      expect(modalEl.classList.remove).not.toHaveBeenCalledWith('visible');
      expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it('should NOT close modal on non-Escape key press', () => {
      setupShortcutsModal();

      // Make modal visible
      modalEl._classes.add('visible');

      const keydownCb = windowListeners['keydown'][0];

      const event = {
        key: 'Enter',
        stopPropagation: vi.fn(),
      };
      keydownCb(event);

      expect(modalEl.classList.remove).not.toHaveBeenCalledWith('visible');
      expect(event.stopPropagation).not.toHaveBeenCalled();
    });
  });
});
