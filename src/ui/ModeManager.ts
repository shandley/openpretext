/**
 * ModeManager — interaction mode switching (navigate, edit, scaffold, waypoint).
 */

import type { AppContext } from './AppContext';
import type { InteractionMode } from '../core/State';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { events } from '../core/EventBus';
import { updateCursor } from './MouseTracking';

/**
 * One-line reminder shown each time a mode is entered. Kept short and accurate
 * to the actual bindings (see KeyboardShortcuts and ClickInteractions). The
 * toast scales its display time to the message length and pauses on hover.
 */
const MODE_HINTS: Partial<Record<InteractionMode, string>> = {
  navigate: 'Navigate mode: Drag to pan, scroll to zoom.',
  edit: 'Edit mode: Click to select contigs, then drag to reorder. C=cut, F=flip, J=join',
  scaffold: 'Scaffold mode: Click contigs to paint into the active scaffold, Shift+click to unpaint. N=new scaffold.',
  waypoint: 'Waypoint mode: Click to place a waypoint, Shift+click to remove the nearest.',
};

export function setMode(ctx: AppContext, mode: InteractionMode): void {
  const previous = ctx.currentMode;
  ctx.currentMode = mode;
  state.update({ mode });

  // Block camera left-click panning in non-navigate modes
  ctx.camera.leftClickBlocked = mode !== 'navigate';

  // Show the mode's help toast every time it is entered (including re-pressing
  // the same key), so it can always be brought back. Suppressed before a file
  // is loaded so it does not fire during startup (setupToolbar sets navigate).
  const hint = MODE_HINTS[mode];
  if (hint && state.get().map) {
    ctx.showToast(hint);
  }

  if (previous === 'edit' && mode !== 'edit') {
    SelectionManager.clearSelection();
  }

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  if (canvas) updateCursor(ctx, canvas);

  document.getElementById('status-mode')!.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

  // Re-render sidebar so edit mode can add/remove draggable attributes
  ctx.updateSidebarContigList();

  events.emit('mode:changed', { mode, previous });
}
