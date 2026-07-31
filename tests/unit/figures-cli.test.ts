/**
 * Argument handling for the figure-capture CLI.
 *
 * Figure panels are only comparable if every panel is captured under the same
 * settings, so the defaults and the flags that change them are worth pinning.
 * The browser work itself needs a real GPU context and is exercised by running
 * the tool; these cover the pure part.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFigureArgs,
  FIGURE_DEFAULTS,
  ALWAYS_HIDDEN,
  CHROME_SELECTORS,
} from '../../bench/figures';

describe('parseFigureArgs', () => {
  it('defaults to a capture big enough for a full-width figure at 300 dpi', () => {
    const a = parseFigureArgs([]);
    // 1600 CSS px at scale 2 is 3200 device px; a 183mm column at 300 dpi needs 2161.
    expect(a.width * a.scale).toBeGreaterThanOrEqual(2161);
    expect(a.element).toBe('#canvas-container');
    expect(a.tracks).toBe(true);
    expect(a.grid).toBe(true);
    expect(a.bare).toBe(false);
    expect(a.hide).toEqual([]);
  });

  it('reads the file and output paths', () => {
    const a = parseFigureArgs(['--pretext', 'm.pretext', '--out', 'f.png']);
    expect(a.pretext).toBe('m.pretext');
    expect(a.out).toBe('f.png');
  });

  it('takes a curation from either a script or a published AGP', () => {
    expect(parseFigureArgs(['--script', 'c.dsl']).script).toBe('c.dsl');
    expect(parseFigureArgs(['--agp', 'pub.agp']).agp).toBe('pub.agp');
  });

  it('turns tracks and grid off', () => {
    const a = parseFigureArgs(['--no-tracks', '--no-grid']);
    expect(a.tracks).toBe(false);
    expect(a.grid).toBe(false);
  });

  it('collects repeated --hide selectors and keeps --bare separate', () => {
    const a = parseFigureArgs(['--hide', '#a', '--hide', '.b', '--bare']);
    expect(a.hide).toEqual(['#a', '.b']);
    expect(a.bare).toBe(true);
  });

  it('does not leak the hide list between calls', () => {
    parseFigureArgs(['--hide', '#first']);
    expect(parseFigureArgs([]).hide).toEqual([]);
    expect(FIGURE_DEFAULTS.hide).toEqual([]);
  });

  it('rejects sizes that would produce no image', () => {
    expect(() => parseFigureArgs(['--width', '0'])).toThrow(/width/);
    expect(() => parseFigureArgs(['--height', '-5'])).toThrow(/height/);
    expect(() => parseFigureArgs(['--scale', 'abc'])).toThrow(/scale/);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseFigureArgs(['--zoom', '4'])).toThrow(/Unknown argument/);
  });
});

describe('figure suppression selectors', () => {
  it('always hides toasts, which appear on timing rather than intent', () => {
    expect(ALWAYS_HIDDEN).toContain('toast');
  });

  it('keeps the minimap and zoom control out of --bare captures', () => {
    expect(CHROME_SELECTORS).toContain('#minimap-canvas');
    expect(CHROME_SELECTORS).toContain('#zoom-controls');
  });
});
