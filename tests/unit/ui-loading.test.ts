import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showLoading, updateLoading, hideLoading } from '../../src/ui/LoadingOverlay';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(): any {
  const classes = new Set<string>();
  return {
    textContent: '',
    style: { width: '' },
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      has: (cls: string) => classes.has(cls),
    },
    _classes: classes,
  };
}

// ---------------------------------------------------------------------------
// LoadingOverlay tests
// ---------------------------------------------------------------------------

describe('LoadingOverlay', () => {
  let overlay: ReturnType<typeof createMockElement>;
  let titleEl: ReturnType<typeof createMockElement>;
  let detailEl: ReturnType<typeof createMockElement>;
  let barEl: ReturnType<typeof createMockElement>;
  let percentEl: ReturnType<typeof createMockElement>;

  beforeEach(() => {
    overlay = createMockElement();
    titleEl = createMockElement();
    detailEl = createMockElement();
    barEl = createMockElement();
    percentEl = createMockElement();

    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        switch (id) {
          case 'loading-overlay': return overlay;
          case 'loading-title': return titleEl;
          case 'loading-detail': return detailEl;
          case 'loading-bar': return barEl;
          case 'loading-percent': return percentEl;
          default: return null;
        }
      }),
    } as any;
  });

  afterEach(() => {
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // showLoading
  // -------------------------------------------------------------------------
  describe('showLoading', () => {
    it('should add "visible" class to the overlay', () => {
      showLoading('Loading...');
      expect(overlay.classList.add).toHaveBeenCalledWith('visible');
    });

    it('should set the title text', () => {
      showLoading('Parsing file');
      expect(titleEl.textContent).toBe('Parsing file');
    });

    it('should set the detail text when provided', () => {
      showLoading('Loading', 'Reading contigs...');
      expect(detailEl.textContent).toBe('Reading contigs...');
    });

    it('should set detail to empty string by default', () => {
      showLoading('Loading');
      expect(detailEl.textContent).toBe('');
    });

    it('should reset the progress bar to 0%', () => {
      showLoading('Loading');
      expect(barEl.style.width).toBe('0%');
    });

    it('should reset the percent text to "0%"', () => {
      showLoading('Loading');
      expect(percentEl.textContent).toBe('0%');
    });

    it('should handle missing DOM elements gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      // Should not throw
      expect(() => showLoading('Test')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // updateLoading
  // -------------------------------------------------------------------------
  describe('updateLoading', () => {
    it('should update detail text', () => {
      updateLoading('Processing chunk 3/10', 30);
      expect(detailEl.textContent).toBe('Processing chunk 3/10');
    });

    it('should set progress bar width as percentage', () => {
      updateLoading('Working...', 45);
      expect(barEl.style.width).toBe('45%');
    });

    it('should set percent text', () => {
      updateLoading('Working...', 72);
      expect(percentEl.textContent).toBe('72%');
    });

    it('should clamp progress to 0 (lower bound)', () => {
      updateLoading('Error', -50);
      expect(barEl.style.width).toBe('0%');
      expect(percentEl.textContent).toBe('0%');
    });

    it('should clamp progress to 100 (upper bound)', () => {
      updateLoading('Done', 150);
      expect(barEl.style.width).toBe('100%');
      expect(percentEl.textContent).toBe('100%');
    });

    it('should round progress to nearest integer', () => {
      updateLoading('Working...', 33.7);
      expect(barEl.style.width).toBe('34%');
      expect(percentEl.textContent).toBe('34%');
    });

    it('should handle exactly 0 progress', () => {
      updateLoading('Starting...', 0);
      expect(barEl.style.width).toBe('0%');
      expect(percentEl.textContent).toBe('0%');
    });

    it('should handle exactly 100 progress', () => {
      updateLoading('Complete', 100);
      expect(barEl.style.width).toBe('100%');
      expect(percentEl.textContent).toBe('100%');
    });

    it('should handle missing DOM elements gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(() => updateLoading('Test', 50)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // hideLoading
  // -------------------------------------------------------------------------
  describe('hideLoading', () => {
    it('should remove "visible" class from the overlay', () => {
      hideLoading();
      expect(overlay.classList.remove).toHaveBeenCalledWith('visible');
    });

    it('should handle missing overlay element gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(() => hideLoading()).not.toThrow();
    });
  });
});
