/**
 * AGPModel — a curation described the way PretextView describes it, as rows
 * for an AGP file.
 *
 * PretextView's AGP is the input to the downstream curation tools (Sanger's
 * `pretext-to-asm`, the VGP `vgl-curation` scripts), together with the FASTA
 * the map was built from. Those tools resolve every row against that FASTA,
 * so a row must name a sequence in it and give an interval of it. This module
 * builds such rows. `research/export-compat-2026-11/` holds the sources; the
 * arithmetic below is transcribed from PretextView 1.0.7, `GenerateAGP`.
 *
 * Everything here is texel arithmetic on the display mapping. A contig's
 * base-pair `length` is never used: it is rounded from a float32 fraction,
 * and PretextView does not use lengths either. The coordinates are therefore
 * accurate to one texel, which the file states in its resolution header and
 * the downstream tools correct against the real sequence.
 *
 * Pure: no DOM, no singletons. AGPWriter supplies tags and exclusions.
 */

import type { ContigInfo, MapData } from '../core/State';
import { getPixelSegments } from '../core/DisplayMapping';

/** One sequence row: an interval of a sequence in the file the map was built from. */
export interface AGPFragment {
  /** Name of the original sequence (AGP column 6). */
  component: string;
  /** Index of that sequence among the file's contigs. */
  sourceIndex: number;
  /** First texel of the fragment within its sequence, and its width in texels. */
  texelStart: number;
  texels: number;
  /** Interval in the sequence, 1-based and inclusive (columns 7 and 8). */
  beg: number;
  end: number;
  /** True when the fragment is shown reverse-complemented. */
  reversed: boolean;
  /** The curated contig (id) this fragment is part of. */
  contigId: number;
}

/** One AGP object: a painted scaffold, or a single contig that is not painted. */
export interface AGPObject {
  /** Whether its rows carry `Painted`: its contigs are assigned to a scaffold. */
  painted: boolean;
  /** The ScaffoldManager id it was painted with, or null. */
  scaffoldId: number | null;
  /** Curated contig ids in display order. */
  contigIds: number[];
  /** Rows in display order. Never empty. */
  fragments: AGPFragment[];
}

/** The sequences the map file defines, in file order. */
export function fileContigsOf(map: MapData): ContigInfo[] {
  if (map.fileContigCount !== undefined) return map.contigs.slice(0, map.fileContigCount);
  // Maps built by hand (tests, the demo): everything up to the first contig a
  // cut or join made.
  const firstDerived = map.contigs.findIndex((c) => c.sequenceSegments !== undefined);
  return firstDerived === -1 ? map.contigs : map.contigs.slice(0, firstDerived);
}

/** Total genome length in bp: the file's own figure when the map came from a file. */
export function genomeLengthOf(map: MapData): number {
  if (map.genomeLength !== undefined) return map.genomeLength;
  if (map.parsedHeader) return Number(map.parsedHeader.totalGenomeLength);
  let sum = 0;
  for (const c of fileContigsOf(map)) sum += c.length;
  return sum;
}

/**
 * The base-pair position of texel boundary `texel` within a sequence, for a
 * map `mapTexels` wide covering `genomeLength` bp. PretextView:
 *   (u64)((f64)p / (f64)Number_of_Pixels_1D * (f64)Total_Genome_Length)
 */
export function texelBoundaryBp(texel: number, mapTexels: number, genomeLength: number): number {
  return Math.trunc((texel / mapTexels) * genomeLength);
}

/** Base pairs per texel, as PretextView prints it in the AGP header (`%f`). */
export function formatResolution(mapTexels: number, genomeLength: number): string {
  return (genomeLength / mapTexels).toFixed(6);
}

/** Looks up which file sequence owns a texel. Sequences that own none are skipped. */
class TexelOwners {
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly index: number[] = [];

  constructor(files: ContigInfo[]) {
    files.forEach((c, i) => {
      if (c.pixelEnd > c.pixelStart) {
        this.starts.push(c.pixelStart);
        this.ends.push(c.pixelEnd);
        this.index.push(i);
      }
    });
    for (let k = 1; k < this.starts.length; k++) {
      if (this.starts[k] < this.ends[k - 1]) {
        throw new Error('The map\'s contigs overlap in the file; an AGP cannot be written for it');
      }
    }
  }

  /** Split the file span [start, end) at sequence boundaries, in file order. */
  split(start: number, end: number): Array<{ sourceIndex: number; start: number; end: number; origin: number }> {
    const out: Array<{ sourceIndex: number; start: number; end: number; origin: number }> = [];
    // First sequence whose end is past `start`.
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ends[mid] <= start) lo = mid + 1; else hi = mid;
    }
    let at = start;
    for (let k = lo; k < this.starts.length && at < end; k++) {
      if (this.starts[k] > at) break; // a texel no sequence owns
      const to = Math.min(end, this.ends[k]);
      out.push({ sourceIndex: this.index[k], start: at, end: to, origin: this.starts[k] });
      at = to;
    }
    if (at !== end) {
      throw new Error(`Texels ${at} to ${end} belong to no sequence in the file; an AGP cannot be written for this map`);
    }
    return out;
  }
}

/**
 * Build the AGP objects for a curated order.
 *
 * - A fragment is a run of texels from one file sequence read in one
 *   direction. A contig as loaded is one fragment; a joined contig has one
 *   per part, except that parts which continue one another in the file (a
 *   cut that was joined back) are one fragment again.
 * - Contigs keep their own rows. Two pieces of a cut sequence left side by
 *   side are two rows, as in PretextView 1.0.6 and 1.0.7: the cut is an edit
 *   the downstream tool should see.
 * - A painted object is a run of neighbouring contigs with the same scaffold.
 *   The same scaffold painted in two places gives two objects, as PretextView
 *   numbers scaffolds by position on the map.
 * - A contig that is not painted is an object of its own.
 * - A contig that owns no texel (a sequence too small for the map) has no
 *   rows. PretextView leaves these out, and the downstream tools add back
 *   whatever the AGP does not mention.
 *
 * @param order curated contig ids, left to right.
 */
export function buildAGPObjects(map: MapData, order: number[]): AGPObject[] {
  const files = fileContigsOf(map);
  const owners = new TexelOwners(files);
  const N = map.textureSize;
  const L = genomeLengthOf(map);

  const objects: AGPObject[] = [];
  let current: AGPObject | null = null;

  for (const contigId of order) {
    const contig = map.contigs[contigId];
    if (!contig) throw new Error(`The order names contig ${contigId}, which does not exist`);

    const fragments: AGPFragment[] = [];
    for (const seg of getPixelSegments(contig)) {
      const pieces = owners.split(seg.start, seg.end);
      if (seg.reversed) pieces.reverse();
      for (const p of pieces) {
        const texelStart = p.start - p.origin;
        const texels = p.end - p.start;
        fragments.push({
          component: files[p.sourceIndex].name,
          sourceIndex: p.sourceIndex,
          texelStart,
          texels,
          beg: texelBoundaryBp(texelStart, N, L) + 1,
          end: texelBoundaryBp(texelStart + texels, N, L),
          reversed: seg.reversed,
          contigId,
        });
      }
    }
    if (fragments.length === 0) continue;

    const scaffoldId = contig.scaffoldId ?? null;
    if (scaffoldId !== null && current && current.painted && current.scaffoldId === scaffoldId) {
      current.contigIds.push(contigId);
      current.fragments.push(...fragments);
    } else {
      current = { painted: scaffoldId !== null, scaffoldId, contigIds: [contigId], fragments };
      objects.push(current);
    }
  }
  return objects;
}

/**
 * Check that the fragments tile each file sequence they touch: no overlap
 * and nothing between consecutive pieces. `pretext-to-asm` raises an error on
 * an AGP that fails this. Returns a message per problem; empty when sound.
 *
 * Every curated order passes, since edits only rearrange texels. It is here
 * so that a bug in the mapping stops an export instead of reaching a curator's
 * pipeline.
 */
export function checkTiling(objects: AGPObject[]): string[] {
  const bySource = new Map<number, AGPFragment[]>();
  for (const o of objects) {
    for (const f of o.fragments) {
      if (!bySource.has(f.sourceIndex)) bySource.set(f.sourceIndex, []);
      bySource.get(f.sourceIndex)!.push(f);
    }
  }
  const problems: string[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => a.texelStart - b.texelStart);
    let at = 0;
    for (const f of list) {
      if (f.texelStart !== at) {
        problems.push(
          `${f.component}: texels ${Math.min(at, f.texelStart)} to ${Math.max(at, f.texelStart)} are ` +
          `${f.texelStart > at ? 'missing' : 'used twice'}`);
      }
      at = Math.max(at, f.texelStart + f.texels);
    }
  }
  return problems;
}
