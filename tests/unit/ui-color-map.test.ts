import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncGammaSlider, syncColormapDropdown } from '../../src/ui/ColorMapControls';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockInput(): any {
  return {
    value: '',
    textContent: '',
  };
}

// ---------------------------------------------------------------------------
// ColorMapControls tests
// ---------------------------------------------------------------------------

describe('ColorMapControls', () => {
  let gammaSlider: ReturnType<typeof createMockInput>;
  let gammaLabel: ReturnType<typeof createMockInput>;
  let colormapSelect: ReturnType<typeof createMockInput>;

  beforeEach(() => {
    gammaSlider = createMockInput();
    gammaLabel = createMockInput();
    colormapSelect = createMockInput();

    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        switch (id) {
          case 'gamma-slider': return gammaSlider;
          case 'gamma-value': return gammaLabel;
          case 'colormap-select': return colormapSelect;
          default: return null;
        }
      }),
    } as any;
  });

  afterEach(() => {
    (globalThis as any).document = undefined;
  });

  // -------------------------------------------------------------------------
  // syncGammaSlider
  // -------------------------------------------------------------------------
  describe('syncGammaSlider', () => {
    it('should set the slider value to the string representation of gamma', () => {
      syncGammaSlider(0.35);
      expect(gammaSlider.value).toBe('0.35');
    });

    it('should set the label text to gamma formatted with 2 decimal places', () => {
      syncGammaSlider(0.35);
      expect(gammaLabel.textContent).toBe('0.35');
    });

    it('should format integer gamma values with 2 decimal places', () => {
      syncGammaSlider(1);
      expect(gammaLabel.textContent).toBe('1.00');
    });

    it('should format gamma = 0 correctly', () => {
      syncGammaSlider(0);
      expect(gammaSlider.value).toBe('0');
      expect(gammaLabel.textContent).toBe('0.00');
    });

    it('should format gamma with many decimal places to 2', () => {
      syncGammaSlider(0.123456);
      expect(gammaLabel.textContent).toBe('0.12');
    });

    it('should handle gamma = 2.5', () => {
      syncGammaSlider(2.5);
      expect(gammaSlider.value).toBe('2.5');
      expect(gammaLabel.textContent).toBe('2.50');
    });

    it('should handle missing slider element gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(() => syncGammaSlider(0.5)).not.toThrow();
    });

    it('should handle missing label element gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === 'gamma-slider') return gammaSlider;
        return null;
      });
      expect(() => syncGammaSlider(0.5)).not.toThrow();
      expect(gammaSlider.value).toBe('0.5');
    });
  });

  // -------------------------------------------------------------------------
  // syncColormapDropdown
  // -------------------------------------------------------------------------
  describe('syncColormapDropdown', () => {
    it('should set the dropdown value to the colormap name', () => {
      syncColormapDropdown('viridis');
      expect(colormapSelect.value).toBe('viridis');
    });

    it('should set "red-white" value', () => {
      syncColormapDropdown('red-white');
      expect(colormapSelect.value).toBe('red-white');
    });

    it('should set "blue-white-red" value', () => {
      syncColormapDropdown('blue-white-red');
      expect(colormapSelect.value).toBe('blue-white-red');
    });

    it('should set "hot" value', () => {
      syncColormapDropdown('hot');
      expect(colormapSelect.value).toBe('hot');
    });

    it('should set "cool" value', () => {
      syncColormapDropdown('cool');
      expect(colormapSelect.value).toBe('cool');
    });

    it('should set "grayscale" value', () => {
      syncColormapDropdown('grayscale');
      expect(colormapSelect.value).toBe('grayscale');
    });

    it('should handle missing select element gracefully', () => {
      (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(() => syncColormapDropdown('viridis')).not.toThrow();
    });
  });
});
