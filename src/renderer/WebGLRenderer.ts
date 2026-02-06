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

// Vertex shader: transforms quad vertices by camera
const VERTEX_SHADER = `#version 300 es
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
uniform float u_gamma;
uniform bool u_showGrid;
uniform float u_gridOpacity;
uniform int u_numContigs;
uniform float u_highlightStart;
uniform float u_highlightEnd;
uniform bool u_hasHighlight;

// Contig boundaries as pixel positions (normalized 0-1)
uniform float u_contigBoundaries[512]; // max 512 contigs

out vec4 fragColor;

float applyGamma(float value, float gamma) {
  return pow(clamp(value, 0.0, 1.0), gamma);
}

float gridDistance(vec2 uv, int numContigs) {
  if (numContigs <= 0) return 1.0;
  float minDist = 1.0;
  for (int i = 0; i < 512; i++) {
    if (i >= numContigs) break;
    float boundary = u_contigBoundaries[i];
    float dx = abs(uv.x - boundary);
    float dy = abs(uv.y - boundary);
    minDist = min(minDist, min(dx, dy));
  }
  return minDist;
}

void main() {
  // Sample the contact map (single channel intensity)
  float intensity = texture(u_contactMap, v_texcoord).r;

  // Apply gamma correction
  float mapped = applyGamma(intensity, u_gamma);

  // Look up color from the 1D color map texture
  vec4 color = texture(u_colorMap, vec2(mapped, 0.5));

  // Grid overlay with anti-aliased lines
  if (u_showGrid) {
    float dist = gridDistance(v_texcoord, u_numContigs);
    float lineWidth = 1.5 / max(u_resolution.x, u_resolution.y);
    float line = 1.0 - smoothstep(0.0, lineWidth, dist);
    // Use a dark semi-transparent line that works on any background
    vec4 gridColor = vec4(0.0, 0.0, 0.0, 0.6);
    color = mix(color, gridColor, line * u_gridOpacity);
  }

  // Highlight selected/hovered contig
  if (u_hasHighlight) {
    bool inHighlightX = v_texcoord.x >= u_highlightStart && v_texcoord.x <= u_highlightEnd;
    bool inHighlightY = v_texcoord.y >= u_highlightStart && v_texcoord.y <= u_highlightEnd;
    if (inHighlightX || inHighlightY) {
      // Brighten the cross-hair region
      color = mix(color, vec4(1.0, 1.0, 0.5, 1.0), 0.15);
    }
    if (inHighlightX && inHighlightY) {
      // Stronger highlight at intersection
      color = mix(color, vec4(1.0, 1.0, 0.3, 1.0), 0.12);
    }
  }

  fragColor = color;
}
`;

// Tile vertex shader: maps a unit quad to a tile's region in map space,
// then applies the same camera transform as the overview.
const TILE_VERTEX_SHADER = `#version 300 es
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

  float aspect = u_resolution.x / u_resolution.y;
  if (aspect > 1.0) {
    pos.x /= aspect;
  } else {
    pos.y *= aspect;
  }

  gl_Position = vec4(pos * 2.0, 0.0, 1.0);
  v_texcoord = a_position;
}
`;

// Tile fragment shader: samples tile texture, applies gamma + color map.
// No grid or highlight — those come from the overview layer underneath.
const TILE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texcoord;

uniform sampler2D u_tileTexture;
uniform sampler2D u_colorMap;
uniform float u_gamma;

out vec4 fragColor;

void main() {
  float intensity = texture(u_tileTexture, v_texcoord).r;
  float mapped = pow(clamp(intensity, 0.0, 1.0), u_gamma);
  fragColor = texture(u_colorMap, vec2(mapped, 0.5));
}
`;

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
      'u_gamma', 'u_showGrid', 'u_gridOpacity', 'u_numContigs', 'u_contigBoundaries',
      'u_highlightStart', 'u_highlightEnd', 'u_hasHighlight'
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
    
    // Fullscreen quad covering 0-1 range (will be transformed by camera)
    const vertices = new Float32Array([
      // position (x,y), texcoord (u,v)
      0, 0,   0, 1,
      1, 0,   1, 1,
      0, 1,   0, 0,
      1, 1,   1, 0,
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
   * Render the contact map with current camera and settings.
   */
  render(camera: { x: number; y: number; zoom: number }, options: {
    gamma?: number;
    showGrid?: boolean;
    gridOpacity?: number;
    contigBoundaries?: number[];
    highlightStart?: number;
    highlightEnd?: number;
  } = {}): void {
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
    gl.clearColor(0.1, 0.1, 0.15, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    if (!this.contactMapTexture || !this.program) return;
    
    gl.useProgram(this.program);
    
    // Set uniforms
    gl.uniform2f(this.uniforms['u_camera']!, camera.x, camera.y);
    gl.uniform1f(this.uniforms['u_zoom']!, camera.zoom);
    gl.uniform2f(this.uniforms['u_resolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.uniforms['u_gamma']!, options.gamma ?? 0.5);
    gl.uniform1i(this.uniforms['u_showGrid']!, (options.showGrid ?? false) ? 1 : 0);
    gl.uniform1f(this.uniforms['u_gridOpacity']!, options.gridOpacity ?? 0.5);
    
    // Contig boundaries
    const boundaries = options.contigBoundaries ?? [];
    gl.uniform1i(this.uniforms['u_numContigs']!, boundaries.length);
    if (boundaries.length > 0) {
      gl.uniform1fv(this.uniforms['u_contigBoundaries']!, new Float32Array(boundaries));
    }

    // Highlight
    const hasHighlight = options.highlightStart !== undefined && options.highlightEnd !== undefined;
    gl.uniform1i(this.uniforms['u_hasHighlight']!, hasHighlight ? 1 : 0);
    if (hasHighlight) {
      gl.uniform1f(this.uniforms['u_highlightStart']!, options.highlightStart!);
      gl.uniform1f(this.uniforms['u_highlightEnd']!, options.highlightEnd!);
    }
    
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
      'u_tileTexture', 'u_colorMap', 'u_gamma',
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
   * Render a single detail tile on top of the overview.
   *
   * @param texture     The tile's GL texture (R8 format).
   * @param col         Tile column in the grid.
   * @param row         Tile row in the grid.
   * @param tilesPerDim Number of tiles per map dimension.
   * @param camera      Current camera state.
   * @param gamma       Gamma correction value.
   */
  renderTile(
    texture: WebGLTexture,
    col: number,
    row: number,
    tilesPerDim: number,
    camera: { x: number; y: number; zoom: number },
    gamma: number,
  ): void {
    const gl = this.gl;
    if (!this.tileProgram || !this.tileVao) return;

    gl.useProgram(this.tileProgram);

    // Camera and resolution uniforms
    gl.uniform2f(this.tileUniforms['u_camera']!, camera.x, camera.y);
    gl.uniform1f(this.tileUniforms['u_zoom']!, camera.zoom);
    gl.uniform2f(this.tileUniforms['u_resolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.tileUniforms['u_gamma']!, gamma);

    // Tile position in map space
    const tileSize = 1.0 / tilesPerDim;
    gl.uniform2f(this.tileUniforms['u_tileOffset']!, col * tileSize, row * tileSize);
    gl.uniform2f(this.tileUniforms['u_tileScale']!, tileSize, tileSize);

    // Bind tile texture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.tileUniforms['u_tileTexture']!, 0);

    // Bind color map to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorMapTexture);
    gl.uniform1i(this.tileUniforms['u_colorMap']!, 1);

    // Draw
    gl.bindVertexArray(this.tileVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    if (this.contactMapTexture) gl.deleteTexture(this.contactMapTexture);
    if (this.colorMapTexture) gl.deleteTexture(this.colorMapTexture);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.tileProgram) gl.deleteProgram(this.tileProgram);
    if (this.tileVao) gl.deleteVertexArray(this.tileVao);
  }
}
