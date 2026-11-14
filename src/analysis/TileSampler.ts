/**
 * TileSampler — contact values read from the file's detail tiles, for
 * analyses that need more resolution than the overview matrix has.
 *
 * The overview is the coarsest mip level of the map, about a megabase per
 * cell on a vertebrate genome. Questions about one contig end or one
 * breakpoint need the finer levels, which the app already holds as raw tiles
 * for drawing. This reads them on demand and keeps a bounded number decoded.
 *
 * Coordinates are FILE texels (full resolution, as stored). Callers that work
 * on the curated layout convert through DisplayMapping first. Values are the
 * file's stored intensities in [0, 1], exactly as the map shows them.
 *
 * Pure: no DOM, no singletons.
 */

import type { PretextHeader } from '../formats/PretextParser';
import { decodeTile } from '../renderer/TileDecoder';

export interface TileSource {
  /** Raw BC4 data per upper-triangular tile (MapData.rawTiles). */
  tiles: Uint8Array[];
  header: PretextHeader;
}

/** Cells a box should span on its shorter side before a finer level is used. */
const TARGET_CELLS = 6;

export class TileSampler {
  private readonly cache = new Map<string, Float32Array>();

  /**
   * @param maxTiles decoded tiles kept (least recently used dropped first).
   *   A tile at level 2 of a 1024-texel texture is 256 KB.
   */
  constructor(private readonly source: TileSource, private readonly maxTiles = 160) {}

  /** Texels along one axis of the map. */
  get texels(): number {
    return this.source.header.numberOfPixels1D;
  }

  /** The coarsest level (0 = full resolution) at which a side of `texels` still spans TARGET_CELLS cells. */
  levelFor(texels: number): number {
    const max = this.source.header.mipMapLevels - 1;
    const level = Math.floor(Math.log2(Math.max(1, texels) / TARGET_CELLS));
    return Math.max(0, Math.min(max, level));
  }

  private tile(level: number, col: number, row: number): Float32Array {
    const key = `${level}:${col}:${row}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh its place in the eviction order.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const h = this.source.header;
    const data = decodeTile({ level: h.mipMapLevels - 1 - level, col, row }, this.source.tiles, h);
    this.cache.set(key, data);
    if (this.cache.size > this.maxTiles) this.cache.delete(this.cache.keys().next().value as string);
    return data;
  }

  /** The value of cell (cx, cy) at `level`, where a cell is 2^level texels wide. */
  cell(level: number, cx: number, cy: number): number {
    const res = this.source.header.textureResolution >> level;
    const data = this.tile(level, Math.floor(cx / res), Math.floor(cy / res));
    return data[(cy % res) * res + (cx % res)];
  }

  /**
   * Mean value over the box of file texels [x0, x1) by [y0, y1), read at the
   * level its shorter side calls for, or at `level` when given. The box is
   * rounded to whole cells and always covers at least one. NaN for an empty
   * or out-of-range box.
   */
  boxMean(x0: number, x1: number, y0: number, y1: number, level?: number): number {
    const N = this.texels;
    if (!(x1 > x0) || !(y1 > y0) || x0 < 0 || y0 < 0 || x1 > N || y1 > N) return NaN;
    const lv = level ?? this.levelFor(Math.min(x1 - x0, y1 - y0));
    const c = 1 << lv;
    const last = (N >> lv) - 1;
    const span = (a: number, b: number): [number, number] => {
      const i0 = Math.min(last, Math.round(a / c));
      return [i0, Math.min(last + 1, Math.max(i0 + 1, Math.round(b / c)))];
    };
    const [cx0, cx1] = span(x0, x1);
    const [cy0, cy1] = span(y0, y1);
    let sum = 0;
    for (let cy = cy0; cy < cy1; cy++) for (let cx = cx0; cx < cx1; cx++) sum += this.cell(lv, cx, cy);
    return sum / ((cx1 - cx0) * (cy1 - cy0));
  }
}
