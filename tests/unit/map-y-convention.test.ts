/**
 * Pins the map-space y convention shared by the WebGL layer and every 2D overlay.
 *
 * Map space is genomic: (0,0) is the top-left of the contact matrix and y
 * increases downward. Every overlay transform (tracks, labels, minimap,
 * scaffold/waypoint, drag-reorder) and canvasToMap/mapToCanvas already work
 * that way. Clip space has +y up, so exactly one y flip belongs in each vertex
 * shader and nowhere else.
 *
 * The shaders shipped without that flip while the quad texcoords carried a
 * compensating `1 - y`. The two conventions coincide only at camera.y == 0.5,
 * so any vertical pan slid the map one way and the tracks the other (reported
 * by Carlos, 2026-07), pulled zoom-to-cursor off its anchor row, and placed
 * detail tiles mirrored block-by-block against the overview beneath them.
 *
 * GLSL only executes on a real GL context, so these assertions read the shader
 * source. tests/e2e/map-alignment.spec.ts exercises the compiled result.
 */

import { describe, it, expect } from 'vitest';
import { VERTEX_SHADER, TILE_VERTEX_SHADER } from '../../src/renderer/WebGLRenderer';
import { TrackRenderer } from '../../src/renderer/TrackRenderer';

const SHADERS: Array<[string, string]> = [
  ['overview', VERTEX_SHADER],
  ['tile', TILE_VERTEX_SHADER],
];

describe('map-space y convention', () => {
  for (const [name, src] of SHADERS) {
    it(`${name} vertex shader flips y exactly once on the way to clip space`, () => {
      const flips = src.match(/pos\.y\s*=\s*-\s*pos\.y\s*;/g) ?? [];
      expect(flips).toHaveLength(1);
    });

    it(`${name} vertex shader does not re-flip y in its texcoords`, () => {
      // A `1.0 - <something>.y` in a texcoord assignment cancels the position
      // flip for the sampled data and puts the two halves back out of step.
      expect(src).not.toMatch(/v_(texcoord|overviewcoord)\s*=[^;]*1\.0\s*-/);
    });
  }

  it('overlays place genomic y below the camera centre lower on screen', () => {
    const r = Object.create(TrackRenderer.prototype) as TrackRenderer;
    const cam = { x: 0.5, y: 0.25, zoom: 1 };
    const top = r.mapToScreenY(0, cam, 800, 400);
    const bottom = r.mapToScreenY(1, cam, 800, 400);
    expect(bottom).toBeGreaterThan(top);
    // Genomic 0 sits a quarter of the way down; genomic 1 runs off the bottom.
    expect(top).toBeCloseTo(0.25 * 400, 6);
    expect(bottom).toBeCloseTo(1.25 * 400, 6);
  });
});
