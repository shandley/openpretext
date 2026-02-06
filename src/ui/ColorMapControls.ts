/**
 * ColorMapControls — color map cycling and gamma/colormap sync.
 */

import type { AppContext } from './AppContext';
import type { ColorMapName } from '../renderer/ColorMaps';
import { events } from '../core/EventBus';

export function cycleColorMap(ctx: AppContext): void {
  const maps: ColorMapName[] = ['red-white', 'blue-white-red', 'viridis', 'hot', 'cool', 'grayscale'];
  const idx = maps.indexOf(ctx.currentColorMap);
  ctx.currentColorMap = maps[(idx + 1) % maps.length];
  ctx.renderer.setColorMap(ctx.currentColorMap);
  ctx.showToast(`Color map: ${ctx.currentColorMap}`);
  syncColormapDropdown(ctx.currentColorMap);
  events.emit('colormap:changed', { name: ctx.currentColorMap });
}

export function syncGammaSlider(gamma: number): void {
  const slider = document.getElementById('gamma-slider') as HTMLInputElement;
  const label = document.getElementById('gamma-value');
  if (slider) slider.value = String(gamma);
  if (label) label.textContent = gamma.toFixed(2);
}

export function syncColormapDropdown(name: ColorMapName): void {
  const select = document.getElementById('colormap-select') as HTMLSelectElement;
  if (select) select.value = name;
}
