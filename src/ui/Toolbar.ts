/**
 * Toolbar — button click bindings for the main toolbar.
 */

import type { AppContext } from './AppContext';
import type { InteractionMode } from '../core/State';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import type { ColorMapName } from '../renderer/ColorMaps';
import { exportAGP, exportBEDFile, exportFASTAFile, takeScreenshot, saveSession } from './ExportSession';
import { loadExampleDataset } from './FileLoading';
import { performUndo, performRedo } from './CurationActions';

export function setupToolbar(ctx: AppContext): void {
  document.getElementById('btn-open')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
  document.getElementById('btn-welcome-open')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
  document.getElementById('btn-example')?.addEventListener('click', () => {
    loadExampleDataset(ctx);
  });

  document.getElementById('btn-save-agp')?.addEventListener('click', () => {
    exportAGP(ctx);
  });
  document.getElementById('btn-save-bed')?.addEventListener('click', () => {
    exportBEDFile(ctx);
  });
  document.getElementById('btn-save-fasta')?.addEventListener('click', () => {
    exportFASTAFile(ctx);
  });
  document.getElementById('btn-load-fasta')?.addEventListener('click', () => {
    document.getElementById('fasta-file-input')?.click();
  });
  document.getElementById('btn-load-track')?.addEventListener('click', () => {
    document.getElementById('track-file-input')?.click();
  });

  document.getElementById('btn-screenshot')?.addEventListener('click', () => {
    takeScreenshot(ctx);
  });
  document.getElementById('btn-save-session')?.addEventListener('click', () => {
    saveSession(ctx);
  });
  document.getElementById('btn-load-session')?.addEventListener('click', () => {
    document.getElementById('session-file-input')?.click();
  });

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      ctx.setMode((btn as HTMLElement).dataset.mode as InteractionMode);
    });
  });

  document.getElementById('btn-grid')?.addEventListener('click', () => {
    const s = state.get();
    state.update({ showGrid: !s.showGrid });
  });
  document.getElementById('btn-minimap')?.addEventListener('click', () => {
    ctx.minimap.toggle();
  });
  document.getElementById('btn-tracks')?.addEventListener('click', () => {
    ctx.tracksVisible = !ctx.tracksVisible;
    ctx.showToast(`Tracks: ${ctx.tracksVisible ? 'visible' : 'hidden'}`);
    ctx.updateTrackConfigPanel();
  });
  document.getElementById('btn-sidebar')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('visible');
    ctx.updateSidebarContigList();
    ctx.updateStatsPanel();
    ctx.updateTrackConfigPanel();
  });

  // Color map dropdown
  const colormapSelect = document.getElementById('colormap-select') as HTMLSelectElement;
  colormapSelect?.addEventListener('change', () => {
    ctx.currentColorMap = colormapSelect.value as ColorMapName;
    ctx.renderer.setColorMap(ctx.currentColorMap);
    ctx.showToast(`Color map: ${ctx.currentColorMap}`);
    events.emit('colormap:changed', { name: ctx.currentColorMap });
  });

  // Gamma slider
  const gammaSlider = document.getElementById('gamma-slider') as HTMLInputElement;
  const gammaValue = document.getElementById('gamma-value')!;
  gammaSlider?.addEventListener('input', () => {
    const gamma = parseFloat(gammaSlider.value);
    state.update({ gamma });
    gammaValue.textContent = gamma.toFixed(2);
  });

  document.getElementById('btn-undo')?.addEventListener('click', () => {
    performUndo(ctx);
  });
  document.getElementById('btn-redo')?.addEventListener('click', () => {
    performRedo(ctx);
  });

  ctx.setMode('navigate');
}
