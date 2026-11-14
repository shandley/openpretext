/**
 * Do drops in contact along a sequence mark the places a curator cut it?
 *
 * Takes a map and the AGP a curator made from it. For every sequence it
 * computes the continuity profile (src/analysis/EndContacts.ts: contact
 * between the windows either side of each position, relative to true
 * neighbours) and lists the places it falls to the threshold or below. It
 * then counts how many of the curator's cuts have such a drop within one
 * window, and how many drops are at places the curator did not cut.
 *
 *   npx tsx bench/continuity-dips-check.ts <map.pretext> <curator.agp> [window=24] [threshold=0.5]
 */
import { readFileSync } from 'node:fs';
import { loadPretextFromDisk } from './loader';
import type { MapData } from '../src/core/State';
import { parseAGP } from '../src/formats/AGPParser';
import { TileSampler } from '../src/analysis/TileSampler';
import { EndContactScorer, continuityProfile, findDips } from '../src/analysis/EndContacts';

const [mapPath, agpPath, wArg, thrArg] = process.argv.slice(2);
const W = Number(wArg ?? 24), THR = Number(thrArg ?? 0.5);
(async () => {
  const loaded = await loadPretextFromDisk(mapPath);
  const h = loaded.parsed.header;
  const map = { filename: mapPath, textureSize: loaded.textureSize, numMipMaps: h.mipMapLevels, tileResolution: h.textureResolution,
    tilesPerDimension: h.numberOfTextures1D, contigs: loaded.contigs, contactMap: null, rawTiles: loaded.parsed.tiles, parsedHeader: h,
    extensions: new Map(), genomeLength: Number(h.totalGenomeLength), fileContigCount: loaded.contigs.length } satisfies MapData;
  const N = map.textureSize, L = map.genomeLength!;
  const known = new Map(loaded.contigs.map((c, i) => [c.name, i]));
  const breaks = new Map<number, number[]>();
  const rows = parseAGP(readFileSync(agpPath, 'utf8')).rows;
  for (const r of rows) {
    const id = known.get(r.component) ?? known.get(`hap_${r.component}`);
    if (id === undefined) continue;
    const c = loaded.contigs[id];
    const t = Math.round((r.end * N) / L);
    if (t > 0 && t < c.pixelEnd - c.pixelStart) { if (!breaks.has(id)) breaks.set(id, []); breaks.get(id)!.push(t); }
  }
  const sampler = new TileSampler({ tiles: loaded.parsed.tiles, header: h });
  const order = loaded.contigs.map((_, i) => i);
  const scorer = new EndContactScorer(sampler, map, order, W);
  let found = 0, total = 0, extra = 0, unscorable = 0;
  const misses: string[] = [], extras: string[] = [];
  for (const id of order) {
    const c = loaded.contigs[id];
    const width = c.pixelEnd - c.pixelStart;
    const truth = breaks.get(id) ?? [];
    if (width < 2 * W) { unscorable += truth.length; continue; }
    const profile = continuityProfile(scorer, sampler, map, id, W);
    const dips = findDips(profile, THR);
    const used = new Set<number>();
    for (const t of truth) {
      if (t < W || t > width - W) { unscorable++; continue; }
      total++;
      const k = dips.findIndex((d, i) => !used.has(i) && Math.abs(d.offset - t) <= W);
      if (k >= 0) { used.add(k); found++; }
      else {
        const near = profile.filter((p) => Math.abs(p.offset - t) <= W).reduce((m, p) => Math.min(m, p.score), 9);
        misses.push(`${c.name}@${t}(${near.toFixed(2)})`);
      }
    }
    dips.forEach((d, i) => { if (!used.has(i) && !truth.some((t) => Math.abs(d.offset - t) <= W)) { extra++; extras.push(`${c.name}@${d.offset}(${d.score.toFixed(2)})`); } });
  }
  console.log(`${mapPath.split('/').pop()}  window ${W} threshold ${THR}`);
  console.log(`  curator breaks inside scorable sequence: ${total}; with a dip within one window: ${found}; too near an end or in a short sequence: ${unscorable}`);
  console.log(`  dips where the curator did not cut: ${extra}`);
  console.log(`  missed: ${misses.slice(0, 14).join(' ')}`);
  console.log(`  extra: ${extras.slice(0, 14).join(' ')}`);
})();
