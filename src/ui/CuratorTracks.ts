/**
 * CuratorTracks - register the curator overlay tracks embedded in a .pretext
 * file (coverage, gaps, telomeres, repeat density) with the TrackRenderer, and
 * keep them aligned with the display order after curation.
 *
 * A single idempotent entry point, called both on file load and after every
 * curation, so there is one place where these tracks are added, removed, and
 * reordered. It removes only its own tracks (tracked by label) and preserves
 * their visibility across a rebuild.
 */

import { state } from '../core/State';
import type { AppContext } from './AppContext';
import { buildEmbeddedTracks } from '../analysis/EmbeddedTracks';

// Labels this module last added. Removing exactly these (rather than the
// current map's labels) also clears leftovers when switching to a file that
// carries no extensions.
let registered: string[] = [];

export function refreshEmbeddedTracks(ctx: AppContext): void {
  const wasVisible = new Map<string, boolean>();
  for (const name of registered) {
    const existing = ctx.trackRenderer.getTrack(name);
    if (existing) wasVisible.set(name, existing.visible);
    ctx.trackRenderer.removeTrack(name);
  }
  registered = [];

  const s = state.get();
  if (s.map) {
    for (const track of buildEmbeddedTracks(s.map, s.contigOrder)) {
      const prev = wasVisible.get(track.name);
      if (prev !== undefined) track.visible = prev;
      ctx.trackRenderer.addTrack(track);
      registered.push(track.name);
    }
  }
  // addTrack / removeTrack already trigger a redraw via the renderer's onChange.
}
