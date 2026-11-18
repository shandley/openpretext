import { describe, it, expect, vi } from 'vitest';
import { toggleTracks, revealTracks, showTracks } from '../../src/ui/TrackVisibility';
import type { AppContext } from '../../src/ui/AppContext';

function ctxWith(visible: boolean): AppContext {
  return {
    tracksVisible: visible,
    tracksHiddenByUser: false,
    showToast: vi.fn(),
    requestRender: vi.fn(),
  } as unknown as AppContext;
}

describe('track visibility', () => {
  it('an analysis shows the tracks when nobody has hidden them', () => {
    const ctx = ctxWith(false);
    revealTracks(ctx);
    expect(ctx.tracksVisible).toBe(true);
  });

  it('tracks hidden by hand stay hidden when an analysis finishes', () => {
    const ctx = ctxWith(true);
    toggleTracks(ctx);
    expect(ctx.tracksVisible).toBe(false);
    revealTracks(ctx);
    revealTracks(ctx);
    expect(ctx.tracksVisible).toBe(false);
  });

  it('showing them again by hand lets analyses show them as before', () => {
    const ctx = ctxWith(true);
    toggleTracks(ctx);
    toggleTracks(ctx);
    expect(ctx.tracksVisible).toBe(true);
    expect(ctx.tracksHiddenByUser).toBe(false);
  });

  it('a track file the person loads is shown even after hiding', () => {
    const ctx = ctxWith(true);
    toggleTracks(ctx);
    showTracks(ctx);
    expect(ctx.tracksVisible).toBe(true);
    revealTracks(ctx);
    expect(ctx.tracksVisible).toBe(true);
  });

  it('the toggle announces the new state and redraws', () => {
    const ctx = ctxWith(true);
    toggleTracks(ctx);
    expect(ctx.showToast).toHaveBeenCalledWith('Tracks: hidden');
    expect(ctx.requestRender).toHaveBeenCalled();
  });
});
