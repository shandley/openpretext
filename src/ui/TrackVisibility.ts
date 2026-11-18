/**
 * TrackVisibility: who may show the tracks.
 *
 * Analyses add tracks when they finish, on load and again after every edit.
 * They used to switch the tracks on each time, so tracks hidden with X came
 * back seconds later. A person's choice to hide them now holds until they
 * show them again, load a track file, or load another assembly.
 */

import type { AppContext } from './AppContext';

/** The X key, the toolbar button and the command palette. */
export function toggleTracks(ctx: AppContext): void {
  ctx.tracksVisible = !ctx.tracksVisible;
  ctx.tracksHiddenByUser = !ctx.tracksVisible;
  ctx.showToast(`Tracks: ${ctx.tracksVisible ? 'visible' : 'hidden'}`);
  ctx.requestRender();
}

/** A track arrived from an analysis: show the tracks unless they were hidden by hand. */
export function revealTracks(ctx: AppContext): void {
  if (!ctx.tracksHiddenByUser) ctx.tracksVisible = true;
}

/** A track the person loaded themselves: show it, whatever was chosen before. */
export function showTracks(ctx: AppContext): void {
  ctx.tracksVisible = true;
  ctx.tracksHiddenByUser = false;
}
