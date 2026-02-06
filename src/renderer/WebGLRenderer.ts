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
uniform float u_gamma;
uniform bool u_showGrid;
uniform float u_gridOpacity;
uniform int u_numContigs;

// Contig boundaries as pixel positions (normalized 0-1)
uniform float u_contigBoundaries[512]; // max 512 contigs

out vec4 fragColor;

float applyGamma(float value, float gamma) {
  return pow(clamp(value, 0.0, 1.0), gamma);
}

bool isOnGrid(vec2 uv, int numContigs) {
  if (numContigs <= 0) return false;
  
  for (int i = 0; i < 512; i++) {
    if (i >= numContigs) break;
    float boundary = u_contigBoundaries[i];
    float pixelSize = 1.0 / 2048.0; // approximate
    if (abs(uv.x - boundary) < pixelSize || abs(uv.y - boundary) < pixelSize) {
      return true;
    }
  }
  return false;
}

void main() {
  // Sample the contact map (single channel intensity)
  float intensity = texture(u_contactMap, v_texcoord).r;
  
  // Apply gamma correction
  float mapped = applyGamma(intensity, u_gamma);
  
  // Look up color from the 1D color map texture
  vec4 color = texture(u_colorMap, vec2(mapped, 0.5));
  
  // Grid overlay
  if (u_showGrid && isOnGrid(v_texcoord, u_numContigs)) {
    color = mix(color, vec4(0.3, 0.8, 0.3, 1.0), u_gridOpacity);
  }
  
  fragColor = color;
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
  
  // State
  private textureSize: number = 0;
  private needsRender: boolean = true;

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
      'u_gamma', 'u_showGrid', 'u_gridOpacity', 'u_numContigs', 'u_contigBoundaries'
    ];
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    
    // Create fullscreen quad
    this.createQuad();
    
    // Create default color map texture
    this.setColorMap('red-white');
    
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
    
    // Upload as R32F single-channel float texture
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F,
      size, size, 0,
      gl.RED, gl.FLOAT, data
    );
    
    // Linear filtering for smooth zoom
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

  destroy(): void {
    const gl = this.gl;
    if (this.contactMapTexture) gl.deleteTexture(this.contactMapTexture);
    if (this.colorMapTexture) gl.deleteTexture(this.colorMapTexture);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
