/**
 * Pins mapToCanvas as the exact inverse of canvasToMap.
 *
 * These two transforms must round-trip: a map coordinate converted to canvas
 * pixels and back must land where it started, at any window aspect ratio. They
 * were historically reimplemented by hand in overlay code that omitted the
 * aspect-ratio correction, which misplaced the edit-mode crosshair and the
 * comparison overlay on non-square windows. This test guards against that drift.
 *
 * WebGLRenderer's constructor needs a real WebGL2 context, so we exercise the
 * two pure geometry methods on a prototype instance with a stub canvas instead.
 */

import { describe, it, expect } from 'vitest';
import { WebGLRenderer } from '../../src/renderer/WebGLRenderer';

type Camera = { x: number; y: number; zoom: number };

function makeRenderer(width: number, height: number): WebGLRenderer {
  const r = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  (r as any).canvas = { getBoundingClientRect: () => ({ width, height }) };
  return r;
}

const RECTS: Array<[number, number]> = [
  [800, 600], // landscape (aspect > 1)
  [600, 800], // portrait  (aspect < 1)
  [700, 700], // square    (aspect === 1)
];

const CAMERAS: Camera[] = [
  { x: 0.5, y: 0.5, zoom: 1 },
  { x: 0, y: 0, zoom: 1 },
  { x: 0.3, y: 0.7, zoom: 2.5 },
  { x: 0.62, y: 0.18, zoom: 0.5 },
];

const MAP_POINTS: Array<[number, number]> = [
  [0.5, 0.5],
  [0.126, 0.72],
  [0.0, 1.0],
  [0.585, 0.3],
];

describe('WebGLRenderer map/canvas transforms', () => {
  for (const [w, h] of RECTS) {
    for (const cam of CAMERAS) {
      it(`round-trips map->canvas->map at ${w}x${h}, zoom ${cam.zoom}`, () => {
        const r = makeRenderer(w, h);
        for (const [mx, my] of MAP_POINTS) {
          const px = r.mapToCanvas(mx, my, cam);
          const back = r.canvasToMap(px.x, px.y, cam);
          expect(back.x).toBeCloseTo(mx, 6);
          expect(back.y).toBeCloseTo(my, 6);
        }
      });

      it(`round-trips canvas->map->canvas at ${w}x${h}, zoom ${cam.zoom}`, () => {
        const r = makeRenderer(w, h);
        for (const [cx, cy] of [[0, 0], [w / 2, h / 2], [w, h], [123, 456]] as Array<[number, number]>) {
          const m = r.canvasToMap(cx, cy, cam);
          const px = r.mapToCanvas(m.x, m.y, cam);
          expect(px.x).toBeCloseTo(cx, 4);
          expect(px.y).toBeCloseTo(cy, 4);
        }
      });
    }
  }

  it('places the center map point at the viewport center when centered', () => {
    const r = makeRenderer(800, 600);
    const cam: Camera = { x: 0.5, y: 0.5, zoom: 1 };
    const px = r.mapToCanvas(0.5, 0.5, cam);
    expect(px.x).toBeCloseTo(400, 6);
    expect(px.y).toBeCloseTo(300, 6);
  });
});
