/**
 * EndContacts — which contig ends contact which, read from the detail tiles.
 *
 * Two sequences that are neighbours on a chromosome show strong contact
 * between the ends that touch. A curator reads this by eye as the bright
 * corner where two blocks of the map meet. This module puts a number on it:
 * the mean contact between a window at one contig end and a window at
 * another, divided by the same measure taken between neighbouring windows
 * along unbroken sequence in this map.
 *
 *   about 1   the map is as bright between the two ends as between true neighbours
 *   near 0    as dark as between distant sequence
 *
 * What the number is not: a ratio of contact counts. A `.pretext` file holds
 * map values that PretextMap has scaled by row, compressed and
 * contrast-equalised, separately at each zoom level (docs/PRETEXT_FORMAT.md,
 * "Each level has its own contrast"). The score is a ratio of those values:
 * how bright the box between two ends is, against how bright it is between
 * true neighbours. Values next to the diagonal sit at the top of the scale,
 * so short windows score near 1 against many ends. Each box is divided by a
 * reference read at its own level, but one ranked list can hold boxes read
 * at different levels (research/end-contacts-2026-11/REPORT.md).
 *
 * It answers "what belongs next to this end, and which way round": after a
 * cut at a suspected inversion, the piece's far end scoring higher against
 * its neighbour than its near end is the evidence for turning it.
 *
 * What it cannot tell apart from adjacency: the two haplotype copies of one
 * region in a map built with multi-mapped reads, and repeats shared by two
 * places. Both contact strongly without being neighbours. The numbers are
 * evidence for a curator, not a decision.
 *
 * Works on the curated layout: windows follow cuts, joins, moves and
 * inversions through DisplayMapping. Pure: no DOM, no singletons.
 */

import type { MapData } from '../core/State';
import { getPixelSegments } from '../core/DisplayMapping';
import { fileContigsOf } from '../export/AGPModel';
import { TileSampler } from './TileSampler';

/** Default window at a contig end, in texels. */
export const DEFAULT_END_WINDOW = 24;

export type EndSide = 'left' | 'right';

/** The texels at one end of a contig as displayed. */
export interface ContigEnd {
  orderIndex: number;
  contigId: number;
  side: EndSide;
  /** File texel of the contig's outermost texel on this side. */
  tip: number;
  /** +1 when the contig's interior lies at higher file texels from the tip, -1 when lower. */
  inward: 1 | -1;
  /** Texels available for a window: up to half the contig, within its end segment. */
  available: number;
  /** True when the contig is too small to have two distinct ends; both ends then cover all of it. */
  whole: boolean;
}

/** One candidate partner for an end. */
export interface EndPartner {
  orderIndex: number;
  contigId: number;
  side: EndSide;
  /** Contact relative to true neighbours (see the module comment). */
  score: number;
  /** Window used for this pair, in texels. */
  window: number;
}

export interface EndReport {
  end: ContigEnd;
  /** The end it touches in the current layout, or null at the edge of the map. */
  neighbour: EndPartner | null;
  /** Position of the current neighbour among all candidates, 1 = best. Null with no neighbour. */
  neighbourRank: number | null;
  /** The best-scoring ends, best first. */
  best: EndPartner[];
}

/** The two ends of every contig in the layout that owns at least one texel. */
export function contigEnds(map: MapData, order: number[], windowTexels = DEFAULT_END_WINDOW): ContigEnd[] {
  const ends: ContigEnd[] = [];
  order.forEach((contigId, orderIndex) => {
    const contig = map.contigs[contigId];
    if (!contig) return;
    const segs = getPixelSegments(contig);
    if (segs.length === 0) return;
    const width = contig.pixelEnd - contig.pixelStart;
    const whole = width < 4;
    const half = whole ? width : Math.min(windowTexels, Math.floor(width / 2));
    const first = segs[0];
    const last = segs[segs.length - 1];
    ends.push({
      orderIndex, contigId, side: 'left', whole,
      tip: first.reversed ? first.end - 1 : first.start,
      inward: first.reversed ? -1 : 1,
      available: Math.min(half, first.end - first.start),
    });
    ends.push({
      orderIndex, contigId, side: 'right', whole,
      tip: last.reversed ? last.start : last.end - 1,
      inward: last.reversed ? 1 : -1,
      available: Math.min(half, last.end - last.start),
    });
  });
  return ends;
}

/** File interval [start, end) of the `w` texels at an end. */
function windowOf(end: ContigEnd, w: number): [number, number] {
  return end.inward === 1 ? [end.tip, end.tip + w] : [end.tip - w + 1, end.tip + 1];
}

export class EndContactScorer {
  readonly ends: ContigEnd[];
  private readonly references = new Map<number, number>();

  constructor(
    private readonly sampler: TileSampler,
    private readonly map: MapData,
    private readonly order: number[],
    readonly windowTexels = DEFAULT_END_WINDOW,
    /** Read every box at this level (0 = full resolution). Unset: each box at the level its size calls for. */
    private readonly level?: number,
  ) {
    this.ends = contigEnds(map, order, windowTexels);
  }

  /**
   * Contact between a window of `wa` texels and the `wb` texels that follow
   * it along unbroken sequence: the median over positions spread across the
   * file's sequences. A misjoin inside a sequence lowers a few samples and
   * leaves the median.
   */
  reference(wa: number, wb: number = wa): number {
    const lo = Math.min(wa, wb);
    const hi = Math.max(wa, wb);
    const key = lo * 65536 + hi;
    const cached = this.references.get(key);
    if (cached !== undefined) return cached;
    const spans = fileContigsOf(this.map)
      .map((c) => [c.pixelStart, c.pixelEnd] as const)
      .filter(([s, e]) => e - s >= lo + hi);
    const usable = spans.reduce((t, [s, e]) => t + (e - s - lo - hi + 1), 0);
    const samples: number[] = [];
    if (usable > 0) {
      const step = Math.max(1, Math.floor(usable / 400));
      let skip = Math.floor(step / 2);
      for (const [s, e] of spans) {
        let p = s + lo + skip;
        for (; p <= e - hi; p += step) samples.push(this.sampler.boxMean(p - lo, p, p, p + hi, this.level));
        skip = Math.max(0, p - (e - hi) - 1);
      }
    }
    samples.sort((a, b) => a - b);
    const ref = samples.length > 0 ? samples[samples.length >> 1] : NaN;
    this.references.set(key, ref);
    return ref;
  }

  /**
   * Score two ends against one another. Each end uses the window it has, so
   * a short contig is read against the full window of a long one: more of
   * the map, and fewer of the brightest texels where values are capped. The
   * scale is the same measure between neighbouring windows of those two sizes
   * along unbroken sequence. NaN when the map has no sequence long enough to
   * set that scale.
   */
  score(a: ContigEnd, b: ContigEnd): { score: number; window: number } {
    const wa = Math.max(1, a.available);
    const wb = Math.max(1, b.available);
    const [ax0, ax1] = windowOf(a, wa);
    const [bx0, bx1] = windowOf(b, wb);
    const ref = this.reference(wa, wb);
    return { score: this.sampler.boxMean(ax0, ax1, bx0, bx1, this.level) / ref, window: Math.min(wa, wb) };
  }

  private endOf(orderIndex: number, side: EndSide): ContigEnd | undefined {
    return this.ends.find((e) => e.orderIndex === orderIndex && e.side === side);
  }

  /** The end that touches `end` in the current layout: the facing end of the next contig that owns texels. */
  neighbourOf(end: ContigEnd): ContigEnd | null {
    const step = end.side === 'left' ? -1 : 1;
    for (let i = end.orderIndex + step; i >= 0 && i < this.order.length; i += step) {
      const other = this.endOf(i, end.side === 'left' ? 'right' : 'left');
      if (other) return other;
    }
    return null;
  }

  /**
   * Rank every other contig's ends as partners for one end.
   * @param top how many of the best to return.
   */
  report(orderIndex: number, side: EndSide, top = 5): EndReport | null {
    const end = this.endOf(orderIndex, side);
    if (!end) return null;
    const candidates: EndPartner[] = [];
    for (const other of this.ends) {
      if (other.orderIndex === orderIndex) continue;
      // A contig too small to have two ends is listed once.
      if (other.whole && other.side === 'right') continue;
      const { score, window } = this.score(end, other);
      if (Number.isNaN(score)) continue;
      candidates.push({ orderIndex: other.orderIndex, contigId: other.contigId, side: other.side, score, window });
    }
    candidates.sort((x, y) => y.score - x.score);
    const facing = this.neighbourOf(end);
    let neighbour: EndPartner | null = null;
    let neighbourRank: number | null = null;
    if (facing) {
      const { score, window } = this.score(end, facing);
      neighbour = { orderIndex: facing.orderIndex, contigId: facing.contigId, side: facing.side, score, window };
      neighbourRank = 1 + candidates.filter((c) => c.score > score).length;
    }
    return { end, neighbour, neighbourRank, best: candidates.slice(0, top) };
  }
}

/** A point inside a contig where contact across it falls away. */
export interface ContinuityDip {
  /** Texels from the contig's display-left edge: where a cut would go. */
  offset: number;
  /** Contact across the point relative to true neighbours. */
  score: number;
}

/**
 * Contact across each position of a contig, between the `w` texels on either
 * side, relative to true neighbours. Positions closer than `w` to an end, or
 * to a join inside the contig, are not scored.
 */
export function continuityProfile(
  scorer: EndContactScorer, sampler: TileSampler, map: MapData, contigId: number, w = scorer.windowTexels,
): ContinuityDip[] {
  const contig = map.contigs[contigId];
  if (!contig) return [];
  const ref = scorer.reference(w);
  const step = 1 << sampler.levelFor(w);
  const out: ContinuityDip[] = [];
  let acc = 0;
  for (const seg of getPixelSegments(contig)) {
    const len = seg.end - seg.start;
    for (let t = w; t <= len - w; t += step) {
      // File boundary t texels into the segment, counted in display direction.
      const f = seg.reversed ? seg.end - t : seg.start + t;
      out.push({ offset: acc + t, score: sampler.boxMean(f - w, f, f, f + w) / ref });
    }
    acc += len;
  }
  return out;
}

/**
 * The places in a profile where contact drops to `threshold` or below: the
 * lowest point of each such stretch. On the maps this was developed against,
 * a misjoin between two chromosomes falls below 0.4 and the ends of an
 * inversion often do not fall at all, so an empty result does not mean a
 * contig is sound.
 */
export function findDips(profile: ContinuityDip[], threshold = 0.5): ContinuityDip[] {
  const dips: ContinuityDip[] = [];
  let low: ContinuityDip | null = null;
  for (const p of profile) {
    if (p.score <= threshold) {
      if (!low || p.score < low.score) low = p;
    } else if (low) {
      dips.push(low);
      low = null;
    }
  }
  if (low) dips.push(low);
  return dips;
}

// ---------------------------------------------------------------------------
// For the interface
// ---------------------------------------------------------------------------

/** What the scorer reads from a map: its contig table and size. Small enough to send to a worker. */
export type ContactsMap = Pick<MapData, 'contigs' | 'textureSize' | 'fileContigCount' | 'genomeLength'>;

/** A sampler over tiles held on this thread, or null when there are none to read. */
export function localSampler(map: MapData): TileSampler | null {
  // After a load in the app the tile bytes belong to the decode worker and
  // the arrays left here are empty; see TileDecodeWorkerClient.contacts.
  if (!map.rawTiles || !map.parsedHeader || !map.rawTiles.some((t) => t && t.length > 0)) return null;
  return new TileSampler({ tiles: map.rawTiles, header: map.parsedHeader });
}

/**
 * The contacts of one contig's two ends, as lines of text for the console.
 * @throws when the contig owns no texel.
 */
export function describeContacts(sampler: TileSampler, map: ContactsMap, order: number[], orderIndex: number, top = 5): string[] {
  const scorer = new EndContactScorer(sampler, map as MapData, order);
  const name = (id: number) => map.contigs[id].name;
  const partner = (p: EndPartner) => `${name(p.contigId)} (${p.side} end) ${p.score.toFixed(2)}`;
  const lines: string[] = [];
  const total = scorer.ends.filter((e) => e.orderIndex !== orderIndex && !(e.whole && e.side === 'right')).length;
  for (const side of ['left', 'right'] as const) {
    const rep = scorer.report(orderIndex, side, top);
    if (!rep) throw new Error(`'${name(order[orderIndex])}' owns no texel of the map, so it has no contacts to read`);
    if (rep.end.whole && side === 'right') break;
    const label = rep.end.whole ? 'whole contig (too small to have two ends)' : `${side} end`;
    lines.push(`${label}, ${rep.end.available}-texel window`);
    lines.push(rep.neighbour
      ? `  now next to: ${partner(rep.neighbour)}, ranked ${rep.neighbourRank} of ${total}`
      : '  now next to: nothing (edge of the map)');
    lines.push(`  strongest:   ${rep.best.map(partner).join('; ') || 'none'}`);
  }
  return lines;
}
