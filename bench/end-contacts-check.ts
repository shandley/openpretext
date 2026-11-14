/**
 * How well do end-contact scores (src/analysis/EndContacts.ts) agree with a
 * curator?
 *
 * Takes a map and the AGP a curator made from it. The AGP is applied to the
 * map the way Import AGP applies it, which gives the curator's pieces in the
 * curator's order. For every join the curator made (two pieces side by side
 * in one painted scaffold that were not side by side in the file), each of
 * the two ends is asked: among all other piece ends on the map, where does
 * the end the curator put next to it rank by contact score?
 *
 * A score that ranked the curator's choice first every time would be a
 * complete guide to placing pieces once they are cut. This measures how far
 * it is from that. It does not test finding where to cut: the pieces are the
 * curator's.
 *
 *   npx tsx bench/end-contacts-check.ts <map.pretext> <curator.agp> [--window 24] [--list]
 */
import { readFileSync } from 'node:fs';
import { loadPretextFromDisk } from './loader';
import type { MapData } from '../src/core/State';
import { parseAGP, planAGPImport } from '../src/formats/AGPParser';
import { REMOVAL_TAGS } from '../src/curation/MetaTagManager';
import { TileSampler } from '../src/analysis/TileSampler';
import { EndContactScorer, type ContigEnd } from '../src/analysis/EndContacts';

const [mapPath, agpPath] = process.argv.slice(2);
const flag = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const WINDOW = Number(flag('--window') ?? 24);
const LIST = process.argv.includes('--list');
const SAME_HAP = process.argv.includes('--same-haplotype');

(async () => {
  const loaded = await loadPretextFromDisk(mapPath);
  const h = loaded.parsed.header;
  const map = {
    filename: mapPath, textureSize: loaded.textureSize, numMipMaps: h.mipMapLevels,
    tileResolution: h.textureResolution, tilesPerDimension: h.numberOfTextures1D,
    contigs: loaded.contigs, contactMap: null, rawTiles: loaded.parsed.tiles, parsedHeader: h,
    extensions: new Map(), genomeLength: Number(h.totalGenomeLength), fileContigCount: loaded.contigs.length,
  } satisfies MapData;

  // Some curator files drop a prefix the map's names carry (fAplLin1: `hap_`).
  const known = new Set(loaded.contigs.map((c) => c.name));
  const parsed = parseAGP(readFileSync(agpPath, 'utf8'));
  let renamed = 0;
  for (const r of parsed.rows) {
    if (!known.has(r.component) && known.has(`hap_${r.component}`)) { r.component = `hap_${r.component}`; renamed++; }
  }
  const plan = planAGPImport(parsed, map);
  const curated: MapData = { ...map, contigs: plan.contigs };
  const order = plan.contigOrder;

  const scaffoldOf = new Map<number, number>();
  plan.scaffolds.forEach((s, k) => s.contigIds.forEach((id) => scaffoldOf.set(id, k)));
  const tags = new Map(plan.tags);
  const loose = (id: number) => (tags.get(id) ?? []).some((t) => t === 'Unloc' || REMOVAL_TAGS.includes(t));

  const sampler = new TileSampler({ tiles: loaded.parsed.tiles, header: h });
  const scorer = new EndContactScorer(sampler, curated, order, WINDOW);
  const end = (i: number, side: 'left' | 'right') => scorer.ends.find((e) => e.orderIndex === i && e.side === side);
  // Two facing ends that are neighbouring texels of the file were never apart.
  const contiguous = (a: ContigEnd, b: ContigEnd) => Math.abs(a.tip - b.tip) === 1 && a.inward !== b.inward;

  interface Row { name: string; side: string; partner: string; rank: number; score: number; window: number; best: string; bestScore: number }
  const rows: Row[] = [];
  let kept = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    const [x, y] = [order[i], order[i + 1]];
    if (!scaffoldOf.has(x) || scaffoldOf.get(x) !== scaffoldOf.get(y)) continue;
    if (loose(x) || loose(y)) continue;
    const a = end(i, 'right');
    const b = end(i + 1, 'left');
    if (!a || !b) continue;
    if (contiguous(a, b)) { kept++; continue; }
    for (const [e, other] of [[a, b], [b, a]] as Array<[ContigEnd, ContigEnd]>) {
      let rep = scorer.report(e.orderIndex, e.side, SAME_HAP ? 100000 : 1)!;
      if (SAME_HAP) {
        // Diagnostic: drop candidates whose name carries the other haplotype.
        const hapOf = (id: number) => /(^|[._])H([12])([._]|$)/i.exec(curated.contigs[id].name)?.[2] ?? '';
        const mine = hapOf(e.contigId);
        const best = rep.best.filter((c) => hapOf(c.contigId) === mine);
        rep = { ...rep, best, neighbourRank: 1 + best.filter((c) => c.score > rep.neighbour!.score).length };
      }
      const top = rep.best[0];
      rows.push({
        name: curated.contigs[e.contigId].name, side: e.side,
        partner: `${curated.contigs[other.contigId].name}.${other.side}`,
        rank: rep.neighbourRank!, score: rep.neighbour!.score, window: rep.neighbour!.window,
        best: `${curated.contigs[top.contigId].name}.${top.side}`, bestScore: top.score,
      });
    }
  }

  if (LIST) {
    for (const r of rows) {
      console.log(`${r.rank === 1 ? ' ' : '*'} ${r.name}.${r.side} -> ${r.partner}  rank ${r.rank}  score ${r.score.toFixed(2)}  window ${r.window}` +
        (r.rank === 1 ? '' : `  (best ${r.best} ${r.bestScore.toFixed(2)})`));
    }
  }
  const n = rows.length;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const pct = (k: number, of: number) => (of === 0 ? '-' : `${k}/${of} (${Math.round((100 * k) / of)}%)`);
  const scores = rows.map((r) => r.score).sort((p, q) => p - q);
  console.log(`map ${mapPath.split('/').pop()}`);
  console.log(`  ${order.length} pieces, ${scorer.ends.length} ends; window ${WINDOW} texels` + (renamed ? `; ${renamed} AGP rows renamed with hap_` : ''));
  console.log(`  curator joins: ${n / 2} (${n} ends); neighbours left as in the file: ${kept}`);
  console.log(`  curator's partner ranked first: ${pct(count((r) => r.rank === 1), n)}; in the first three: ${pct(count((r) => r.rank <= 3), n)}`);
  const full = rows.filter((r) => r.window >= WINDOW);
  const small = rows.filter((r) => r.window < WINDOW);
  console.log(`    ends with a full window: first ${pct(full.filter((r) => r.rank === 1).length, full.length)}`);
  console.log(`    ends with a smaller window (short pieces): first ${pct(small.filter((r) => r.rank === 1).length, small.length)}`);
  if (n) console.log(`  score of the curator's partner: median ${scores[n >> 1].toFixed(2)}, lowest ${scores[0].toFixed(2)}`);
})().catch((e) => { console.error(e); process.exit(1); });
