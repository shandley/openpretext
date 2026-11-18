/**
 * ViewFraming: fit a stretch of the diagonal into the part of the map canvas
 * that nothing covers.
 *
 * The script console lies over the bottom of the canvas and the track gutters
 * over its top and left. Fitting a contig to the whole canvas put part of it
 * underneath them.
 */

import type { AppContext } from './AppContext';
import type { ViewInsets } from '../renderer/Camera';

/** Clear space kept between the framed region and the edge of the free area, CSS px. */
const MARGIN_PX = 12;

/** The parts of the map canvas covered by the track gutters and the console, CSS px. */
export function viewInsets(ctx: AppContext): ViewInsets {
  const insets = { top: MARGIN_PX, right: MARGIN_PX, bottom: MARGIN_PX, left: MARGIN_PX };

  if (ctx.tracksVisible && ctx.trackRenderer) {
    const gutter = ctx.trackRenderer.getVisibleTrackHeight();
    insets.top += gutter;
    insets.left += gutter;
  }

  const canvas = document.getElementById('map-canvas');
  const consoleEl = document.getElementById('script-console');
  if (canvas && consoleEl?.classList.contains('visible')) {
    const covered = canvas.getBoundingClientRect().bottom - consoleEl.getBoundingClientRect().top;
    if (covered > 0) insets.bottom += covered;
  }
  return insets;
}

/** Zoom so that the diagonal from `start` to `end` (map units, 0 to 1) fills the uncovered canvas. */
export function frameDiagonalRange(ctx: AppContext, start: number, end: number): void {
  ctx.camera.zoomToRegion(start, start, end, end, viewInsets(ctx));
}
