/**
 * Tile-based Level of Detail (LOD) rendering system for Hi-C contact maps.
 *
 * For large genomes, uploading the entire contact matrix as a single texture
 * is infeasible. This module implements:
 *
 * - **Frustum culling**: only tiles that intersect the current viewport are
 *   considered for rendering.
 * - **Mipmap-level selection**: the appropriate detail level is chosen based
 *   on the camera zoom so that roughly one texel maps to one screen pixel.
 * - **LRU tile cache**: loaded GPU textures are cached against a texel
 *   budget. Tiles that are off screen are evicted least-recently-used first;
 *   tiles on screen are never evicted.
 *
 * Coordinate system (matches Camera.ts / WebGLRenderer.ts):
 * - Map space: (0,0) top-left to (1,1) bottom-right.
 * - Camera center (x, y) with zoom. Zoom 1.0 shows the full map.
 * - Visible region: camera.x +/- 0.5/zoom horizontally (aspect-adjusted),
 *   camera.y +/- 0.5/zoom vertically (aspect-adjusted).
 *
 * Tile coordinates:
 * - The contact map is divided into `tilesPerDimension x tilesPerDimension`
 *   tiles (from PretextHeader.numberOfTextures1D).
 * - Each tile covers a 1/tilesPerDimension fraction of map space.
 * - A tile at (col, row) covers the map rectangle:
 *     x: [col/tilesPerDim, (col+1)/tilesPerDim]
 *     y: [row/tilesPerDim, (row+1)/tilesPerDim]
 */

import type { CameraState } from './Camera';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifies a specific tile at a specific mipmap level. */
export interface TileKey {
  /** Mipmap level. 0 = coarsest (full map overview), higher = finer detail. */
  level: number;
  /** Column index in the tile grid (0-based). */
  col: number;
  /** Row index in the tile grid (0-based). */
  row: number;
}

/** State of a single cached tile. */
export interface Tile {
  key: TileKey;
  /** The WebGL texture handle, or null if created without a GL context. */
  texture: WebGLTexture | null;
  /**
   * Number of texels in the tile (side * side). The decoded values themselves
   * are not kept: once uploaded they live in the GL texture, and holding a
   * float copy of every cached tile cost about 4 bytes per texel for nothing.
   */
  texels: number;
  /** Timestamp (ms) of last access, used for LRU eviction. */
  lastUsed: number;
  /** Loading state. */
  state: 'pending' | 'loaded' | 'error';
}

// ---------------------------------------------------------------------------
// Frustum Culler
// ---------------------------------------------------------------------------

/**
 * Compute the visible map-space rectangle for the current camera and canvas.
 *
 * Returns { minX, maxX, minY, maxY } in map-space coordinates [0, 1].
 * The aspect ratio correction matches the vertex shader in WebGLRenderer.ts:
 * - If aspect > 1 (wide canvas), the horizontal extent is wider.
 * - If aspect <= 1 (tall canvas), the vertical extent is taller.
 */
export function getVisibleRect(
  camera: CameraState,
  canvasWidth: number,
  canvasHeight: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const aspect = canvasWidth / canvasHeight;

  // The vertex shader maps map-space to clip-space:
  //   clipX = (pos.x - camera.x) * zoom * 2   (but divided by aspect if aspect > 1)
  //   clipY = (pos.y - camera.y) * zoom * 2   (but multiplied by aspect if aspect <= 1)
  //
  // The visible clip range is [-1, 1]. Solving for the map-space extents:
  let halfW: number;
  let halfH: number;

  if (aspect > 1) {
    // Wide canvas: horizontal range is stretched
    halfW = (0.5 * aspect) / camera.zoom;
    halfH = 0.5 / camera.zoom;
  } else {
    // Tall canvas: vertical range is stretched
    halfW = 0.5 / camera.zoom;
    halfH = 0.5 / (camera.zoom * aspect);
  }

  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

/**
 * Test whether a tile at (tileCol, tileRow) in a grid of `tilesPerDim x
 * tilesPerDim` intersects the current viewport.
 *
 * This is a simple 2D AABB overlap test between the tile's map-space
 * rectangle and the camera's visible rectangle.
 */
export function tileIntersectsViewport(
  tileCol: number,
  tileRow: number,
  tilesPerDim: number,
  camera: CameraState,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const visible = getVisibleRect(camera, canvasWidth, canvasHeight);

  // Tile bounds in map space
  const tileMinX = tileCol / tilesPerDim;
  const tileMaxX = (tileCol + 1) / tilesPerDim;
  const tileMinY = tileRow / tilesPerDim;
  const tileMaxY = (tileRow + 1) / tilesPerDim;

  // AABB overlap test: two rectangles overlap iff they overlap on both axes
  const overlapX = tileMaxX > visible.minX && tileMinX < visible.maxX;
  const overlapY = tileMaxY > visible.minY && tileMinY < visible.maxY;

  return overlapX && overlapY;
}

// ---------------------------------------------------------------------------
// Mip Level Selection
// ---------------------------------------------------------------------------

/**
 * Select the appropriate mipmap level for the current zoom.
 *
 * Convention:
 * - Level 0 is the **coarsest** level (full overview, smallest texture).
 * - Level (numMipMaps - 1) is the **finest** level (full resolution).
 *
 * The ideal level is determined by how many screen pixels are available
 * per tile. At zoom 1.0 the full map is visible, so each tile occupies
 * roughly `canvasPixels / tilesPerDimension` screen pixels. At higher
 * zooms, more screen pixels are available per tile, so we need finer
 * detail.
 *
 * We compute the level as:
 *   level = clamp(round(log2(zoom)), 0, numMipMaps - 1)
 *
 * This means:
 * - zoom 1   -> level 0 (coarsest)
 * - zoom 2   -> level 1
 * - zoom 4   -> level 2
 * - zoom 2^n -> level n (up to the maximum)
 */
export function selectMipLevel(
  zoom: number,
  _tilesPerDimension: number,
  numMipMaps: number,
): number {
  if (numMipMaps <= 0) return 0;
  if (zoom <= 1) return 0;

  const level = Math.round(Math.log2(zoom));
  return Math.max(0, Math.min(numMipMaps - 1, level));
}

// ---------------------------------------------------------------------------
// Visible Tile Keys
// ---------------------------------------------------------------------------

/**
 * Get the list of TileKeys that are visible for the current camera state.
 *
 * This combines frustum culling (only tiles overlapping the viewport)
 * with mip-level selection (one level for the whole view, matching how
 * mipmap selection typically works).
 *
 * @param camera       Current camera state.
 * @param canvasWidth  Canvas width in physical pixels.
 * @param canvasHeight Canvas height in physical pixels.
 * @param tilesPerDim  Number of tiles per map dimension (numberOfTextures1D).
 * @param numMipMaps   Total number of mipmap levels available.
 * @returns Array of TileKeys for tiles that need to be loaded/rendered.
 */
export function getVisibleTileKeys(
  camera: CameraState,
  canvasWidth: number,
  canvasHeight: number,
  tilesPerDim: number,
  numMipMaps: number,
): TileKey[] {
  if (tilesPerDim <= 0) return [];

  const level = selectMipLevel(camera.zoom, tilesPerDim, numMipMaps);
  const visible = getVisibleRect(camera, canvasWidth, canvasHeight);

  // Convert visible bounds to tile index ranges, clamped to the grid
  const colMin = Math.max(0, Math.floor(visible.minX * tilesPerDim));
  const colMax = Math.min(tilesPerDim - 1, Math.floor(visible.maxX * tilesPerDim));
  const rowMin = Math.max(0, Math.floor(visible.minY * tilesPerDim));
  const rowMax = Math.min(tilesPerDim - 1, Math.floor(visible.maxY * tilesPerDim));

  const keys: TileKey[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      keys.push({ level, col, row });
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Tile Key Utilities
// ---------------------------------------------------------------------------

/** Serialise a TileKey into a string suitable for use as a Map key. */
export function tileKeyToString(key: TileKey): string {
  return `${key.level}:${key.col}:${key.row}`;
}

/** Parse a serialised tile key string back into a TileKey. */
export function stringToTileKey(s: string): TileKey {
  const [level, col, row] = s.split(':').map(Number);
  return { level, col, row };
}

// ---------------------------------------------------------------------------
// TileManager
// ---------------------------------------------------------------------------

export interface TileManagerOptions {
  /**
   * Cache budget in texels (one byte each on the GPU). Default: 256 Mi.
   * A full screen of tiles needs a few million texels at any zoom, because
   * the mip level tracks the zoom, so this leaves ample room for panning.
   */
  maxTexels?: number;
  /** Optional cap on the number of cached tiles. Default: no cap. */
  maxTiles?: number;
}

/** Default cache budget: 256 Mi texels, i.e. 256 MiB of R8 texture. */
export const DEFAULT_MAX_TEXELS = 256 * 1024 * 1024;

/**
 * Manages a cache of loaded tiles and their GPU textures.
 *
 * Usage:
 * 1. Call `updateVisibleTiles()` every frame (or on camera change) to get
 *    the set of tiles that should be visible.
 * 2. For each key returned, check `getTile()`. If missing or pending,
 *    request the tile data from the parser and call `loadTile()` when ready.
 * 3. The TileManager handles LRU eviction automatically.
 * 4. Call `dispose()` when done to release all GPU resources.
 */
export class TileManager {
  private gl: WebGL2RenderingContext | null;
  private cache: Map<string, Tile> = new Map();
  private maxTiles: number;
  private maxTexels: number;
  private cachedTexels = 0;

  /** The set of tile keys that were visible after the last updateVisibleTiles call. */
  private _visibleKeys: TileKey[] = [];
  /** Same set as strings. Visible tiles are never evicted. */
  private visibleSet: Set<string> = new Set();

  constructor(gl: WebGL2RenderingContext | null, options: TileManagerOptions = {}) {
    this.gl = gl;
    this.maxTiles = options.maxTiles ?? Infinity;
    this.maxTexels = options.maxTexels ?? DEFAULT_MAX_TEXELS;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Recalculate which tiles are needed for the current camera state.
   *
   * Returns the list of visible TileKeys. The caller is responsible for
   * loading any tiles that are not yet in the cache.
   */
  updateVisibleTiles(
    camera: CameraState,
    canvasWidth: number,
    canvasHeight: number,
    tilesPerDim: number,
    numMipMaps: number,
  ): TileKey[] {
    this._visibleKeys = getVisibleTileKeys(
      camera,
      canvasWidth,
      canvasHeight,
      tilesPerDim,
      numMipMaps,
    );

    // Visible tiles are exempt from eviction (see evictToFit); also touch
    // them so they stay warm for a while after they scroll out of view.
    const now = performance.now();
    this.visibleSet = new Set();
    for (const key of this._visibleKeys) {
      const strKey = tileKeyToString(key);
      this.visibleSet.add(strKey);
      const tile = this.cache.get(strKey);
      if (tile) {
        tile.lastUsed = now;
      }
    }

    // Tiles that just left the screen may now be over budget.
    this.evictToFit(0, 0);

    return this._visibleKeys;
  }

  /** Get the tile keys from the most recent `updateVisibleTiles` call. */
  get visibleKeys(): TileKey[] {
    return this._visibleKeys;
  }

  /**
   * Retrieve a cached tile by its key, or undefined if not cached.
   * Accessing a tile updates its lastUsed timestamp for LRU purposes.
   */
  getTile(key: TileKey): Tile | undefined {
    const strKey = tileKeyToString(key);
    const tile = this.cache.get(strKey);
    if (tile) {
      tile.lastUsed = performance.now();
    }
    return tile;
  }

  /**
   * Upload decoded tile data and record the tile as loaded. `data` is not
   * retained.
   *
   * If the cache is over budget, least-recently-used tiles that are not
   * currently visible are evicted to make room.
   */
  loadTile(key: TileKey, data: Float32Array): Tile {
    const strKey = tileKeyToString(key);

    const existing = this.cache.get(strKey);
    if (existing && existing.state === 'loaded') {
      existing.lastUsed = performance.now();
      if (this.gl && existing.texture && existing.texels === data.length) {
        this.uploadTileTexture(existing.texture, data);
      } else {
        this.deleteTileTexture(existing);
        if (this.gl) existing.texture = this.createTileTexture(data);
      }
      this.cachedTexels += data.length - existing.texels;
      existing.texels = data.length;
      return existing;
    }
    if (existing) {
      // pending or error placeholder: replace it
      this.cachedTexels -= existing.texels;
      this.cache.delete(strKey);
    }

    this.evictToFit(data.length);

    const tile: Tile = {
      key,
      texture: this.gl ? this.createTileTexture(data) : null,
      texels: data.length,
      lastUsed: performance.now(),
      state: 'loaded',
    };

    this.cache.set(strKey, tile);
    this.cachedTexels += tile.texels;
    return tile;
  }

  /**
   * Mark a tile as pending (loading in progress).
   * This prevents duplicate load requests.
   */
  markPending(key: TileKey): void {
    const strKey = tileKeyToString(key);
    if (this.cache.has(strKey)) return;

    this.evictToFit(0);

    const tile: Tile = {
      key,
      texture: null,
      texels: 0,
      lastUsed: performance.now(),
      state: 'pending',
    };

    this.cache.set(strKey, tile);
  }

  /**
   * Mark a tile as having failed to load.
   */
  markError(key: TileKey): void {
    const strKey = tileKeyToString(key);
    const tile = this.cache.get(strKey);
    if (tile) {
      tile.state = 'error';
      tile.lastUsed = performance.now();
    }
  }

  /** Number of tiles currently in the cache. */
  get size(): number {
    return this.cache.size;
  }

  /** The maximum number of cached tiles (Infinity when uncapped). */
  get capacity(): number {
    return this.maxTiles;
  }

  /** The cache budget in texels. */
  get texelBudget(): number {
    return this.maxTexels;
  }

  /** Texels currently held by cached tiles. */
  get texelsInUse(): number {
    return this.cachedTexels;
  }

  /**
   * Check if a tile is cached (any state: pending, loaded, or error).
   */
  hasTile(key: TileKey): boolean {
    return this.cache.has(tileKeyToString(key));
  }

  /**
   * Remove a specific tile from the cache and delete its GL texture.
   */
  removeTile(key: TileKey): boolean {
    const strKey = tileKeyToString(key);
    const tile = this.cache.get(strKey);
    if (!tile) return false;

    this.deleteTileTexture(tile);
    this.cachedTexels -= tile.texels;
    this.cache.delete(strKey);
    return true;
  }

  /**
   * Clean up all cached tiles and release GL textures.
   */
  dispose(): void {
    for (const tile of this.cache.values()) {
      this.deleteTileTexture(tile);
    }
    this.cache.clear();
    this.cachedTexels = 0;
    this._visibleKeys = [];
    this.visibleSet = new Set();
  }

  // -----------------------------------------------------------------------
  // Eviction
  // -----------------------------------------------------------------------

  /**
   * Evict least-recently-used tiles until `incomingTiles` more tiles totalling
   * `incomingTexels` fit within both the texel budget and the tile-count cap.
   *
   * Tiles in the current visible set are never evicted. A view that needs
   * more than the budget is allowed to exceed it: evicting a tile that is on
   * screen leaves a hole that is refilled by evicting another visible tile,
   * which never settles.
   */
  private evictToFit(incomingTexels: number, incomingTiles = 1): void {
    while (
      this.cache.size + incomingTiles > this.maxTiles ||
      this.cachedTexels + incomingTexels > this.maxTexels
    ) {
      if (!this.evictLRU()) return;
    }
  }

  /**
   * Evict the least-recently-used tile that is not visible.
   * Returns false when there is nothing evictable.
   */
  private evictLRU(): boolean {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [strKey, tile] of this.cache) {
      if (this.visibleSet.has(strKey)) continue;
      if (tile.lastUsed < oldestTime) {
        oldestTime = tile.lastUsed;
        oldestKey = strKey;
      }
    }

    if (oldestKey === null) return false;
    const tile = this.cache.get(oldestKey)!;
    this.deleteTileTexture(tile);
    this.cachedTexels -= tile.texels;
    this.cache.delete(oldestKey);
    return true;
  }

  // -----------------------------------------------------------------------
  // GL texture helpers
  // -----------------------------------------------------------------------

  /** Convert [0,1] float intensities to the R8 bytes uploaded to the GPU. */
  private static toR8(data: Float32Array): Uint8Array {
    const u8 = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      u8[i] = Math.round(Math.min(1.0, Math.max(0.0, data[i])) * 255);
    }
    return u8;
  }

  /**
   * Create a GL texture from tile intensity data.
   * The texture is a single-channel R8 normalized format, matching the
   * approach in WebGLRenderer.uploadContactMap.
   */
  private createTileTexture(data: Float32Array): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;

    const size = Math.round(Math.sqrt(data.length));
    if (size * size !== data.length) {
      console.warn(
        `TileManager: data length ${data.length} is not a perfect square`,
      );
      return null;
    }

    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, size, size, 0,
      gl.RED, gl.UNSIGNED_BYTE, TileManager.toR8(data),
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
  }

  /** Re-upload data of the same size into an existing texture. */
  private uploadTileTexture(texture: WebGLTexture, data: Float32Array): void {
    const gl = this.gl;
    if (!gl) return;

    const size = Math.round(Math.sqrt(data.length));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, size, size,
      gl.RED, gl.UNSIGNED_BYTE, TileManager.toR8(data),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Delete a tile's GL texture if it exists.
   */
  private deleteTileTexture(tile: Tile): void {
    if (this.gl && tile.texture) {
      this.gl.deleteTexture(tile.texture);
      tile.texture = null;
    }
  }
}
