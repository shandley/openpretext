/**
 * Toolbar — button click bindings for the main toolbar.
 */

import type { AppContext } from './AppContext';
import type { InteractionMode } from '../core/State';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import type { ColorMapName } from '../renderer/ColorMaps';
import { exportAGP, exportBEDFile, exportFASTAFile, takeScreenshot, saveSession } from './ExportSession';
import { applyOverviewMode } from './EventWiring';
import { loadExampleDataset, loadDemoData, returnToLanding } from './FileLoading';
import { performUndo, performRedo } from './CurationActions';
import { toggleLessonBrowser } from './LessonBrowser';
import { setupToolbarPopovers } from './ToolbarPopovers';

export function setupToolbar(ctx: AppContext): void {
  setupToolbarPopovers();
  document.getElementById('btn-open')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
  // The wordmark and the File-menu item both return to the landing screen.
  const home = document.getElementById('toolbar-home');
  home?.addEventListener('click', () => returnToLanding(ctx));
  home?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      returnToLanding(ctx);
    }
  });
  document.getElementById('btn-new-file')?.addEventListener('click', () => {
    returnToLanding(ctx);
  });
  document.getElementById('btn-welcome-open')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
  document.getElementById('btn-example')?.addEventListener('click', () => {
    loadExampleDataset(ctx);
  });
  document.getElementById('btn-demo')?.addEventListener('click', () => {
    loadDemoData(ctx);
  });
  document.getElementById('btn-welcome-tutorial')?.addEventListener('click', () => {
    toggleLessonBrowser(ctx);
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
    ctx.requestRender();
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

  // Contrast range (min/max) — rescales contact intensity on both layers.
  const floorSlider = document.getElementById('floor-slider') as HTMLInputElement;
  const floorValue = document.getElementById('floor-value')!;
  const ceilSlider = document.getElementById('ceil-slider') as HTMLInputElement;
  const ceilValue = document.getElementById('ceil-value')!;
  floorSlider?.addEventListener('input', () => {
    let signalFloor = parseFloat(floorSlider.value);
    const ceil = state.get().signalCeil;
    if (signalFloor >= ceil) { signalFloor = Math.max(0, ceil - 0.01); floorSlider.value = String(signalFloor); }
    state.update({ signalFloor });
    floorValue.textContent = signalFloor.toFixed(2);
  });
  ceilSlider?.addEventListener('input', () => {
    let signalCeil = parseFloat(ceilSlider.value);
    const floor = state.get().signalFloor;
    if (signalCeil <= floor) { signalCeil = Math.min(1, floor + 0.01); ceilSlider.value = String(signalCeil); }
    state.update({ signalCeil });
    ceilValue.textContent = signalCeil.toFixed(2);
  });

  // Overview mode (clean ⇄ faithful) — changes how the overview is built and
  // whether the detail layer is gated by it.
  const overviewModeSelect = document.getElementById('overview-mode-select') as HTMLSelectElement;
  overviewModeSelect?.addEventListener('change', async () => {
    const overviewMode = overviewModeSelect.value === 'faithful' ? 'faithful' : 'clean';
    state.update({ overviewMode });
    await applyOverviewMode(ctx);
    ctx.showToast(
      overviewMode === 'faithful'
        ? 'Overview: Faithful — off-diagonal contacts shown at every zoom'
        : 'Overview: Clean — sparse off-diagonal contacts suppressed',
    );
  });

  document.getElementById('btn-undo')?.addEventListener('click', () => {
    performUndo(ctx);
  });
  document.getElementById('btn-redo')?.addEventListener('click', () => {
    performRedo(ctx);
  });

  // Toolbar scroll fade indicator
  const toolbar = document.getElementById('toolbar');
  const scrollFade = document.getElementById('toolbar-scroll-fade');
  if (toolbar && scrollFade) {
    const updateFade = () => {
      const hasOverflow = toolbar.scrollWidth > toolbar.clientWidth;
      const atEnd = toolbar.scrollLeft + toolbar.clientWidth >= toolbar.scrollWidth - 2;
      scrollFade.style.display = hasOverflow && !atEnd ? 'block' : 'none';
    };
    toolbar.addEventListener('scroll', updateFade);
    window.addEventListener('resize', updateFade);
    // The toolbar is display:none on the welcome screen (body.no-file), so it
    // has zero width at init and the scroll-fade would never appear once it's
    // revealed on file load. Recompute whenever its size changes.
    if ('ResizeObserver' in window) {
      new ResizeObserver(updateFade).observe(toolbar);
    }
    updateFade();
  }

  ctx.setMode('navigate');
}
