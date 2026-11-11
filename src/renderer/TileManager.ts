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
 * - **Tile store**: the tiles of the level on screen live in the layers of
 *   one array texture, with a page table saying which tile is in which layer,
 *   so a shader can read any loaded tile per pixel. Off-screen tiles are
 *   evicted least-recently-used first; tiles on screen are never evicted.
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
import type { DisplayRun } from '../core/DisplayMapping';

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
  /** Layer of the level's array texture holding this tile, or -1 if none. */
  layer: number;
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

/**
 * Select the detail level to draw: the finest stored level whose texels are
 * at least one screen pixel wide.
 *
 * Level 0 is the coarsest stored level, `coarsestSize` texels across the
 * whole map; each level up doubles that. Choosing a level no finer than the
 * screen means every stored value at that level reaches at least one pixel,
 * so sampling the nearest texel never skips data. The cost is that texels
 * are up to two pixels wide just before the next level takes over.
 *
 * @param zoom          Camera zoom (1 = whole map fits the shorter side).
 * @param screenMinPx   Shorter side of the canvas in device pixels.
 * @param coarsestSize  Texels across the whole map at level 0.
 * @param numMipMaps    Number of stored levels.
 */
export function selectDetailLevel(
  zoom: number,
  screenMinPx: number,
  coarsestSize: number,
  numMipMaps: number,
): number {
  if (numMipMaps <= 0 || coarsestSize <= 0 || screenMinPx <= 0 || zoom <= 0) return 0;
  const pxAcrossMap = zoom * screenMinPx;
  // The tiny epsilon keeps an exact power of two from landing a level low.
  const level = Math.floor(Math.log2(pxAcrossMap / coarsestSize) + 1e-9);
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
// Visible tiles through the display mapping
// ---------------------------------------------------------------------------

/**
 * File tile indices (along one axis) that a display interval shows, nearest
 * the interval's centre first.
 *
 * After curation a stretch of the display can read several separate stretches
 * of the file, so the result is a set, not a range.
 *
 * @param runs         Display runs (DisplayMapping.buildDisplayRuns).
 * @param lo           Start of the interval in display texels.
 * @param hi           End of the interval in display texels (exclusive).
 * @param totalTexels  Texels along one axis of the full-resolution map.
 * @param tilesPerDim  Tiles per axis.
 */
export function fileTilesForDisplayInterval(
  runs: DisplayRun[],
  lo: number,
  hi: number,
  totalTexels: number,
  tilesPerDim: number,
): number[] {
  if (tilesPerDim <= 0 || totalTexels <= 0 || hi <= lo) return [];
  const texelsPerTile = totalTexels / tilesPerDim;
  const centre = (lo + hi) / 2;
  const found = new Map<number, number>(); // tile index -> distance from centre

  for (const run of runs) {
    const a = Math.max(lo, run.displayStart);
    const b = Math.min(hi, run.displayStart + run.length);
    if (b <= a) continue;
    // File span shown by the visible part [a, b) of this run.
    const f0 = run.reversed
      ? run.fileStart + run.length - (b - run.displayStart)
      : run.fileStart + (a - run.displayStart);
    const f1 = f0 + (b - a);
    const t0 = Math.max(0, Math.floor(f0 / texelsPerTile));
    const t1 = Math.min(tilesPerDim - 1, Math.ceil(f1 / texelsPerTile) - 1);
    for (let t = t0; t <= t1; t++) {
      // Where this tile's visible part sits on the display, for ordering.
      const tf0 = Math.max(f0, t * texelsPerTile);
      const tf1 = Math.min(f1, (t + 1) * texelsPerTile);
      const fMid = (tf0 + tf1) / 2;
      const dMid = run.reversed
        ? run.displayStart + (run.fileStart + run.length - fMid)
        : run.displayStart + (fMid - run.fileStart);
      const dist = Math.abs(dMid - centre);
      const prev = found.get(t);
      if (prev === undefined || dist < prev) found.set(t, dist);
    }
  }

  return [...found.entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0]).map((e) => e[0]);
}

/**
 * The tiles needed to draw the current view at `level`, through the display
 * mapping, most central first.
 *
 * The display rectangle's x extent shows some set of file columns and its y
 * extent some set of file rows; every pixel in view reads a tile from their
 * product.
 */
export function getVisibleTileKeysMapped(
  runs: DisplayRun[],
  camera: CameraState,
  canvasWidth: number,
  canvasHeight: number,
  totalTexels: number,
  tilesPerDim: number,
  level: number,
): TileKey[] {
  const rect = getVisibleRect(camera, canvasWidth, canvasHeight);
  const clamp = (v: number) => Math.max(0, Math.min(1, v)) * totalTexels;
  const cols = fileTilesForDisplayInterval(runs, clamp(rect.minX), clamp(rect.maxX), totalTexels, tilesPerDim);
  const rows = fileTilesForDisplayInterval(runs, clamp(rect.minY), clamp(rect.maxY), totalTexels, tilesPerDim);

  // Order by combined rank so tiles near the view centre come first.
  const ranked: Array<{ key: TileKey; rank: number }> = [];
  rows.forEach((row, ri) => {
    cols.forEach((col, ci) => ranked.push({ key: { level, col, row }, rank: ri + ci }));
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.key);
}

// ---------------------------------------------------------------------------
// TileManager
// ---------------------------------------------------------------------------

export interface TileManagerOptions {
  /**
   * GPU budget for the tile store in texels (one byte each). Default: 96 Mi.
   * A screenful needs a few million texels at any zoom, because the level
   * tracks the zoom, so this leaves room for panning and for scrambled orders
   * that touch many separate parts of the file.
   */
  maxTexels?: number;
  /** Optional cap on the number of tiles held. Default: no cap. */
  maxTiles?: number;
  /** Tiles per axis of the map, for the page table. Default: learned from keys. */
  tilesPerDim?: number;
}

/** Default tile store budget: 96 Mi texels, i.e. 96 MiB of R8 texture. */
export const DEFAULT_MAX_TEXELS = 96 * 1024 * 1024;

/** Array texture layers assumed available when there is no GL context. */
const HEADLESS_MAX_LAYERS = 2048;

/** Fewest layers worth allocating, however large the tiles are. */
const MIN_LAYERS = 16;

/** What the renderer needs to draw the loaded tiles of the current level. */
export interface DetailTextures {
  /** R8 array texture; layer = a tile, `tileRes` texels square. */
  tiles: WebGLTexture;
  /** R16UI texture, `tilesPerDim` square: 0 = not loaded, else layer + 1. */
  pageTable: WebGLTexture;
  tilesPerDim: number;
  tileRes: number;
  level: number;
}

/**
 * Holds the decoded tiles of the mip level currently on screen.
 *
 * Tiles are stored in file coordinates. They sit in the layers of one array
 * texture, and a page table maps (file column, file row) to a layer, so the
 * map shader can fetch whichever tile a pixel needs after it has mapped the
 * pixel from display to file coordinates.
 *
 * One level is held at a time. Changing level drops the store; the tiles for
 * the new level are decoded on demand.
 *
 * Usage:
 * 1. Call `setVisibleKeys()` (or `updateVisibleTiles()`) on camera change.
 * 2. Decode any visible key whose tile is not loaded, and call `loadTile()`.
 * 3. Pass `getDetailTextures()` to the renderer.
 * 4. Call `dispose()` when done.
 */
export class TileManager {
  private gl: WebGL2RenderingContext | null;
  private cache: Map<string, Tile> = new Map();
  private maxTiles: number;
  private maxTexels: number;
  private cachedTexels = 0;
  private tilesPerDim: number;

  /** Level whose tiles are held, or -1 when the store is empty. */
  private level = -1;
  /** Texels per side of a tile at `level`. */
  private tileRes = 0;
  /** Layers in the array texture at `level`. */
  private layerCount = 0;
  private freeLayers: number[] = [];
  private arrayTexture: WebGLTexture | null = null;

  private pageTable: Uint16Array = new Uint16Array(0);
  private pageTableTexture: WebGLTexture | null = null;
  private pageTableDirty = false;

  /** The set of tile keys that were visible after the last update. */
  private _visibleKeys: TileKey[] = [];
  /** Same set as strings. Visible tiles are never evicted. */
  private visibleSet: Set<string> = new Set();

  constructor(gl: WebGL2RenderingContext | null, options: TileManagerOptions = {}) {
    this.gl = gl;
    this.maxTiles = options.maxTiles ?? Infinity;
    this.maxTexels = options.maxTexels ?? DEFAULT_MAX_TEXELS;
    this.tilesPerDim = options.tilesPerDim ?? 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Recalculate which tiles are needed for the current camera state, assuming
   * display coordinates equal file coordinates. Use `setVisibleKeys` with
   * `getVisibleTileKeysMapped` once the order has been curated.
   */
  updateVisibleTiles(
    camera: CameraState,
    canvasWidth: number,
    canvasHeight: number,
    tilesPerDim: number,
    numMipMaps: number,
  ): TileKey[] {
    if (this.tilesPerDim === 0) this.tilesPerDim = tilesPerDim;
    return this.setVisibleKeys(
      getVisibleTileKeys(camera, canvasWidth, canvasHeight, tilesPerDim, numMipMaps),
    );
  }

  /**
   * Declare the tiles the current view needs. All keys must share one level.
   * If that level differs from the one held, the store is dropped.
   */
  setVisibleKeys(keys: TileKey[]): TileKey[] {
    this._visibleKeys = keys;
    this.visibleSet = new Set();
    if (keys.length > 0 && this.level !== -1 && keys[0].level !== this.level) this.resetStore();

    // Visible tiles are exempt from eviction; also touch them so they stay
    // warm for a while after they scroll out of view.
    const now = performance.now();
    for (const key of keys) {
      const strKey = tileKeyToString(key);
      this.visibleSet.add(strKey);
      const tile = this.cache.get(strKey);
      if (tile) tile.lastUsed = now;
    }

    // Tiles that just left the screen may now be over the cap.
    while (this.cache.size > this.maxTiles) {
      if (!this.evictLRU()) break;
    }
    return keys;
  }

  /** Get the tile keys from the most recent visibility update. */
  get visibleKeys(): TileKey[] {
    return this._visibleKeys;
  }

  /**
   * Retrieve a cached tile by its key, or undefined if not cached.
   * Accessing a tile updates its lastUsed timestamp for LRU purposes.
   */
  getTile(key: TileKey): Tile | undefined {
    const tile = this.cache.get(tileKeyToString(key));
    if (tile) tile.lastUsed = performance.now();
    return tile;
  }

  /**
   * Store decoded tile data in a layer and record the tile as loaded. `data`
   * is not retained.
   *
   * Returns undefined, storing nothing, when the tile is for a level other
   * than the one on screen (a decode that arrived late), or when every layer
   * is held by a tile that is on screen.
   */
  loadTile(key: TileKey, data: Float32Array): Tile | undefined {
    const strKey = tileKeyToString(key);
    const res = Math.round(Math.sqrt(data.length));
    if (res * res !== data.length || res === 0) {
      console.warn(`TileManager: data length ${data.length} is not a perfect square`);
      return undefined;
    }

    // The level the view wants; with no view declared (headless use), any.
    const wanted = this._visibleKeys.length > 0 ? this._visibleKeys[0].level : key.level;
    if (key.level !== wanted) return undefined; // a decode that arrived late
    if (this.level !== -1 && this.level !== key.level) this.resetStore();
    if (this.level === -1) this.openStore(key.level, res);
    if (res !== this.tileRes) return undefined;

    const existing = this.cache.get(strKey);
    if (existing && existing.state === 'loaded') {
      existing.lastUsed = performance.now();
      this.uploadLayer(existing.layer, data);
      return existing;
    }
    if (existing) this.dropTile(strKey, existing); // pending or error placeholder

    while (this.freeLayers.length === 0 || this.cache.size + 1 > this.maxTiles) {
      if (!this.evictLRU()) return undefined;
    }

    const layer = this.freeLayers.pop()!;
    const tile: Tile = {
      key, layer, texels: data.length, lastUsed: performance.now(), state: 'loaded',
    };
    this.uploadLayer(layer, data);
    this.cache.set(strKey, tile);
    this.cachedTexels += tile.texels;
    this.setPageEntry(key, layer + 1);
    return tile;
  }

  /**
   * Mark a tile as pending (loading in progress).
   * This prevents duplicate load requests.
   */
  markPending(key: TileKey): void {
    const strKey = tileKeyToString(key);
    if (this.cache.has(strKey)) return;
    this.cache.set(strKey, {
      key, layer: -1, texels: 0, lastUsed: performance.now(), state: 'pending',
    });
  }

  /** Mark a tile as having failed to load. */
  markError(key: TileKey): void {
    const tile = this.cache.get(tileKeyToString(key));
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

  /** The store's budget in texels. */
  get texelBudget(): number {
    return this.maxTexels;
  }

  /** Texels currently held by loaded tiles. */
  get texelsInUse(): number {
    return this.cachedTexels;
  }

  /** Level whose tiles are held, or -1 when empty. */
  get currentLevel(): number {
    return this.level;
  }

  /** Layers available at the current level (0 when empty). */
  get layers(): number {
    return this.layerCount;
  }

  /**
   * The page table for the current level: entry [row * tilesPerDim + col] is
   * 0 when that tile is not loaded, else its layer + 1.
   */
  getPageTable(): Uint16Array {
    return this.pageTable;
  }

  /**
   * Textures for drawing the loaded tiles, or null when there is nothing to
   * draw (no GL context, or no tile loaded). Uploads the page table if it
   * changed since the last call.
   */
  getDetailTextures(): DetailTextures | null {
    const gl = this.gl;
    if (!gl || !this.arrayTexture || this.cachedTexels === 0 || this.tilesPerDim <= 0) return null;

    if (!this.pageTableTexture) {
      this.pageTableTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.pageTableTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.pageTableDirty = true;
    }
    if (this.pageTableDirty && this.pageTableTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.pageTableTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.R16UI, this.tilesPerDim, this.tilesPerDim, 0,
        gl.RED_INTEGER, gl.UNSIGNED_SHORT, this.pageTable,
      );
      this.pageTableDirty = false;
    }
    if (!this.pageTableTexture) return null;

    return {
      tiles: this.arrayTexture,
      pageTable: this.pageTableTexture,
      tilesPerDim: this.tilesPerDim,
      tileRes: this.tileRes,
      level: this.level,
    };
  }

  /** Check if a tile is cached (any state: pending, loaded, or error). */
  hasTile(key: TileKey): boolean {
    return this.cache.has(tileKeyToString(key));
  }

  /** Remove a specific tile from the cache and free its layer. */
  removeTile(key: TileKey): boolean {
    const strKey = tileKeyToString(key);
    const tile = this.cache.get(strKey);
    if (!tile) return false;
    this.dropTile(strKey, tile);
    return true;
  }

  /** Release every tile and all GL resources. */
  dispose(): void {
    this.resetStore();
    if (this.gl && this.pageTableTexture) this.gl.deleteTexture(this.pageTableTexture);
    this.pageTableTexture = null;
    this._visibleKeys = [];
    this.visibleSet = new Set();
  }

  // -----------------------------------------------------------------------
  // Store lifecycle
  // -----------------------------------------------------------------------

  /** Drop every tile and the array texture; the store becomes empty. */
  private resetStore(): void {
    if (this.gl && this.arrayTexture) this.gl.deleteTexture(this.arrayTexture);
    this.arrayTexture = null;
    this.cache.clear();
    this.cachedTexels = 0;
    this.level = -1;
    this.tileRes = 0;
    this.layerCount = 0;
    this.freeLayers = [];
    if (this.pageTable.length > 0) {
      this.pageTable.fill(0);
      this.pageTableDirty = true;
    }
  }

  /** Allocate the array texture for a level whose tiles are `res` square. */
  private openStore(level: number, res: number): void {
    const gl = this.gl;
    const maxLayers = gl
      ? (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number)
      : HEADLESS_MAX_LAYERS;
    const byBudget = Math.floor(this.maxTexels / (res * res));
    const layers = Math.max(1, Math.min(maxLayers, Math.max(MIN_LAYERS, byBudget)));

    this.level = level;
    this.tileRes = res;
    this.layerCount = layers;
    this.freeLayers = Array.from({ length: layers }, (_, i) => layers - 1 - i);

    if (gl) {
      this.arrayTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrayTexture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, res, res, layers);
      // Tiles are read with texelFetch, which ignores filtering; NEAREST
      // states the intent and keeps the texture complete.
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }
  }

  private setPageEntry(key: TileKey, value: number): void {
    const n = Math.max(this.tilesPerDim, key.col + 1, key.row + 1);
    if (n !== this.tilesPerDim || this.pageTable.length !== n * n) {
      // Grow (or first-size) the table, keeping existing entries.
      const next = new Uint16Array(n * n);
      const old = this.tilesPerDim;
      if (this.pageTable.length === old * old) {
        for (let r = 0; r < old; r++) {
          for (let c = 0; c < old; c++) next[r * n + c] = this.pageTable[r * old + c];
        }
      }
      this.pageTable = next;
      this.tilesPerDim = n;
    }
    this.pageTable[key.row * n + key.col] = value;
    this.pageTableDirty = true;
  }

  private dropTile(strKey: string, tile: Tile): void {
    if (tile.layer >= 0) {
      this.freeLayers.push(tile.layer);
      this.setPageEntry(tile.key, 0);
    }
    this.cachedTexels -= tile.texels;
    this.cache.delete(strKey);
  }

  /**
   * Evict the least-recently-used tile that is not visible.
   * Returns false when there is nothing evictable.
   *
   * Visible tiles are never evicted: evicting a tile that is on screen leaves
   * a hole that is refilled by evicting another visible tile, which never
   * settles. A view needing more tiles than there are layers keeps the ones
   * it has (the most central, since those are requested first) and shows the
   * overview for the rest.
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
    this.dropTile(oldestKey, this.cache.get(oldestKey)!);
    return true;
  }

  // -----------------------------------------------------------------------
  // GL upload
  // -----------------------------------------------------------------------

  /** Write [0,1] float intensities into one layer as R8 bytes. */
  private uploadLayer(layer: number, data: Float32Array): void {
    const gl = this.gl;
    if (!gl || !this.arrayTexture) return;
    const u8 = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      u8[i] = Math.round(Math.min(1.0, Math.max(0.0, data[i])) * 255);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrayTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, this.tileRes, this.tileRes, 1,
      gl.RED, gl.UNSIGNED_BYTE, u8,
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }
}
