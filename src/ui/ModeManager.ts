/**
 * ModeManager — interaction mode switching (navigate, edit, scaffold, waypoint).
 */

import type { AppContext } from './AppContext';
import type { InteractionMode } from '../core/State';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { events } from '../core/EventBus';
import { updateCursor } from './MouseTracking';

export function setMode(ctx: AppContext, mode: InteractionMode): void {
  const previous = ctx.currentMode;
  ctx.currentMode = mode;
  state.update({ mode });

  // Block camera left-click panning in non-navigate modes
  ctx.camera.leftClickBlocked = mode !== 'navigate';

  if (previous === 'edit' && mode !== 'edit') {
    SelectionManager.clearSelection();
  }

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  if (canvas) updateCursor(ctx, canvas);

  document.getElementById('status-mode')!.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  events.emit('mode:changed', { mode, previous });
}
