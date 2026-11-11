/**
 * WebGL2 renderer for Hi-C contact maps.
 * 
 * Renders the contact matrix as a textured quad with:
 * - Multi-resolution tiled rendering (mipmap-like)
 * - Configurable color maps applied in the fragment shader
 * - Smooth pan/zoom via camera transforms
 * - Contig grid overlay
 * - Selection highlighting
 */

import { getColorMapData, type ColorMapName } from './ColorMaps';

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

// Fragment shader: samples contact map and applies color map
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texcoord;

uniform sampler2D u_contactMap;
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
// alpha, so they can be laid over whatever is already in the framebuffer
// (the overview and any detail tiles).
uniform bool u_overlayOnly;

// Contig boundaries (normalized 0-1, sorted ascending) in an R32F texture,
// width = u_numContigs, height = 1. Sampled via texelFetch + binary search.
uniform highp sampler2D u_boundaryTex;

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

// Overlay accumulator: premultiplied colour and remaining transmittance.
vec3 ovColor = vec3(0.0);
float ovTrans = 1.0;
void overlay(vec3 c, float a) {
  ovColor = ovColor * (1.0 - a) + c * a;
  ovTrans *= (1.0 - a);
}

void main() {
  if (!u_overlayOnly) {
    // Sample the contact map (single channel intensity)
    float intensity = texture(u_contactMap, v_texcoord).r;

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

// Tile vertex shader: maps a unit quad to a tile's region in map space,
// then applies the same camera transform as the overview.
export const TILE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;

uniform vec2 u_camera;
uniform float u_zoom;
uniform vec2 u_resolution;
uniform vec2 u_tileOffset; // tile origin in map space (0-1)
uniform vec2 u_tileScale;  // tile size in map space (1/tilesPerDim)

out vec2 v_texcoord;

void main() {
  // Map unit quad [0,1] to tile's region in map space
  vec2 mapPos = u_tileOffset + a_position * u_tileScale;

  // Apply camera transform (same as overview shader)
  vec2 pos = (mapPos - u_camera) * u_zoom;

  // Same single y flip as the overview shader: map space is genomic y-down,
  // clip space is y-up. Tile row r covers map y [r/n, (r+1)/n], which is where
  // its genomic rows actually belong — previously the tile grid was placed in
  // a y-up space while its rows were indexed y-down, so the detail layer was
  // mirrored block-by-block against the overview beneath it.
  pos.y = -pos.y;

  float aspect = u_resolution.x / u_resolution.y;
  if (aspect > 1.0) {
    pos.x /= aspect;
  } else {
    pos.y *= aspect;
  }

  gl_Position = vec4(pos * 2.0, 0.0, 1.0);
  // Tile texture rows are genomic top-down, same as map space, so the texcoord
  // is the unit-quad position unchanged.
  v_texcoord = a_position;
}
`;

// Tile fragment shader: samples tile texture, applies gamma + color map.
//
// A loaded tile is authoritative for the area it covers: every fragment is
// drawn, including empty ones, which take the colour map's zero colour. It
// must not be masked by, or let through, the coarser overview underneath.
// Doing either shows the reader something the file does not contain at this
// position (hidden weak contacts in one case, empty texels painted with a
// coarse average in the other).
//
// No grid or highlight here: those are drawn over the tiles by the overlay
// pass (see renderOverlay).
const TILE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texcoord;

uniform sampler2D u_tileTexture;
uniform sampler2D u_colorMap;
uniform float u_gamma;
uniform float u_floor;   // contrast range minimum (hidden at/below)
uniform float u_ceil;    // contrast range maximum (saturated at/above)

out vec4 fragColor;

void main() {
  float intensity = texture(u_tileTexture, v_texcoord).r;
  // Rescale to the [floor, ceil] contrast range, then gamma correct.
  float t = clamp((intensity - u_floor) / max(u_ceil - u_floor, 1e-5), 0.0, 1.0);
  float mapped = pow(t, u_gamma);
  fragColor = texture(u_colorMap, vec2(mapped, 0.5));
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
  /** Skip the grid/highlight pass; the caller will call renderOverlay(). */
  deferOverlay?: boolean;
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

  // Tile detail program
  private tileProgram: WebGLProgram | null = null;
  private tileVao: WebGLVertexArrayObject | null = null;
  private tileUniforms: Record<string, WebGLUniformLocation | null> = {};

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
      'u_highlightStart', 'u_highlightEnd', 'u_hasHighlight', 'u_overlayOnly'
    ];
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    
    // Create fullscreen quad
    this.createQuad();
    
    // Create default color map texture
    this.setColorMap('red-white');

    // Initialize tile detail program
    this.initTileProgram();

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
   * Upload contact map data as a texture.
   * Data should be a Float32Array of intensity values [0,1] in row-major order.
   */
  uploadContactMap(data: Float32Array, size: number): void {
    const gl = this.gl;
    
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

    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      size, size, 0,
      gl.RED, gl.UNSIGNED_BYTE, u8data
    );

    // Linear filtering (always supported for R8)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    this.textureSize = size;
    this.needsRender = true;
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

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.contactMapTexture);
    gl.uniform1i(this.uniforms['u_contactMap']!, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorMapTexture);
    gl.uniform1i(this.uniforms['u_colorMap']!, 1);

    // Draw
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    if (!options.deferOverlay) this.renderOverlay(camera, options);
  }

  /**
   * Draw the contig grid and the highlight band over whatever is already in
   * the framebuffer. render() calls this itself unless `deferOverlay` is set;
   * a caller that draws detail tiles defers it and calls it after the tiles,
   * so the grid stays visible on top of them.
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

    if (this.boundaryTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.boundaryTexture);
      gl.uniform1i(this.uniforms['u_boundaryTex']!, 2);
    }

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

  // ─── Tile Detail Rendering ─────────────────────────────────

  /**
   * Expose the GL context so TileManager can create textures.
   */
  getGL(): WebGL2RenderingContext {
    return this.gl;
  }

  private initTileProgram(): void {
    const gl = this.gl;

    const vs = this.compileShader(gl.VERTEX_SHADER, TILE_VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, TILE_FRAGMENT_SHADER);
    if (!vs || !fs) return;

    this.tileProgram = gl.createProgram()!;
    gl.attachShader(this.tileProgram, vs);
    gl.attachShader(this.tileProgram, fs);
    gl.linkProgram(this.tileProgram);

    if (!gl.getProgramParameter(this.tileProgram, gl.LINK_STATUS)) {
      console.error('Tile program link error:', gl.getProgramInfoLog(this.tileProgram));
      return;
    }

    const tileUniformNames = [
      'u_camera', 'u_zoom', 'u_resolution',
      'u_tileOffset', 'u_tileScale',
      'u_tileTexture', 'u_colorMap', 'u_gamma', 'u_floor', 'u_ceil',
    ];
    for (const name of tileUniformNames) {
      this.tileUniforms[name] = gl.getUniformLocation(this.tileProgram, name);
    }

    // Create tile VAO (same unit quad geometry as the overview)
    const vertices = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]);

    this.tileVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.tileVao);

    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.tileProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  /**
   * Begin a batch of detail-tile draws. Binds the tile program, uploads the
   * uniforms shared by all tiles in the frame (camera, zoom, resolution, gamma),
   * binds the color map, and binds the tile VAO once. Call drawTile() per tile,
   * then endTiles().
   */
  beginTiles(
    camera: { x: number; y: number; zoom: number },
    gamma: number,
    floor: number = 0,
    ceil: number = 1,
  ): void {
    const gl = this.gl;
    if (!this.tileProgram || !this.tileVao) return;
    gl.useProgram(this.tileProgram);
    gl.uniform2f(this.tileUniforms['u_camera']!, camera.x, camera.y);
    gl.uniform1f(this.tileUniforms['u_zoom']!, camera.zoom);
    gl.uniform2f(this.tileUniforms['u_resolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.tileUniforms['u_gamma']!, gamma);
    gl.uniform1f(this.tileUniforms['u_floor']!, floor);
    gl.uniform1f(this.tileUniforms['u_ceil']!, ceil);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorMapTexture);
    gl.uniform1i(this.tileUniforms['u_colorMap']!, 1);
    gl.bindVertexArray(this.tileVao);
  }

  /** Draw one tile within a beginTiles()/endTiles() batch. */
  drawTile(texture: WebGLTexture, col: number, row: number, tilesPerDim: number): void {
    const gl = this.gl;
    if (!this.tileProgram || !this.tileVao) return;
    const tileSize = 1.0 / tilesPerDim;
    gl.uniform2f(this.tileUniforms['u_tileOffset']!, col * tileSize, row * tileSize);
    gl.uniform2f(this.tileUniforms['u_tileScale']!, tileSize, tileSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.tileUniforms['u_tileTexture']!, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** End a detail-tile draw batch. */
  endTiles(): void {
    this.gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    if (this.contactMapTexture) gl.deleteTexture(this.contactMapTexture);
    if (this.colorMapTexture) gl.deleteTexture(this.colorMapTexture);
    if (this.boundaryTexture) gl.deleteTexture(this.boundaryTexture);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.tileProgram) gl.deleteProgram(this.tileProgram);
    if (this.tileVao) gl.deleteVertexArray(this.tileVao);
  }
}
