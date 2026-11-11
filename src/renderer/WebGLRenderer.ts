/**
 * WebGL2 renderer for Hi-C contact maps.
 *
 * The map is drawn in one pass over a unit quad. Textures hold the file's
 * data in file order and are never rearranged. For each screen pixel the
 * fragment shader:
 *
 *   1. takes the pixel's display coordinate (curated order),
 *   2. maps it to a file coordinate through the display runs
 *      (core/DisplayMapping), one axis at a time,
 *   3. reads the detail tile holding that file texel if one is loaded,
 *      and the whole-map overview otherwise.
 *
 * Because the overview and the tiles share step 2, they cannot disagree about
 * where a contig is, and a curation edit changes only the small runs texture.
 *
 * A second pass draws the contig grid and the highlight band on top.
 */

import { getColorMapData, type ColorMapName } from './ColorMaps';
import type { DisplayRun } from '../core/DisplayMapping';
import type { DetailTextures } from './TileManager';

/** Width of the runs texture; runs wrap onto further rows past this. */
const RUNS_TEX_WIDTH = 1024;

/** Whether an uploaded map texture is laid out in file or display order. */
export type MapOrder = 'file' | 'display';

// Vertex shader: transforms quad vertices by camera.
// Exported so tests can pin the map-space y convention, which has no other
// automated coverage — GLSL only runs on a real GL context.
export const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texcoord;

uniform vec2 u_camera;    // camera center (0-1 range)
uniform float u_zoom;     // zoom level
uniform vec2 u_resolution; // canvas size

out vec2 v_texcoord;

void main() {
  // Apply camera transform
  vec2 pos = (a_position - u_camera) * u_zoom;

  // Map space is genomic: (0,0) is the top-left of the contact matrix and y
  // increases DOWNWARD, matching every 2D overlay (tracks, labels, minimap,
  // scaffold/waypoint) and canvasToMap/mapToCanvas. Clip space has +y up, so
  // the flip belongs here and nowhere else. Omitting it made camera.y mean the
  // opposite thing to the shader and to the overlays; they agreed only at
  // camera.y == 0.5, so any vertical pan slid the tracks off the map.
  pos.y = -pos.y;

  // Maintain aspect ratio
  float aspect = u_resolution.x / u_resolution.y;
  if (aspect > 1.0) {
    pos.x /= aspect;
  } else {
    pos.y *= aspect;
  }

  gl_Position = vec4(pos * 2.0, 0.0, 1.0);
  v_texcoord = a_texcoord;
}
`;

// Fragment shader: maps display to file coordinates, samples, colours.
// Exported so tests can check its structure; GLSL only runs on a real context.
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2D;

in vec2 v_texcoord;   // display coordinate, 0-1 on each axis

uniform sampler2D u_contactMap;   // whole-map overview, R8, mipmapped
uniform sampler2D u_colorMap;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform float u_gamma;
uniform float u_floor;   // contrast range minimum (hidden at/below)
uniform float u_ceil;    // contrast range maximum (saturated at/above)
uniform bool u_showGrid;
uniform float u_gridOpacity;
uniform int u_numContigs;
uniform float u_highlightStart;
uniform float u_highlightEnd;
uniform bool u_hasHighlight;
// false: draw the contact map. true: draw only the grid and highlight, with
// alpha, so they can be laid over what is already in the framebuffer.
uniform bool u_overlayOnly;

// Contig boundaries (normalized 0-1, sorted ascending) in an R32F texture,
// width = u_numContigs, height = 1. Sampled via texelFetch + binary search.
uniform highp sampler2D u_boundaryTex;

// Display runs, one RGBA32F texel each, laid out row-major in rows of
// ${RUNS_TEX_WIDTH}: (displayStart, length, fileStart, reversed), in
// full-resolution texels. Sorted by displayStart. See core/DisplayMapping.
uniform highp sampler2D u_runsTex;
uniform int u_numRuns;
uniform float u_totalTexels;      // texels along one axis of the full map

// Overview sampling.
uniform bool u_baseInFileOrder;   // false for views computed in display order
uniform float u_baseSize;         // overview texels per side
uniform bool u_baseSnap;          // magnified: read the single nearest texel
uniform float u_baseLod;          // minified: mip level that averages a pixel

// Detail tiles of the level on screen, in file coordinates.
uniform bool u_detailEnabled;
uniform highp sampler2DArray u_tiles;
uniform highp usampler2D u_pageTable;   // 0 = not loaded, else layer + 1
uniform int u_tilesPerDim;
uniform int u_tileRes;

out vec4 fragColor;

float applyGamma(float value, float gamma) {
  return pow(clamp(value, 0.0, 1.0), gamma);
}

float boundaryAt(int i) {
  return texelFetch(u_boundaryTex, ivec2(i, 0), 0).r;
}

// Distance from coordinate c to the nearest contig boundary, via binary search
// over the sorted boundary texture (~log2(numContigs) fetches, independent of
// contig count). Boundaries are guaranteed ascending (accumulated pixel spans).
float nearestBoundaryDist(float c, int n) {
  int lo = 0;
  int hi = n; // exclusive upper bound
  for (int iter = 0; iter < 24; iter++) { // 2^24 >> any real contig count
    if (lo >= hi) break;
    int mid = (lo + hi) / 2;
    if (boundaryAt(mid) < c) lo = mid + 1;
    else hi = mid;
  }
  // lo = first index with boundary >= c (or n). Nearest is lo or lo-1.
  float d = 1.0;
  if (lo < n)      d = min(d, abs(boundaryAt(lo) - c));
  if (lo - 1 >= 0) d = min(d, abs(c - boundaryAt(lo - 1)));
  return d;
}

float gridDistance(vec2 uv, int numContigs) {
  if (numContigs <= 0) return 1.0;
  return min(nearestBoundaryDist(uv.x, numContigs),
             nearestBoundaryDist(uv.y, numContigs));
}

vec4 runAt(int i) {
  return texelFetch(u_runsTex, ivec2(i % ${RUNS_TEX_WIDTH}, i / ${RUNS_TEX_WIDTH}), 0);
}

// Display texel coordinate -> file texel coordinate along one axis. Must
// match DisplayMapping.displayToFileCoord. With no runs it is the identity.
float displayToFile(float u) {
  if (u_numRuns <= 0) return u;
  // Last run whose displayStart <= u.
  int lo = 0;
  int hi = u_numRuns - 1;
  for (int iter = 0; iter < 24; iter++) {
    if (lo >= hi) break;
    int mid = (lo + hi + 1) / 2;
    if (runAt(mid).r <= u) lo = mid;
    else hi = mid - 1;
  }
  vec4 run = runAt(lo);
  float t = clamp(u - run.r, 0.0, run.g);
  float f = run.a > 0.5 ? run.b + run.g - t : run.b + t;
  // Keep the result inside the run's own file span, so a pixel centre that
  // lands exactly on a run edge never reads the neighbouring texel.
  return clamp(f, run.b, run.b + run.g - 0.015625);
}

// Overlay accumulator: premultiplied colour and remaining transmittance.
vec3 ovColor = vec3(0.0);
float ovTrans = 1.0;
void overlay(vec3 c, float a) {
  ovColor = ovColor * (1.0 - a) + c * a;
  ovTrans *= (1.0 - a);
}

void main() {
  if (!u_overlayOnly) {
    vec2 uDisplay = v_texcoord * u_totalTexels;
    vec2 uFile = vec2(displayToFile(uDisplay.x), displayToFile(uDisplay.y));

    float intensity = 0.0;
    bool haveDetail = false;

    // A loaded detail tile is authoritative for the texels it holds. It is
    // read with texelFetch: one stored value per fragment, never a blend
    // with a neighbouring texel, which after curation may belong to a
    // different contig.
    if (u_detailEnabled) {
      float texelsPerTile = u_totalTexels / float(u_tilesPerDim);
      vec2 tileCoord = uFile / texelsPerTile;
      ivec2 tile = clamp(ivec2(floor(tileCoord)), ivec2(0), ivec2(u_tilesPerDim - 1));
      uint slot = texelFetch(u_pageTable, tile, 0).r;
      if (slot > 0u) {
        vec2 within = tileCoord - vec2(tile);
        ivec2 px = clamp(ivec2(floor(within * float(u_tileRes))), ivec2(0), ivec2(u_tileRes - 1));
        intensity = texelFetch(u_tiles, ivec3(px, int(slot) - 1), 0).r;
        haveDetail = true;
      }
    }

    if (!haveDetail) {
      vec2 b = (u_baseInFileOrder ? uFile : uDisplay) / u_totalTexels;
      // Magnified: snap to the texel centre so the result is that one stored
      // value. Minified: average the texels under the pixel with an explicit
      // mip level. (Derivative-based level selection would misfire at run
      // seams, where the file coordinate jumps.)
      if (u_baseSnap) b = (floor(b * u_baseSize) + 0.5) / u_baseSize;
      intensity = textureLod(u_contactMap, b, u_baseLod).r;
    }

    // Rescale to the [floor, ceil] contrast range: <=floor -> 0 (background),
    // >=ceil -> 1 (saturated), linear in between. Then gamma correct.
    float t = clamp((intensity - u_floor) / max(u_ceil - u_floor, 1e-5), 0.0, 1.0);
    float mapped = applyGamma(t, u_gamma);

    // Look up color from the 1D color map texture
    fragColor = texture(u_colorMap, vec2(mapped, 0.5));
    return;
  }

  // Grid overlay with anti-aliased dark lines
  if (u_showGrid) {
    float dist = gridDistance(v_texcoord, u_numContigs);
    // Constant on-screen width. The map's unit square spans
    // zoom * min(resolution) device pixels, so this is a 1.5 px falloff at
    // every zoom. (A width fixed in map units grows into a thick band.)
    float lineWidth = 1.5 / (u_zoom * min(u_resolution.x, u_resolution.y));
    float line = 1.0 - smoothstep(0.0, lineWidth, dist);
    overlay(vec3(0.0), line * u_gridOpacity);
  }

  // Highlight selected/hovered contig
  if (u_hasHighlight) {
    bool inHighlightX = v_texcoord.x >= u_highlightStart && v_texcoord.x <= u_highlightEnd;
    bool inHighlightY = v_texcoord.y >= u_highlightStart && v_texcoord.y <= u_highlightEnd;
    // Brighten the cross-hair region, more strongly at the intersection
    if (inHighlightX || inHighlightY) overlay(vec3(1.0, 1.0, 0.5), 0.15);
    if (inHighlightX && inHighlightY) overlay(vec3(1.0, 1.0, 0.3), 0.12);
  }

  float alpha = 1.0 - ovTrans;
  if (alpha <= 0.0) discard;
  fragColor = vec4(ovColor / alpha, alpha);
}
`;

export interface RenderOptions {
  gamma?: number;
  floor?: number;
  ceil?: number;
  showGrid?: boolean;
  gridOpacity?: number;
  contigBoundaries?: number[];
  highlightStart?: number;
  highlightEnd?: number;
  /**
   * The curated layout (DerivedState.getDisplayRuns) and the map's width in
   * full-resolution texels. Omitted: display equals file order.
   */
  displayRuns?: DisplayRun[];
  totalTexels?: number;
  /** Loaded detail tiles to draw in place of the overview where present. */
  detail?: DetailTextures | null;
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private program: WebGLProgram | null = null;

  // Textures
  private contactMapTexture: WebGLTexture | null = null;
  private colorMapTexture: WebGLTexture | null = null;

  // Geometry
  private vao: WebGLVertexArrayObject | null = null;

  // Uniforms
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  // Display runs live in an RGBA32F texture, re-uploaded only when the runs
  // array reference changes (DerivedState memoizes it per order/map change).
  private runsTexture: WebGLTexture | null = null;
  private runsCount = 0;
  private lastRunsRef: DisplayRun[] | null = null;

  // Placeholders bound to the detail samplers when no tiles are drawn, so
  // every sampler always has a complete texture of its own type.
  private emptyArrayTexture: WebGLTexture | null = null;
  private emptyPageTable: WebGLTexture | null = null;

  /** Layout of the uploaded map texture. */
  private baseOrder: MapOrder = 'file';
  /** The data last uploaded, so callers can skip a redundant re-upload. */
  private baseDataRef: Float32Array | null = null;

  // State
  private textureSize: number = 0;
  private needsRender: boolean = true;

  // Contig boundaries live in an R32F texture (width = numContigs, height = 1),
  // sampled in the shader via binary search. Re-uploaded only when the
  // boundaries array reference changes (DerivedState memoizes it). This lifts
  // the old fixed 512-boundary uniform cap — any contig count is supported.
  private boundaryTexture: WebGLTexture | null = null;
  private boundaryTexCount = 0;
  private lastBoundariesRef: number[] | null = null;

  private floatLinearSupported: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // needed for screenshots
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.gl = gl;

    // Enable float texture linear filtering if available
    this.floatLinearSupported = !!gl.getExtension('OES_texture_float_linear');

    this.init();
  }

  private init(): void {
    const gl = this.gl;
    
    // Compile shaders
    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    
    if (!vs || !fs) return;
    
    // Link program
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(this.program));
      return;
    }
    
    // Get uniform locations
    const uniformNames = [
      'u_camera', 'u_zoom', 'u_resolution', 'u_contactMap', 'u_colorMap',
      'u_gamma', 'u_floor', 'u_ceil', 'u_showGrid', 'u_gridOpacity', 'u_numContigs', 'u_boundaryTex',
      'u_highlightStart', 'u_highlightEnd', 'u_hasHighlight', 'u_overlayOnly',
      'u_runsTex', 'u_numRuns', 'u_totalTexels',
      'u_baseInFileOrder', 'u_baseSize', 'u_baseSnap', 'u_baseLod',
      'u_detailEnabled', 'u_tiles', 'u_pageTable', 'u_tilesPerDim', 'u_tileRes',
    ];
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    
    // Create fullscreen quad
    this.createQuad();
    
    // Create default color map texture
    this.setColorMap('red-white');

    this.createPlaceholders();

    // Set up blending
    // Colour blends by source alpha; destination alpha is kept at 1 so the
    // overlay pass never makes the canvas see-through to the page behind it.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  private createQuad(): void {
    const gl = this.gl;
    
    // Fullscreen quad covering 0-1 range (will be transformed by camera).
    // Texcoord equals position: map space and data space are the same
    // genomic, y-down coordinates, so data row 0 sits at map y 0. The vertex
    // shader flips y once on the way to clip space.
    const vertices = new Float32Array([
      // position (x,y), texcoord (u,v)
      0, 0,   0, 0,
      1, 0,   1, 0,
      0, 1,   0, 1,
      1, 1,   1, 1,
    ]);
    
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    const posLoc = gl.getAttribLocation(this.program!, 'a_position');
    const texLoc = gl.getAttribLocation(this.program!, 'a_texcoord');
    
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
    
    gl.bindVertexArray(null);
  }

  /**
   * Upload the whole-map texture.
   * Data should be a Float32Array of intensity values [0,1] in row-major order.
   *
   * @param order 'file' for the file's own data, which the shader lays out in
   *   the curated order itself. 'display' for a view already computed in the
   *   curated order (for example observed/expected), which is drawn as is.
   */
  uploadContactMap(data: Float32Array, size: number, order: MapOrder = 'file'): void {
    const gl = this.gl;
    this.baseOrder = order;
    this.baseDataRef = data;
    
    if (this.contactMapTexture) {
      gl.deleteTexture(this.contactMapTexture);
    }
    
    this.contactMapTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.contactMapTexture);
    
    // Convert float data to R8 normalized for maximum compatibility
    const u8data = new Uint8Array(size * size);
    for (let i = 0; i < data.length; i++) {
      u8data[i] = Math.round(Math.min(1.0, Math.max(0.0, data[i])) * 255);
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      size, size, 0,
      gl.RED, gl.UNSIGNED_BYTE, u8data
    );

    // Mipmaps: when the map is drawn smaller than the texture, each screen
    // pixel must show the average of the texels under it. Without them the
    // sampler picks single texels, so isolated contacts appear or vanish
    // depending on where the pixel grid happens to fall.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    this.textureSize = size;
    this.needsRender = true;
  }

  /** Side of the uploaded map texture in texels (0 before any upload). */
  get mapTextureSize(): number {
    return this.textureSize;
  }

  /** True when `data` is the array currently uploaded as the map texture. */
  isCurrentMap(data: Float32Array): boolean {
    return this.baseDataRef === data;
  }

  /** 1x1 textures for the detail samplers when no tiles are being drawn. */
  private createPlaceholders(): void {
    const gl = this.gl;
    this.emptyArrayTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emptyArrayTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, 1, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

    this.emptyPageTable = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.emptyPageTable);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Upload the display runs into an RGBA32F texture the shader binary
   * searches. A count of 0 makes the shader treat display as file order.
   */
  private uploadRunsTexture(runs: DisplayRun[]): void {
    const gl = this.gl;
    if (this.runsTexture) {
      gl.deleteTexture(this.runsTexture);
      this.runsTexture = null;
    }
    this.runsCount = runs.length;
    if (runs.length === 0) return;

    const rows = Math.ceil(runs.length / RUNS_TEX_WIDTH);
    const data = new Float32Array(RUNS_TEX_WIDTH * rows * 4);
    runs.forEach((run, i) => {
      data[i * 4] = run.displayStart;
      data[i * 4 + 1] = run.length;
      data[i * 4 + 2] = run.fileStart;
      data[i * 4 + 3] = run.reversed ? 1 : 0;
    });
    this.runsTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.runsTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, RUNS_TEX_WIDTH, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Set the color map used for rendering.
   */
  setColorMap(name: ColorMapName): void {
    const gl = this.gl;
    const data = getColorMapData(name);
    
    if (this.colorMapTexture) {
      gl.deleteTexture(this.colorMapTexture);
    }
    
    this.colorMapTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.colorMapTexture);
    
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8,
      256, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, data
    );
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    this.needsRender = true;
  }

  /**
   * Upload the sorted-ascending contig boundaries (normalized [0,1]) into an
   * R32F width×1 texture that the grid shader binary-searches. Replaces the
   * previous texture; a count of 0 leaves no texture (grid draws nothing).
   */
  private uploadBoundaryTexture(boundaries: number[]): void {
    const gl = this.gl;
    if (this.boundaryTexture) {
      gl.deleteTexture(this.boundaryTexture);
      this.boundaryTexture = null;
    }
    this.boundaryTexCount = boundaries.length;
    if (boundaries.length === 0) return;

    const data = new Float32Array(boundaries);
    this.boundaryTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.boundaryTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F,
      boundaries.length, 1, 0,
      gl.RED, gl.FLOAT, data,
    );
    // NEAREST: R32F is not guaranteed linearly filterable, and texelFetch
    // ignores filtering regardless.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Render the contact map with current camera and settings.
   */
  /**
   * Blank the canvas to the background colour without drawing a map. Used when
   * no assembly is loaded (e.g. after returning to the landing screen) so a
   * previous map does not persist behind the welcome overlay.
   */
  clear(): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.125, 0.114, 0.102, 1.0); // warm charcoal, matches --bg-primary
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  render(camera: { x: number; y: number; zoom: number }, options: RenderOptions = {}): void {
    const gl = this.gl;
    
    // Resize canvas to match display size
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);
    
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }
    
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.125, 0.114, 0.102, 1.0); // warm charcoal, matches --bg-primary
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    if (!this.contactMapTexture || !this.program) return;
    
    gl.useProgram(this.program);
    
    // Set uniforms
    gl.uniform2f(this.uniforms['u_camera']!, camera.x, camera.y);
    gl.uniform1f(this.uniforms['u_zoom']!, camera.zoom);
    gl.uniform2f(this.uniforms['u_resolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.uniforms['u_gamma']!, options.gamma ?? 0.5);
    gl.uniform1f(this.uniforms['u_floor']!, options.floor ?? 0);
    gl.uniform1f(this.uniforms['u_ceil']!, options.ceil ?? 1);
    gl.uniform1i(this.uniforms['u_overlayOnly']!, 0);

    // Display mapping.
    const runs = options.displayRuns ?? [];
    if (runs !== this.lastRunsRef) {
      this.uploadRunsTexture(runs);
      this.lastRunsRef = runs;
    }
    const totalTexels = options.totalTexels ?? this.textureSize;
    gl.uniform1i(this.uniforms['u_numRuns']!, this.runsCount);
    gl.uniform1f(this.uniforms['u_totalTexels']!, totalTexels);

    // Overview sampling: one texel per fragment when magnified, an averaging
    // mip level when minified.
    const pxAcrossMap = camera.zoom * Math.min(gl.drawingBufferWidth, gl.drawingBufferHeight);
    const texelPx = pxAcrossMap / Math.max(1, this.textureSize);
    const snap = texelPx >= 1;
    gl.uniform1i(this.uniforms['u_baseInFileOrder']!, this.baseOrder === 'file' ? 1 : 0);
    gl.uniform1f(this.uniforms['u_baseSize']!, this.textureSize);
    gl.uniform1i(this.uniforms['u_baseSnap']!, snap ? 1 : 0);
    gl.uniform1f(this.uniforms['u_baseLod']!, snap ? 0 : Math.log2(1 / texelPx));

    // Bind textures. Every sampler gets its own unit and a texture of its own
    // type, whether or not this frame uses it.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.contactMapTexture);
    gl.uniform1i(this.uniforms['u_contactMap']!, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorMapTexture);
    gl.uniform1i(this.uniforms['u_colorMap']!, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.boundaryTexture);
    gl.uniform1i(this.uniforms['u_boundaryTex']!, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.runsTexture);
    gl.uniform1i(this.uniforms['u_runsTex']!, 3);

    const detail = options.detail ?? null;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, detail ? detail.tiles : this.emptyArrayTexture);
    gl.uniform1i(this.uniforms['u_tiles']!, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, detail ? detail.pageTable : this.emptyPageTable);
    gl.uniform1i(this.uniforms['u_pageTable']!, 5);
    gl.uniform1i(this.uniforms['u_detailEnabled']!, detail ? 1 : 0);
    gl.uniform1i(this.uniforms['u_tilesPerDim']!, detail ? detail.tilesPerDim : 1);
    gl.uniform1i(this.uniforms['u_tileRes']!, detail ? detail.tileRes : 1);

    // Draw
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    this.renderOverlay(camera, options);
  }

  /**
   * Draw the contig grid and the highlight band over the map already in the
   * framebuffer. render() calls this itself.
   */
  renderOverlay(camera: { x: number; y: number; zoom: number }, options: RenderOptions = {}): void {
    const gl = this.gl;
    if (!this.program) return;

    const showGrid = options.showGrid ?? false;
    const hasHighlight = options.highlightStart !== undefined && options.highlightEnd !== undefined;
    if (!showGrid && !hasHighlight) return;

    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms['u_camera']!, camera.x, camera.y);
    gl.uniform1f(this.uniforms['u_zoom']!, camera.zoom);
    gl.uniform2f(this.uniforms['u_resolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1i(this.uniforms['u_overlayOnly']!, 1);
    gl.uniform1i(this.uniforms['u_showGrid']!, showGrid ? 1 : 0);
    gl.uniform1f(this.uniforms['u_gridOpacity']!, options.gridOpacity ?? 0.5);

    // Contig boundaries: upload to an R32F texture only when the array
    // reference changes (DerivedState memoizes it per order/map change). The
    // shader binary-searches it, so any contig count is supported.
    const boundaries = options.contigBoundaries ?? [];
    if (boundaries !== this.lastBoundariesRef) {
      this.uploadBoundaryTexture(boundaries);
      this.lastBoundariesRef = boundaries;
    }
    gl.uniform1i(this.uniforms['u_numContigs']!, this.boundaryTexCount);

    gl.uniform1i(this.uniforms['u_hasHighlight']!, hasHighlight ? 1 : 0);
    if (hasHighlight) {
      gl.uniform1f(this.uniforms['u_highlightStart']!, options.highlightStart!);
      gl.uniform1f(this.uniforms['u_highlightEnd']!, options.highlightEnd!);
    }

    // Same sampler-to-unit assignment as the map pass.
    gl.uniform1i(this.uniforms['u_contactMap']!, 0);
    gl.uniform1i(this.uniforms['u_colorMap']!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.boundaryTexture);
    gl.uniform1i(this.uniforms['u_boundaryTex']!, 2);
    gl.uniform1i(this.uniforms['u_runsTex']!, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.emptyArrayTexture);
    gl.uniform1i(this.uniforms['u_tiles']!, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.emptyPageTable);
    gl.uniform1i(this.uniforms['u_pageTable']!, 5);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Get a screenshot as a data URL.
   */
  screenshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Convert canvas pixel coordinates to map coordinates (0-1).
   */
  canvasToMap(canvasX: number, canvasY: number, camera: { x: number; y: number; zoom: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    
    // Normalize to -1..1
    let nx = (canvasX / rect.width) * 2 - 1;
    let ny = (canvasY / rect.height) * 2 - 1;
    
    // Undo aspect ratio correction
    if (aspect > 1) {
      nx *= aspect;
    } else {
      ny /= aspect;
    }
    
    // Undo camera transform
    const mapX = nx / (camera.zoom * 2) + camera.x;
    const mapY = ny / (camera.zoom * 2) + camera.y;

    return { x: mapX, y: mapY };
  }

  /**
   * Convert map coordinates (0-1) to canvas pixel coordinates (CSS px). This is
   * the exact inverse of canvasToMap and derives the rect the same way, so the
   * two cannot drift apart. Overlays that draw at map positions (crosshair,
   * comparison boundaries) must use this rather than reimplementing the
   * transform, which historically omitted the aspect-ratio correction below.
   */
  mapToCanvas(mapX: number, mapY: number, camera: { x: number; y: number; zoom: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;

    // Apply camera transform
    let nx = (mapX - camera.x) * (camera.zoom * 2);
    let ny = (mapY - camera.y) * (camera.zoom * 2);

    // Apply aspect ratio correction (inverse of canvasToMap's undo step)
    if (aspect > 1) {
      nx /= aspect;
    } else {
      ny *= aspect;
    }

    // Denormalize from -1..1 to pixels
    const canvasX = (nx + 1) * rect.width / 2;
    const canvasY = (ny + 1) * rect.height / 2;

    return { x: canvasX, y: canvasY };
  }

  /**
   * Expose the GL context so TileManager can create textures.
   */
  getGL(): WebGL2RenderingContext {
    return this.gl;
  }

  destroy(): void {
    const gl = this.gl;
    if (this.contactMapTexture) gl.deleteTexture(this.contactMapTexture);
    if (this.colorMapTexture) gl.deleteTexture(this.colorMapTexture);
    if (this.boundaryTexture) gl.deleteTexture(this.boundaryTexture);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.runsTexture) gl.deleteTexture(this.runsTexture);
    if (this.emptyArrayTexture) gl.deleteTexture(this.emptyArrayTexture);
    if (this.emptyPageTable) gl.deleteTexture(this.emptyPageTable);
  }
}
