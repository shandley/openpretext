import { describe, it, expect } from 'vitest';
import {
  generateCoverageTrack,
  generateGCContentTrack,
  generateTelomereTrack,
  generateGapTrack,
  generateDemoTracks,
} from '../../src/formats/SyntheticTracks';
import { TrackRenderer, type TrackConfig } from '../../src/renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Track data generation
// ---------------------------------------------------------------------------

describe('SyntheticTracks — data generation', () => {
  const textureSize = 1024;
  const boundaries = [100, 300, 500, 700, 900, 1024];

  it('generateCoverageTrack produces correct length', () => {
    const data = generateCoverageTrack(textureSize);
    expect(data.length).toBe(textureSize);
  });

  it('generateCoverageTrack values are in [0, 1]', () => {
    const data = generateCoverageTrack(textureSize);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('generateCoverageTrack is deterministic with the same seed', () => {
    const a = generateCoverageTrack(512, 42);
    const b = generateCoverageTrack(512, 42);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i], 10);
    }
  });

  it('generateCoverageTrack produces different data with different seeds', () => {
    const a = generateCoverageTrack(512, 42);
    const b = generateCoverageTrack(512, 99);
    let allSame = true;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 0.001) { allSame = false; break; }
    }
    expect(allSame).toBe(false);
  });

  it('generateGCContentTrack produces correct length', () => {
    const data = generateGCContentTrack(textureSize);
    expect(data.length).toBe(textureSize);
  });

  it('generateGCContentTrack values are in [0, 1]', () => {
    const data = generateGCContentTrack(textureSize);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('generateGCContentTrack is smooth (no large jumps between adjacent pixels)', () => {
    const data = generateGCContentTrack(2048);
    let maxDelta = 0;
    for (let i = 1; i < data.length; i++) {
      const delta = Math.abs(data[i] - data[i - 1]);
      if (delta > maxDelta) maxDelta = delta;
    }
    // Smooth data should not have jumps larger than ~0.05 between adjacent pixels
    expect(maxDelta).toBeLessThan(0.1);
  });

  it('generateTelomereTrack produces correct length', () => {
    const data = generateTelomereTrack(textureSize, boundaries);
    expect(data.length).toBe(textureSize);
  });

  it('generateTelomereTrack contains only 0 and 1 values', () => {
    const data = generateTelomereTrack(textureSize, boundaries);
    for (let i = 0; i < data.length; i++) {
      expect(data[i] === 0 || data[i] === 1).toBe(true);
    }
  });

  it('generateTelomereTrack is sparse (mostly zeros)', () => {
    const data = generateTelomereTrack(textureSize, boundaries);
    let nonZero = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) nonZero++;
    }
    // Telomere markers should be very sparse
    expect(nonZero).toBeLessThan(data.length * 0.05);
    // But there should be at least some markers
    expect(nonZero).toBeGreaterThan(0);
  });

  it('generateGapTrack produces correct length', () => {
    const data = generateGapTrack(textureSize, boundaries);
    expect(data.length).toBe(textureSize);
  });

  it('generateGapTrack contains only 0 and 1 values', () => {
    const data = generateGapTrack(textureSize, boundaries);
    for (let i = 0; i < data.length; i++) {
      expect(data[i] === 0 || data[i] === 1).toBe(true);
    }
  });

  it('generateDemoTracks returns all four track types', () => {
    const tracks = generateDemoTracks(textureSize, boundaries);
    expect(tracks.length).toBe(4);

    const names = tracks.map(t => t.name);
    expect(names).toContain('Coverage');
    expect(names).toContain('GC Content');
    expect(names).toContain('Telomeres');
    expect(names).toContain('Gaps');
  });

  it('generateDemoTracks all have correct data length', () => {
    const tracks = generateDemoTracks(textureSize, boundaries);
    for (const track of tracks) {
      expect(track.data.length).toBe(textureSize);
    }
  });

  it('generateDemoTracks data values are in [0, 1]', () => {
    const tracks = generateDemoTracks(textureSize, boundaries);
    for (const track of tracks) {
      for (let i = 0; i < track.data.length; i++) {
        expect(track.data[i]).toBeGreaterThanOrEqual(0);
        expect(track.data[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('works with small texture sizes', () => {
    const data = generateCoverageTrack(16);
    expect(data.length).toBe(16);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('works with large texture sizes', () => {
    const data = generateCoverageTrack(8192);
    expect(data.length).toBe(8192);
  });
});

// ---------------------------------------------------------------------------
// Track configuration management
// ---------------------------------------------------------------------------

describe('TrackRenderer — track management', () => {
  // We create a minimal mock canvas to construct TrackRenderer in a Node env.
  function createMockCanvas(): HTMLCanvasElement {
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      fillRect: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
    };

    return {
      width: 800,
      height: 600,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  }

  function makeTrack(name: string, overrides: Partial<TrackConfig> = {}): TrackConfig {
    return {
      name,
      type: 'line',
      data: new Float32Array(100),
      color: 'rgb(255, 0, 0)',
      height: 30,
      visible: true,
      ...overrides,
    };
  }

  it('starts with no tracks', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    expect(renderer.getTracks().length).toBe(0);
  });

  it('addTrack adds a track', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage'));
    expect(renderer.getTracks().length).toBe(1);
    expect(renderer.getTracks()[0].name).toBe('coverage');
  });

  it('addTrack replaces track with same name', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage', { height: 30 }));
    renderer.addTrack(makeTrack('coverage', { height: 50 }));
    expect(renderer.getTracks().length).toBe(1);
    expect(renderer.getTracks()[0].height).toBe(50);
  });

  it('addTrack can add multiple distinct tracks', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage'));
    renderer.addTrack(makeTrack('gc'));
    renderer.addTrack(makeTrack('telomeres'));
    expect(renderer.getTracks().length).toBe(3);
  });

  it('removeTrack removes an existing track and returns true', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage'));
    renderer.addTrack(makeTrack('gc'));
    const result = renderer.removeTrack('coverage');
    expect(result).toBe(true);
    expect(renderer.getTracks().length).toBe(1);
    expect(renderer.getTracks()[0].name).toBe('gc');
  });

  it('removeTrack returns false for non-existent track', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const result = renderer.removeTrack('nonexistent');
    expect(result).toBe(false);
  });

  it('setTrackVisibility toggles visibility', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage', { visible: true }));
    renderer.setTrackVisibility('coverage', false);
    expect(renderer.getTrack('coverage')!.visible).toBe(false);
    renderer.setTrackVisibility('coverage', true);
    expect(renderer.getTrack('coverage')!.visible).toBe(true);
  });

  it('toggleTrackVisibility flips the current state', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('coverage', { visible: true }));
    renderer.toggleTrackVisibility('coverage');
    expect(renderer.getTrack('coverage')!.visible).toBe(false);
    renderer.toggleTrackVisibility('coverage');
    expect(renderer.getTrack('coverage')!.visible).toBe(true);
  });

  it('setAllVisible sets all tracks', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('a', { visible: true }));
    renderer.addTrack(makeTrack('b', { visible: false }));
    renderer.addTrack(makeTrack('c', { visible: true }));
    renderer.setAllVisible(false);
    for (const t of renderer.getTracks()) {
      expect(t.visible).toBe(false);
    }
    renderer.setAllVisible(true);
    for (const t of renderer.getTracks()) {
      expect(t.visible).toBe(true);
    }
  });

  it('getTrack returns undefined for missing track', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    expect(renderer.getTrack('missing')).toBeUndefined();
  });

  it('clearTracks removes everything', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    renderer.addTrack(makeTrack('a'));
    renderer.addTrack(makeTrack('b'));
    renderer.clearTracks();
    expect(renderer.getTracks().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Coordinate mapping accuracy
// ---------------------------------------------------------------------------

describe('TrackRenderer — coordinate mapping', () => {
  function createMockCanvas(): HTMLCanvasElement {
    const ctx = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
    };
    return {
      width: 800,
      height: 600,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  }

  it('mapToScreenX: center of map at zoom=1 maps to center of canvas', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 800;
    const sx = renderer.mapToScreenX(0.5, cam, w, h);
    expect(sx).toBeCloseTo(400, 0);
  });

  it('mapToScreenY: center of map at zoom=1 maps to center of canvas', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 800;
    const sy = renderer.mapToScreenY(0.5, cam, w, h);
    expect(sy).toBeCloseTo(400, 0);
  });

  it('mapToScreenX: map origin (0) maps correctly at default camera', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 800;
    // mapX=0: (0 - 0.5) * 1 = -0.5 => (-0.5 + 0.5) * 800 = 0
    const sx = renderer.mapToScreenX(0, cam, w, h);
    expect(sx).toBeCloseTo(0, 0);
  });

  it('mapToScreenX: map end (1) maps correctly at default camera', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 800;
    // mapX=1: (1 - 0.5) * 1 = 0.5 => (0.5 + 0.5) * 800 = 800
    const sx = renderer.mapToScreenX(1, cam, w, h);
    expect(sx).toBeCloseTo(800, 0);
  });

  it('zoom doubles the visible range on screen', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 2 };
    const w = 800;
    const h = 800;
    // At zoom 2: mapX=0.25 => (0.25 - 0.5)*2 = -0.5 => (-0.5+0.5)*800 = 0
    const sx = renderer.mapToScreenX(0.25, cam, w, h);
    expect(sx).toBeCloseTo(0, 0);
    // mapX=0.75 => (0.75 - 0.5)*2 = 0.5 => (0.5+0.5)*800 = 800
    const sxEnd = renderer.mapToScreenX(0.75, cam, w, h);
    expect(sxEnd).toBeCloseTo(800, 0);
  });

  it('aspect ratio correction for wide canvas (X axis)', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 1600;
    const h = 800;
    // aspect = 2, mapX=0: (0-0.5)*1 / 2 = -0.25 => (-0.25+0.5)*1600 = 400
    const sx = renderer.mapToScreenX(0, cam, w, h);
    expect(sx).toBeCloseTo(400, 0);
    // mapX=1: (1-0.5)*1 / 2 = 0.25 => (0.25+0.5)*1600 = 1200
    const sxEnd = renderer.mapToScreenX(1, cam, w, h);
    expect(sxEnd).toBeCloseTo(1200, 0);
  });

  it('aspect ratio correction for tall canvas (Y axis)', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    const cam = { x: 0.5, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 1600;
    // aspect = 0.5 (<= 1), mapY=0: (0-0.5)*1*0.5 = -0.25 => (-0.25+0.5)*1600 = 400
    const sy = renderer.mapToScreenY(0, cam, w, h);
    expect(sy).toBeCloseTo(400, 0);
    // mapY=1: (1-0.5)*1*0.5 = 0.25 => (0.25+0.5)*1600 = 1200
    const syEnd = renderer.mapToScreenY(1, cam, w, h);
    expect(syEnd).toBeCloseTo(1200, 0);
  });

  it('panning camera shifts the mapping', () => {
    const renderer = new TrackRenderer(createMockCanvas());
    // Camera shifted to x=0.7 (panned right)
    const cam = { x: 0.7, y: 0.5, zoom: 1 };
    const w = 800;
    const h = 800;
    // mapX=0.7 should map to center: (0.7-0.7)*1 = 0 => (0+0.5)*800 = 400
    const sx = renderer.mapToScreenX(0.7, cam, w, h);
    expect(sx).toBeCloseTo(400, 0);
  });

  it('mapToScreenX and mapToScreenY are consistent with LabelRenderer formulas', () => {
    // We test the math directly: the formulas must be identical to LabelRenderer
    const renderer = new TrackRenderer(createMockCanvas());

    // Test a variety of camera positions and aspect ratios
    const testCases = [
      { cam: { x: 0.5, y: 0.5, zoom: 1 }, w: 800, h: 800 },
      { cam: { x: 0.3, y: 0.7, zoom: 2 }, w: 1200, h: 600 },
      { cam: { x: 0.5, y: 0.5, zoom: 5 }, w: 600, h: 1200 },
      { cam: { x: 0.1, y: 0.9, zoom: 0.8 }, w: 1000, h: 1000 },
    ];

    for (const { cam, w, h } of testCases) {
      for (const mapCoord of [0, 0.25, 0.5, 0.75, 1.0]) {
        // Replicate LabelRenderer formula for X
        const aspect = w / h;
        let screenX = (mapCoord - cam.x) * cam.zoom;
        if (aspect > 1) screenX /= aspect;
        const expectedX = (screenX + 0.5) * w;

        let screenY = (mapCoord - cam.y) * cam.zoom;
        if (aspect <= 1) screenY *= aspect;
        const expectedY = (screenY + 0.5) * h;

        expect(renderer.mapToScreenX(mapCoord, cam, w, h)).toBeCloseTo(expectedX, 5);
        expect(renderer.mapToScreenY(mapCoord, cam, w, h)).toBeCloseTo(expectedY, 5);
      }
    }
  });
});
