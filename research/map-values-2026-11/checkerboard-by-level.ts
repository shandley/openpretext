/**
 * The checkerboard entropy as OpenPretext computes it, per chromosome, at the
 * level the app uses and one finer level of the same file. Sequences at least
 * 2% of the map wide are taken as chromosomes.
 *
 *   tsx research/map-values-2026-11/checkerboard-by-level.ts <map.pretext>...
 */
import { loadPretextFromDisk } from '../../bench/loader';
import { computeCheckerboardScore } from '../../src/analysis/CheckerboardScore';
(async () => {
  for (const f of process.argv.slice(2)) {
    const out: string[] = [];
    for (const mipLevel of [undefined, 3]) {
      const a = await loadPretextFromDisk(f, mipLevel === undefined ? undefined : { mipLevel });
      const n = a.overviewSize;
      const ranges = a.contigs
        .map((c) => ({ start: Math.round((c.pixelStart / a.textureSize) * n), end: Math.round((c.pixelEnd / a.textureSize) * n) }))
        .filter((r) => r.end - r.start >= 0.02 * n);
      const r = computeCheckerboardScore(a.contactMap, n, undefined, ranges);
      out.push(`${n}px: entropy ${r.entropy.toFixed(2)} (${r.numChromosomes} chromosomes)`);
    }
    console.log(f.split('/').pop()!.slice(0, 40).padEnd(41), out.join('   '));
  }
})();
