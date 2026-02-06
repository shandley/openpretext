/**
 * Color map implementations for Hi-C contact map visualization.
 * Each color map is a function that maps intensity [0,1] to RGBA.
 * We generate a 256-entry lookup texture for GPU-side application.
 */

export type ColorMapName = 'red-white' | 'blue-white-red' | 'viridis' | 'hot' | 'cool' | 'grayscale';

interface RGB {
  r: number;
  g: number;
  b: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

/**
 * Red-White: The classic Hi-C color map.
 * White (no contact) → Red (strong contact)
 */
function redWhite(t: number): RGB {
  return {
    r: 255,
    g: Math.round(255 * (1 - t)),
    b: Math.round(255 * (1 - t)),
  };
}

/**
 * Blue-White-Red: Diverging color map.
 */
function blueWhiteRed(t: number): RGB {
  if (t < 0.5) {
    const s = t * 2;
    return lerpRGB({ r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 255 }, s);
  } else {
    const s = (t - 0.5) * 2;
    return lerpRGB({ r: 255, g: 255, b: 255 }, { r: 255, g: 0, b: 0 }, s);
  }
}

/**
 * Viridis: Perceptually uniform, colorblind-friendly.
 * Approximation using key stops.
 */
function viridis(t: number): RGB {
  const stops: [number, RGB][] = [
    [0.0, { r: 68, g: 1, b: 84 }],
    [0.25, { r: 59, g: 82, b: 139 }],
    [0.5, { r: 33, g: 145, b: 140 }],
    [0.75, { r: 94, g: 201, b: 98 }],
    [1.0, { r: 253, g: 231, b: 37 }],
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const s = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return lerpRGB(stops[i][1], stops[i + 1][1], s);
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Hot: Black → Red → Yellow → White
 */
function hot(t: number): RGB {
  if (t < 0.33) {
    const s = t / 0.33;
    return { r: Math.round(255 * s), g: 0, b: 0 };
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    return { r: 255, g: Math.round(255 * s), b: 0 };
  } else {
    const s = (t - 0.66) / 0.34;
    return { r: 255, g: 255, b: Math.round(255 * s) };
  }
}

/**
 * Cool: Cyan → Magenta
 */
function cool(t: number): RGB {
  return {
    r: Math.round(255 * t),
    g: Math.round(255 * (1 - t)),
    b: 255,
  };
}

/**
 * Grayscale: Black → White
 */
function grayscale(t: number): RGB {
  const v = Math.round(255 * t);
  return { r: v, g: v, b: v };
}

const COLOR_MAP_FUNCTIONS: Record<ColorMapName, (t: number) => RGB> = {
  'red-white': redWhite,
  'blue-white-red': blueWhiteRed,
  'viridis': viridis,
  'hot': hot,
  'cool': cool,
  'grayscale': grayscale,
};

/**
 * Generate a 256×1 RGBA Uint8Array for use as a WebGL texture.
 */
export function getColorMapData(name: ColorMapName): Uint8Array {
  const fn = COLOR_MAP_FUNCTIONS[name] ?? redWhite;
  const data = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const { r, g, b } = fn(t);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }

  return data;
}

export function getColorMapNames(): ColorMapName[] {
  return Object.keys(COLOR_MAP_FUNCTIONS) as ColorMapName[];
}
