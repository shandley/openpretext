/**
 * ClickInteractions — mousedown/mouseup click handlers for all modes.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';

export function setupClickInteractions(ctx: AppContext, canvas: HTMLCanvasElement): void {
  let mouseDownPos = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };

    // Try to initiate drag reorder in edit mode
    if (ctx.currentMode === 'edit' && ctx.hoveredContigIndex >= 0) {
      ctx.dragReorder.onMouseDown(e.clientX, e.clientY, ctx.hoveredContigIndex);
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    // Handle drag end
    if (ctx.dragReorder.isActive()) {
      ctx.dragReorder.onMouseUp();
      return;
    }

    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > 5 || dy > 5) return;

    if (ctx.currentMode === 'edit' && ctx.hoveredContigIndex >= 0) {
      if (e.shiftKey) {
        SelectionManager.selectRange(ctx.hoveredContigIndex);
      } else if (e.metaKey || e.ctrlKey) {
        SelectionManager.selectToggle(ctx.hoveredContigIndex);
      } else {
        SelectionManager.selectSingle(ctx.hoveredContigIndex);
      }
      ctx.updateSidebarContigList();
      ctx.showToast(`Selected: ${getContigNameAt(ctx.hoveredContigIndex)}`);
    }

    // Scaffold painting mode
    if (ctx.currentMode === 'scaffold' && ctx.hoveredContigIndex >= 0) {
      if (e.shiftKey) {
        ctx.scaffoldManager.paintContigs([ctx.hoveredContigIndex], null);
        ctx.showToast(`Unpainted: ${getContigNameAt(ctx.hoveredContigIndex)}`);
      } else {
        const activeId = ctx.scaffoldManager.getActiveScaffoldId();
        if (activeId !== null) {
          ctx.scaffoldManager.paintContigs([ctx.hoveredContigIndex], activeId);
          const sc = ctx.scaffoldManager.getScaffold(activeId);
          ctx.showToast(`Painted: ${getContigNameAt(ctx.hoveredContigIndex)} → ${sc?.name ?? ''}`);
        } else {
          ctx.showToast('No active scaffold. Press N to create one.');
        }
      }
      ctx.updateSidebarContigList();
      ctx.updateSidebarScaffoldList();
    }

    // Waypoint mode: click to place waypoint, shift+click to remove nearest
    if (ctx.currentMode === 'waypoint') {
      const mapX = ctx.mouseMapPos.x;
      const mapY = ctx.mouseMapPos.y;
      if (mapX >= 0 && mapX <= 1 && mapY >= 0 && mapY <= 1) {
        if (e.shiftKey) {
          // Remove nearest waypoint
          const all = ctx.waypointManager.getAllWaypoints();
          if (all.length > 0) {
            let nearest = all[0];
            let minDist = Infinity;
            for (const wp of all) {
              const d = Math.hypot(wp.mapX - mapX, wp.mapY - mapY);
              if (d < minDist) { minDist = d; nearest = wp; }
            }
            ctx.waypointManager.removeWaypoint(nearest.id);
            if (ctx.currentWaypointId === nearest.id) ctx.currentWaypointId = null;
            ctx.showToast(`Removed waypoint: ${nearest.label}`);
          }
        } else {
          const wp = ctx.waypointManager.addWaypoint(mapX, mapY);
          ctx.currentWaypointId = wp.id;
          ctx.showToast(`Placed: ${wp.label}`);
        }
      }
    }
  });
}

export function getContigNameAt(orderIndex: number): string {
  const s = state.get();
  if (!s.map || orderIndex < 0 || orderIndex >= s.contigOrder.length) return '';
  const contigId = s.contigOrder[orderIndex];
  return s.map.contigs[contigId]?.name ?? '';
}
