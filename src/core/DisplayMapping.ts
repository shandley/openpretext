/**
 * DisplayMapping — the relationship between display coordinates (what the
 * curator sees, in curated order) and file coordinates (texels as stored in
 * the .pretext).
 *
 * Everything drawn on the map, and everything computed from it, must agree on
 * this mapping. It lives in one module so the overview, the detail tiles and
 * the analyses cannot each grow their own version of it.
 *
 * Units are full-resolution texels along one axis of the square map. The map
 * is symmetric in how it is laid out, so one 1D mapping serves both axes.
 */

import type { ContigInfo, PixelSegment } from './State';

// ---------------------------------------------------------------------------
// Per-contig segments
// ---------------------------------------------------------------------------

/**
 * A contig's texels as display-order slices of the file.
 *
 * A contig loaded from a file, or produced by a cut, is one contiguous span
 * and is described by `pixelStart`/`pixelEnd`/`inverted` alone. Only a join of
 * contigs that are not one contiguous span in the file carries an explicit
 * `pixelSegments` list.
 */
export function getPixelSegments(contig: ContigInfo): PixelSegment[] {
  if (contig.pixelSegments && contig.pixelSegments.length > 0) {
    return contig.pixelSegments.map((s) => ({ ...s }));
  }
  if (contig.pixelEnd <= contig.pixelStart) return [];
  return [{ start: contig.pixelStart, end: contig.pixelEnd, reversed: contig.inverted }];
}

/** Total width of a segment list in texels. */
export function segmentsWidth(segments: PixelSegment[]): number {
  let w = 0;
  for (const s of segments) w += s.end - s.start;
  return w;
}

/**
 * Split a display-order segment list at `offset` texels from its display-left
 * edge, returning [left, right].
 *
 * A reversed segment reads the file backward, so its display-left part is the
 * high end of its file range.
 */
export function splitPixelSegments(
  segments: PixelSegment[],
  offset: number,
): [PixelSegment[], PixelSegment[]] {
  const left: PixelSegment[] = [];
  const right: PixelSegment[] = [];
  let acc = 0;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (acc >= offset) {
      right.push({ ...seg });
    } else if (acc + len <= offset) {
      left.push({ ...seg });
    } else {
      const d = offset - acc; // display texels of this segment on the left side
      if (!seg.reversed) {
        left.push({ start: seg.start, end: seg.start + d, reversed: false });
        right.push({ start: seg.start + d, end: seg.end, reversed: false });
      } else {
        left.push({ start: seg.end - d, end: seg.end, reversed: true });
        right.push({ start: seg.start, end: seg.end - d, reversed: true });
      }
    }
    acc += len;
  }
  return [left, right];
}

/** Reverse a display-order segment list: reverse the order, flip each slice. */
export function flipPixelSegments(segments: PixelSegment[]): PixelSegment[] {
  return segments.map((s) => ({ ...s, reversed: !s.reversed })).reverse();
}

/**
 * Merge neighbouring slices that read one contiguous file span in one
 * direction, and drop empty ones. The mapping is unchanged.
 */
export function normalizePixelSegments(segments: PixelSegment[]): PixelSegment[] {
  const out: PixelSegment[] = [];
  for (const seg of segments) {
    if (seg.end <= seg.start) continue;
    const prev = out[out.length - 1];
    if (prev && prev.reversed === seg.reversed) {
      if (!seg.reversed && prev.end === seg.start) { prev.end = seg.end; continue; }
      if (seg.reversed && seg.end === prev.start) { prev.start = seg.start; continue; }
    }
    out.push({ ...seg });
  }
  return out;
}

/**
 * The `ContigInfo` pixel fields that describe a segment list.
 *
 * One slice is stored as a plain span. Several are stored as `pixelSegments`,
 * with `pixelStart`/`pixelEnd` set so that `pixelEnd - pixelStart` is still
 * the contig's width; in that case `pixelStart` is not a usable file position
 * and `inverted` (passed through as `strand`) is only a strand label.
 */
export function pixelFieldsFor(
  segments: PixelSegment[],
  strand: boolean,
): Pick<ContigInfo, 'pixelStart' | 'pixelEnd' | 'inverted' | 'pixelSegments'> {
  const segs = normalizePixelSegments(segments);
  if (segs.length === 1) {
    return {
      pixelStart: segs[0].start, pixelEnd: segs[0].end,
      inverted: segs[0].reversed, pixelSegments: undefined,
    };
  }
  const start = segs.length > 0 ? segs[0].start : 0;
  return {
    pixelStart: start, pixelEnd: start + segmentsWidth(segs),
    inverted: strand, pixelSegments: segs.length > 0 ? segs : undefined,
  };
}

// ---------------------------------------------------------------------------
// Whole-display runs
// ---------------------------------------------------------------------------

/**
 * One contiguous piece of the display that reads one contiguous piece of the
 * file in one direction. The display is the concatenation of its runs.
 */
export interface DisplayRun {
  /** First display texel of the run. */
  displayStart: number;
  /** Width in texels (> 0). */
  length: number;
  /** Lowest file texel the run reads. */
  fileStart: number;
  /** True when display-left reads the high end of the file span. */
  reversed: boolean;
}

/**
 * Lay the curated order out as runs, left to right. Zero-width contigs
 * contribute nothing. Neighbouring runs that continue one another are merged,
 * so an unedited map (or one with only cuts) is a single run.
 */
export function buildDisplayRuns(contigs: ContigInfo[], contigOrder: number[]): DisplayRun[] {
  const runs: DisplayRun[] = [];
  let displayPos = 0;
  for (const id of contigOrder) {
    const contig = contigs[id];
    if (!contig) throw new Error(`Contig order refers to contig ${id}, which does not exist`);
    for (const seg of getPixelSegments(contig)) {
      const length = seg.end - seg.start;
      if (length <= 0) continue;
      const prev = runs[runs.length - 1];
      if (prev && prev.reversed === seg.reversed) {
        if (!seg.reversed && prev.fileStart + prev.length === seg.start) {
          prev.length += length; displayPos += length; continue;
        }
        if (seg.reversed && seg.end === prev.fileStart) {
          prev.fileStart = seg.start; prev.length += length; displayPos += length; continue;
        }
      }
      runs.push({ displayStart: displayPos, length, fileStart: seg.start, reversed: seg.reversed });
      displayPos += length;
    }
  }
  return runs;
}

/** Total display width covered by a run list, in texels. */
export function displayWidth(runs: DisplayRun[]): number {
  if (runs.length === 0) return 0;
  const last = runs[runs.length - 1];
  return last.displayStart + last.length;
}

/** Index of the run containing display coordinate `u`, or -1 if outside. */
export function findRun(runs: DisplayRun[], u: number): number {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (u < r.displayStart) hi = mid - 1;
    else if (u >= r.displayStart + r.length) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Map a continuous display coordinate (texels, 0 at the left edge) to the
 * continuous file coordinate it shows. Returns NaN outside the display.
 *
 * This is the reference the shader must match: within a run the mapping is
 * linear, with slope +1 or -1.
 */
export function displayToFileCoord(runs: DisplayRun[], u: number): number {
  const i = findRun(runs, u);
  if (i < 0) return NaN;
  const r = runs[i];
  const t = u - r.displayStart;
  return r.reversed ? r.fileStart + r.length - t : r.fileStart + t;
}

/** Map a display texel index to the file texel it shows, or -1 if outside. */
export function displayToFileTexel(runs: DisplayRun[], d: number): number {
  const f = displayToFileCoord(runs, d + 0.5);
  return Number.isNaN(f) ? -1 : Math.floor(f);
}

// ---------------------------------------------------------------------------
// Coarse (overview) resampling
// ---------------------------------------------------------------------------

/**
 * For a square matrix of side `size` that covers the whole map, return for
 * each display cell the file cell it shows.
 *
 * Each display cell is mapped through its centre, so an unedited order gives
 * the identity exactly and an inverted contig is mirrored about its own
 * centre. Cells past the end of the display map to -1.
 *
 * @param fileTexels total file texels along one axis (MapData.textureSize)
 */
export function buildCellRemap(runs: DisplayRun[], fileTexels: number, size: number): Int32Array {
  const remap = new Int32Array(size).fill(-1);
  if (fileTexels <= 0 || size <= 0) return remap;
  const texelsPerCell = fileTexels / size;
  for (let cell = 0; cell < size; cell++) {
    const f = displayToFileCoord(runs, (cell + 0.5) * texelsPerCell);
    if (Number.isNaN(f)) continue;
    remap[cell] = Math.min(size - 1, Math.max(0, Math.floor(f / texelsPerCell)));
  }
  return remap;
}
