/**
 * MouseTracking — mouse move/leave handlers, cursor management, drag reorder setup.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { updateTooltip, hideTooltip } from './Tooltip';

export function setupMouseTracking(ctx: AppContext, canvas: HTMLCanvasElement): void {
  canvas.addEventListener('mousemove', (e) => {
    const cam = ctx.camera.getState();
    ctx.mouseMapPos = ctx.renderer.canvasToMap(e.offsetX, e.offsetY, cam);

    // Handle drag reorder in edit mode
    if (ctx.currentMode === 'edit' && ctx.dragReorder.onMouseMove(e.clientX, e.clientY, ctx.mouseMapPos.x, ctx.contigBoundaries)) {
      return; // Dragging, skip normal hover
    }

    const mx = ctx.mouseMapPos.x;
    ctx.hoveredContigIndex = -1;
    const s = state.get();
    if (s.map && mx >= 0 && mx <= 1) {
      let prevBoundary = 0;
      for (let i = 0; i < ctx.contigBoundaries.length; i++) {
        if (mx >= prevBoundary && mx < ctx.contigBoundaries[i]) {
          ctx.hoveredContigIndex = i;
          break;
        }
        prevBoundary = ctx.contigBoundaries[i];
      }
    }

    const posEl = document.getElementById('status-position')!;
    if (s.map && ctx.hoveredContigIndex >= 0) {
      const contigId = s.contigOrder[ctx.hoveredContigIndex];
      const contig = s.map.contigs[contigId];
      posEl.textContent = contig ? contig.name : '\u2014';
    } else {
      posEl.textContent = '\u2014';
    }

    updateCursor(ctx, canvas);
    updateTooltip(ctx, e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseleave', () => {
    ctx.hoveredContigIndex = -1;
    document.getElementById('status-position')!.textContent = '\u2014';
    hideTooltip();
  });
}

export function updateCursor(ctx: AppContext, canvas: HTMLCanvasElement): void {
  switch (ctx.currentMode) {
    case 'navigate':
      canvas.style.cursor = 'grab';
      break;
    case 'edit':
      canvas.style.cursor = ctx.hoveredContigIndex >= 0 ? 'pointer' : 'crosshair';
      break;
    case 'scaffold':
      canvas.style.cursor = 'cell';
      break;
    case 'waypoint':
      canvas.style.cursor = 'crosshair';
      break;
    default:
      canvas.style.cursor = 'default';
  }
}

export function setupDragReorder(ctx: AppContext, canvas: HTMLCanvasElement): void {
  ctx.dragReorder.setup({
    getContigAtPosition: (mapX: number) => {
      let prevBoundary = 0;
      for (let i = 0; i < ctx.contigBoundaries.length; i++) {
        if (mapX >= prevBoundary && mapX < ctx.contigBoundaries[i]) return i;
        prevBoundary = ctx.contigBoundaries[i];
      }
      return -1;
    },
    onDragUpdate: () => {
      canvas.style.cursor = 'grabbing';
    },
    onDragEnd: (moved: boolean) => {
      updateCursor(ctx, canvas);
      if (moved) {
        ctx.refreshAfterCuration();
        ctx.showToast('Contig moved');
      }
    },
  });
}
