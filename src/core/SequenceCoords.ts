/**
 * SequenceCoords — where a point on the curated map lies in the sequences the
 * map was built from, and the reverse.
 *
 * A curator reads positions as "sequence, base pair" (that is what an AGP row
 * holds), while the map is laid out in texels in curated order. This module
 * converts between the two with the same arithmetic the AGP writer uses
 * (AGPModel.texelBoundaryBp), so a position read off the map is the position
 * an export would write.
 *
 * Pure: no DOM, no singletons.
 */

import type { ContigInfo, MapData } from './State';
import { getPixelSegments } from './DisplayMapping';
import { fileContigsOf, genomeLengthOf, texelBoundaryBp } from '../export/AGPModel';

/** A texel of the curated map, described in the file's sequences. */
export interface SequencePosition {
  /** Position of the curated contig in the order, and its id. */
  orderIndex: number;
  contigId: number;
  /** Texels from the contig's display-left edge (what `cut` takes). */
  offset: number;
  /** Width of the curated contig in texels. */
  contigTexels: number;
  /** Index and name of the file sequence that owns the texel. */
  sourceIndex: number;
  sequence: string;
  /** Texel within that sequence, counted from its start. */
  sequenceTexel: number;
  /** First and last base of the texel in the sequence, 1-based and inclusive. */
  bpStart: number;
  bpEnd: number;
  /** True when the map shows this stretch reverse-complemented. */
  reversed: boolean;
}

/** Index of the file sequence owning file texel `f`, or -1. */
function ownerOf(files: ContigInfo[], f: number): number {
  let lo = 0;
  let hi = files.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (files[mid].pixelEnd <= f) lo = mid + 1; else hi = mid;
  }
  return lo < files.length && files[lo].pixelStart <= f ? lo : -1;
}

/**
 * Describe display texel `displayTexel` (0 at the left edge of the map).
 * Returns null outside the curated layout or on a texel no sequence owns.
 */
export function locateDisplayTexel(map: MapData, order: number[], displayTexel: number): SequencePosition | null {
  if (!Number.isInteger(displayTexel) || displayTexel < 0) return null;
  const N = map.textureSize;
  const L = genomeLengthOf(map);
  if (!(N > 0) || !(L > 0)) return null;
  let at = 0;
  for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
    const contigId = order[orderIndex];
    const contig = map.contigs[contigId];
    if (!contig) return null;
    const width = contig.pixelEnd - contig.pixelStart;
    if (displayTexel >= at + width) { at += width; continue; }

    const offset = displayTexel - at;
    let acc = 0;
    for (const seg of getPixelSegments(contig)) {
      const len = seg.end - seg.start;
      if (offset >= acc + len) { acc += len; continue; }
      const t = offset - acc;
      const fileTexel = seg.reversed ? seg.end - 1 - t : seg.start + t;
      const files = fileContigsOf(map);
      const sourceIndex = ownerOf(files, fileTexel);
      if (sourceIndex < 0) return null;
      const sequenceTexel = fileTexel - files[sourceIndex].pixelStart;
      return {
        orderIndex, contigId, offset, contigTexels: width,
        sourceIndex, sequence: files[sourceIndex].name, sequenceTexel,
        bpStart: texelBoundaryBp(sequenceTexel, N, L) + 1,
        bpEnd: texelBoundaryBp(sequenceTexel + 1, N, L),
        reversed: seg.reversed,
      };
    }
    return null;
  }
  return null;
}

/** The texel offset a cut lands on for a cursor `fraction` of the way across a contig. */
export function cutOffsetAt(contigTexels: number, fraction: number): number {
  return Math.round(fraction * contigTexels);
}

/** A break between two neighbouring texels of one sequence. */
export interface SequenceBoundary {
  sequence: string;
  /** Texel boundary within the sequence: the break is before this texel. */
  texel: number;
  /** Last base before the break (the `end` an AGP row would carry). */
  bp: number;
}

/**
 * The sequence position of the break a cut at `offset` texels into the contig
 * at `orderIndex` would make. Null when the offset is not inside the contig,
 * or the two sides are not neighbours in one sequence (a join lies there).
 */
export function boundaryAtOffset(map: MapData, order: number[], orderIndex: number, offset: number): SequenceBoundary | null {
  let start = 0;
  for (let i = 0; i < orderIndex; i++) {
    const c = map.contigs[order[i]];
    if (!c) return null;
    start += c.pixelEnd - c.pixelStart;
  }
  const left = locateDisplayTexel(map, order, start + offset - 1);
  const right = locateDisplayTexel(map, order, start + offset);
  if (!left || !right || left.orderIndex !== orderIndex || right.orderIndex !== orderIndex) return null;
  if (left.sourceIndex !== right.sourceIndex || Math.abs(left.sequenceTexel - right.sequenceTexel) !== 1) return null;
  const texel = Math.max(left.sequenceTexel, right.sequenceTexel);
  return { sequence: left.sequence, texel, bp: texelBoundaryBp(texel, map.textureSize, genomeLengthOf(map)) };
}

/** Where to cut the curated layout to break a sequence at a base-pair position. */
export interface SequenceCut {
  orderIndex: number;
  /** Offset for CurationEngine.cut. */
  offset: number;
  boundary: SequenceBoundary;
  /** Width of the sequence in texels. */
  sequenceTexels: number;
}

/**
 * Find the cut that breaks file sequence `sequenceName` at `bp`.
 *
 * The break goes on the nearest texel boundary, since a texel is the finest
 * thing the map can separate. Names match exactly, then without case if that
 * is unambiguous.
 *
 * @throws with a sentence for the curator when the sequence is unknown, the
 *   position is outside it or rounds to one of its ends, or a break is
 *   already there.
 */
export function findSequenceCut(map: MapData, order: number[], sequenceName: string, bp: number): SequenceCut {
  const files = fileContigsOf(map);
  let sourceIndex = files.findIndex((c) => c.name === sequenceName);
  if (sourceIndex < 0) {
    const lower = sequenceName.toLowerCase();
    const matches = files.map((c, i) => (c.name.toLowerCase() === lower ? i : -1)).filter((i) => i >= 0);
    if (matches.length > 1) throw new Error(`More than one sequence is named '${sequenceName}' when case is ignored`);
    if (matches.length === 0) {
      throw new Error(
        `No sequence named '${sequenceName}' in the map file. 'cut <sequence> at <bp>' takes the name of an ` +
        'original sequence, not of a piece made by a cut');
    }
    sourceIndex = matches[0];
  }
  const source = files[sourceIndex];
  const sequenceTexels = source.pixelEnd - source.pixelStart;
  const N = map.textureSize;
  const L = genomeLengthOf(map);
  const sequenceBp = texelBoundaryBp(sequenceTexels, N, L);
  if (!Number.isFinite(bp) || bp <= 0 || bp >= sequenceBp) {
    throw new Error(`'${source.name}' is ${sequenceBp.toLocaleString('en-US')} bp on this map; ${bp.toLocaleString('en-US')} bp is not inside it`);
  }
  const texel = Math.round((bp * N) / L);
  if (texel <= 0 || texel >= sequenceTexels) {
    throw new Error(
      `${bp.toLocaleString('en-US')} bp is less than half a texel from the end of '${source.name}' ` +
      `(one texel is about ${Math.round(L / N).toLocaleString('en-US')} bp); there is nothing to cut off`);
  }
  const fileBoundary = source.pixelStart + texel;

  for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
    const contig = map.contigs[order[orderIndex]];
    if (!contig) continue;
    let acc = 0;
    for (const seg of getPixelSegments(contig)) {
      if (seg.start < fileBoundary && fileBoundary < seg.end) {
        const offset = acc + (seg.reversed ? seg.end - fileBoundary : fileBoundary - seg.start);
        return {
          orderIndex, offset, sequenceTexels,
          boundary: { sequence: source.name, texel, bp: texelBoundaryBp(texel, N, L) },
        };
      }
      acc += seg.end - seg.start;
    }
  }
  throw new Error(
    `'${source.name}' is already broken at ${texelBoundaryBp(texel, N, L).toLocaleString('en-US')} bp (texel ${texel})`);
}
