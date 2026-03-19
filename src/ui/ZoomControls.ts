/**
 * ZoomControls — zoom indicator + buttons in the bottom-right of the canvas area.
 *
 * Shows current zoom percentage and provides +/- buttons for users
 * whose scroll/trackpad doesn't support zoom gestures.
 */

import type { AppContext } from './AppContext';

const ZOOM_STEP = 1.3;

export function setupZoomControls(ctx: AppContext): void {
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');

  btnIn?.addEventListener('click', () => {
    zoomByFactor(ctx, ZOOM_STEP);
  });

  btnOut?.addEventListener('click', () => {
    zoomByFactor(ctx, 1 / ZOOM_STEP);
  });
}

export function updateZoomLevel(zoom: number): void {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = `${Math.round(zoom * 100)}%`;
}

function zoomByFactor(ctx: AppContext, factor: number): void {
  const cam = ctx.camera;
  const newZoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
  cam.animateTo({ zoom: newZoom }, 150);
}
