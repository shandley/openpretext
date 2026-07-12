/**
 * OEMapToggle - view the overview contact map as observed/expected (O/E).
 *
 * O/E divides each overview cell by the genome-wide mean contact at its genomic
 * separation, flattening the steep distance-decay so long-range structure (the
 * compartment plaid, off-diagonal enrichments) stands out. It reuses the exact
 * computeExpectedContacts / computeOEMatrix the compartment and saddle analyses
 * are built on, computed on the current display-order overview so the O/E map
 * lines up with the contigs as arranged on screen. This is the O/E map those
 * analyses already run on, shown directly, not a new derivation.
 *
 * Honesty: this transforms only the coarse OVERVIEW matrix. Full-resolution
 * detail tiles carry no genome-wide expectation, so a per-tile O/E is not
 * computable; the tiles stay raw and occlude the O/E layer once you zoom past
 * the overview. The toggle is therefore an overview-zoom diagnostic, labeled as
 * such. The gate texture stays on raw contacts (untouched), so clean-mode
 * suppression is unaffected.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { reorderContactMap } from '../renderer/ContactMapReorder';
import { computeExpectedContacts, computeOEMatrix } from '../analysis/CompartmentAnalysis';
import { getColorMapData, type ColorMapName } from '../renderer/ColorMaps';
import { syncColormapDropdown } from './ColorMapControls';

// log2(O/E) is displayed on [-K, K] -> [0, 1], so O/E spans [2^-K, 2^K] and
// O/E = 1 lands at 0.5 (the white centre of a diverging colour map).
const K = 3;
const OE_COLORMAP: ColorMapName = 'blue-white-red';

let oeActive = false;
let prevColorMap: ColorMapName | null = null;
let prevGamma = 0;
let prevFloor = 0;
let prevCeil = 1;

function overviewSize(): number {
  const s = state.get();
  return s.map?.contactMap ? Math.round(Math.sqrt(s.map.contactMap.length)) : 0;
}

/**
 * Build the O/E display texture: log2(O/E) rescaled to [0, 1], centred so
 * O/E = 1 is 0.5. Cells with no observed contact (O/E 0, or a non-finite ratio
 * from an empty separation) map to the depleted end rather than producing
 * -Infinity/NaN in the texture.
 */
export function buildOEDisplay(oe: Float32Array): Float32Array {
  const out = new Float32Array(oe.length);
  for (let i = 0; i < oe.length; i++) {
    const v = oe[i];
    if (v > 0 && Number.isFinite(v)) {
      const d = (Math.log2(v) + K) / (2 * K);
      out[i] = d < 0 ? 0 : d > 1 ? 1 : d;
    } else {
      out[i] = 0; // no observed contact -> depleted (blue) end
    }
  }
  return out;
}

/** A (value)->[r,g,b] sampler over a colour map's 256-entry RGBA LUT. */
function lutSampler(name: ColorMapName): (v: number) => [number, number, number] {
  const lut = getColorMapData(name);
  return (v: number) => {
    const i = Math.max(0, Math.min(255, Math.round(v * 255))) * 4;
    return [lut[i], lut[i + 1], lut[i + 2]];
  };
}

function applyOE(ctx: AppContext): boolean {
  const s = state.get();
  const original = s.map?.originalContactMap;
  const size = overviewSize();
  if (!s.map || !original || size < 2) return false;

  // O/E of the on-screen arrangement: reorder to display order first, then
  // divide by that arrangement's own distance expectation.
  const display = reorderContactMap(original, s.map.contigs, s.contigOrder, size);
  const expected = computeExpectedContacts(display, size);
  const oe = computeOEMatrix(display, size, expected);
  const oeDisplay = buildOEDisplay(oe);

  // Remember the view state we override so toggling off restores it exactly.
  prevColorMap = ctx.currentColorMap;
  prevGamma = s.gamma;
  prevFloor = s.signalFloor;
  prevCeil = s.signalCeil;

  ctx.renderer.uploadContactMap(oeDisplay, size);
  const sampler = lutSampler(OE_COLORMAP);
  ctx.minimap.updateThumbnail(oeDisplay, size, (v) => sampler(v));

  // Diverging colour map, linear contrast: the ratio is pre-baked into the
  // texture, so gamma/floor/ceil must not reshape it or O/E = 1 drifts off white.
  ctx.currentColorMap = OE_COLORMAP;
  ctx.renderer.setColorMap(OE_COLORMAP);
  syncColormapDropdown(OE_COLORMAP);
  state.update({ gamma: 1, signalFloor: 0, signalCeil: 1 });

  oeActive = true;
  ctx.renderDirty = true;
  return true;
}

function restoreView(ctx: AppContext): void {
  const s = state.get();
  const original = s.map?.originalContactMap;
  const size = overviewSize();
  if (original && size >= 2) {
    const reordered = reorderContactMap(original, s.map!.contigs, s.contigOrder, size);
    ctx.renderer.uploadContactMap(reordered, size);
    ctx.minimap.updateThumbnail(reordered, size);
  }
  if (prevColorMap) {
    ctx.currentColorMap = prevColorMap;
    ctx.renderer.setColorMap(prevColorMap);
    syncColormapDropdown(prevColorMap);
  }
  state.update({ gamma: prevGamma, signalFloor: prevFloor, signalCeil: prevCeil });
  oeActive = false;
  ctx.renderDirty = true;
}

function syncCheckbox(): void {
  const cb = document.getElementById('oe-toggle') as HTMLInputElement | null;
  if (cb) cb.checked = oeActive;
}

/** Flip the O/E view on or off. */
export function toggleOEMap(ctx: AppContext): void {
  if (oeActive) {
    restoreView(ctx);
    ctx.showToast('O/E map: OFF');
  } else {
    if (!applyOE(ctx)) {
      ctx.showToast('Load an assembly first');
      syncCheckbox();
      return;
    }
    ctx.showToast('O/E map: ON (overview only; raw contacts at high zoom)');
  }
  syncCheckbox();
}

/**
 * Force the O/E view off and restore the previous colour map / contrast,
 * without re-uploading (the caller has already uploaded the raw map). Called on
 * curation and file load, where the overview texture is rebuilt from scratch.
 */
export function resetOEMap(ctx: AppContext): void {
  if (!oeActive) return;
  if (prevColorMap) {
    ctx.currentColorMap = prevColorMap;
    ctx.renderer.setColorMap(prevColorMap);
    syncColormapDropdown(prevColorMap);
  }
  state.update({ gamma: prevGamma, signalFloor: prevFloor, signalCeil: prevCeil });
  oeActive = false;
  syncCheckbox();
}

export function isOEActive(): boolean {
  return oeActive;
}

/** Wire the toolbar O/E checkbox. Call once at boot. */
export function setupOEToggle(ctx: AppContext): void {
  const cb = document.getElementById('oe-toggle') as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener('change', () => toggleOEMap(ctx));
}
