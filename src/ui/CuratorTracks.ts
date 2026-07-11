/**
 * CuratorTracks - register the curator overlay tracks (coverage, gaps,
 * telomeres, repeat density) with the TrackRenderer and keep them aligned with
 * the display order after curation.
 *
 * Tracks come from two sources: graph extensions embedded in the .pretext file
 * (by curationpretext), and, for files that lack them, data computed from a
 * loaded reference FASTA (gaps, telomeres). Embedded data always wins for a
 * given track; FASTA-derived data only fills the gaps.
 *
 * A single idempotent entry point, called on file load, after a FASTA loads,
 * and after every curation, so there is one place where these tracks are
 * added, removed, and reordered. It removes only its own tracks (tracked by
 * label) and preserves their visibility across a rebuild.
 */

import { state } from '../core/State';
import type { AppContext } from './AppContext';
import { buildEmbeddedTracks, buildTrackFromExtension, labelForExtension } from '../analysis/EmbeddedTracks';

// Labels this module last added. Removing exactly these (rather than the
// current map's labels) also clears leftovers when switching to a file that
// carries no tracks.
let registered: string[] = [];

export function refreshCuratorTracks(ctx: AppContext): void {
  const wasVisible = new Map<string, boolean>();
  for (const name of registered) {
    const existing = ctx.trackRenderer.getTrack(name);
    if (existing) wasVisible.set(name, existing.visible);
    ctx.trackRenderer.removeTrack(name);
  }
  registered = [];

  const s = state.get();
  if (s.map) {
    const tracks = buildEmbeddedTracks(s.map, s.contigOrder);
    const present = new Set(tracks.map((t) => t.name));

    // Fill any missing tracks from FASTA-derived data (embedded wins).
    if (ctx.fastaTrackData) {
      for (const [name, data] of ctx.fastaTrackData) {
        if (present.has(labelForExtension(name))) continue;
        const track = buildTrackFromExtension(name, data, s.map.contigs, s.contigOrder, s.map.textureSize);
        if (track) {
          tracks.push(track);
          present.add(track.name);
        }
      }
    }

    for (const track of tracks) {
      const prev = wasVisible.get(track.name);
      if (prev !== undefined) track.visible = prev;
      ctx.trackRenderer.addTrack(track);
      registered.push(track.name);
    }
  }
  // addTrack / removeTrack already trigger a redraw via the renderer's onChange.
}
