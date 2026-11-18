import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Camera, type CameraState, type ViewInsets } from '../../src/renderer/Camera';

/** A camera over a canvas of the given CSS size, with no DOM behind it. */
function cameraFor(width: number, height: number): Camera {
  vi.stubGlobal('window', { addEventListener: () => {} });
  const canvas = { clientWidth: width, clientHeight: height, addEventListener: () => {}, style: {} };
  return new Camera(canvas as unknown as HTMLCanvasElement, () => {});
}

/**
 * Where a map coordinate lands on the canvas, in CSS pixels. This is the
 * vertex shader's transform: one map unit is zoom * min(w, h) pixels on both
 * axes, and the camera centre is the canvas centre.
 */
function toScreen(cam: CameraState, w: number, h: number, mx: number, my: number): [number, number] {
  const ppu = cam.zoom * Math.min(w, h);
  return [w / 2 + (mx - cam.x) * ppu, h / 2 + (my - cam.y) * ppu];
}

describe('Camera.frameRegion', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('fills the shorter side of a wide canvas when nothing covers it', () => {
    const cam = cameraFor(1500, 900);
    const s = cam.frameRegion(0.2, 0.2, 0.3, 0.3);
    const [x0, y0] = toScreen(s, 1500, 900, 0.2, 0.2);
    const [x1, y1] = toScreen(s, 1500, 900, 0.3, 0.3);
    expect(y0).toBeCloseTo(0, 6);
    expect(y1).toBeCloseTo(900, 6);
    expect(x0).toBeCloseTo(300, 6);
    expect(x1).toBeCloseTo(1200, 6);
  });

  it('fills the shorter side of a tall canvas when nothing covers it', () => {
    const cam = cameraFor(900, 1400);
    const s = cam.frameRegion(0.5, 0.5, 0.75, 0.75);
    const [x0, y0] = toScreen(s, 900, 1400, 0.5, 0.5);
    const [x1, y1] = toScreen(s, 900, 1400, 0.75, 0.75);
    expect(x0).toBeCloseTo(0, 6);
    expect(x1).toBeCloseTo(900, 6);
    expect(y0).toBeCloseTo(250, 6);
    expect(y1).toBeCloseTo(1150, 6);
  });

  it('keeps the region clear of covered strips and centres it in what is left', () => {
    // A 1500 x 1428 canvas with a 240 px console at the bottom and 200 px of
    // track gutter at the top and left: the free area is 1300 x 988, from
    // (200, 200) to (1500, 1188).
    const insets: ViewInsets = { top: 200, right: 0, bottom: 240, left: 200 };
    const cam = cameraFor(1500, 1428);
    const s = cam.frameRegion(0.1, 0.1, 0.2, 0.2, insets);
    const [x0, y0] = toScreen(s, 1500, 1428, 0.1, 0.1);
    const [x1, y1] = toScreen(s, 1500, 1428, 0.2, 0.2);
    // A square region fills the free area's shorter side (988) ...
    expect(y0).toBeCloseTo(200, 6);
    expect(y1).toBeCloseTo(1188, 6);
    expect(x1 - x0).toBeCloseTo(988, 6);
    // ... and is centred across its longer one.
    expect((x0 + x1) / 2).toBeCloseTo(200 + 1300 / 2, 6);
  });

  it('ignores insets that leave almost nothing', () => {
    const cam = cameraFor(400, 300);
    const covered = cam.frameRegion(0, 0, 0.5, 0.5, { top: 150, right: 0, bottom: 100, left: 0 });
    expect(covered).toEqual(cam.frameRegion(0, 0, 0.5, 0.5));
  });

  it('centres on the region when the zoom limit stops it filling the free area', () => {
    const cam = cameraFor(1000, 1000);
    const insets: ViewInsets = { top: 0, right: 0, bottom: 200, left: 0 };
    const s = cam.frameRegion(0.5, 0.5, 0.5001, 0.5001, insets);
    expect(s.zoom).toBe(cam.maxZoom);
    const [, yMid] = toScreen(s, 1000, 1000, 0.50005, 0.50005);
    expect(yMid).toBeCloseTo(400, 6);
  });
});
