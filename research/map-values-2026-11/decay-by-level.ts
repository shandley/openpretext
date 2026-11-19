import { loadPretextFromDisk } from '../../bench/loader';
import { computeContactDecay } from '../../src/analysis/ContactDecay';
(async () => {
  for (const f of process.argv.slice(2)) {
    const out: string[] = [];
    for (const mipLevel of [undefined, 3, 2]) {
      try {
        const a: any = await loadPretextFromDisk(f, mipLevel === undefined ? undefined : { mipLevel });
        const n = a.overviewSize; let acc = 0;
        const ranges = a.contigs.map((c: any, i: number) => { const s = Math.round((acc / a.textureSize) * n); acc += c.pixelEnd - c.pixelStart; return { start: s, end: Math.round((acc / a.textureSize) * n), orderIndex: i }; });
        const r = computeContactDecay(a.contactMap, n, ranges);
        out.push(`${n}px: ${Number.isFinite(r.decayExponent) ? r.decayExponent.toFixed(2) : 'n/a'} (R2 ${r.rSquared?.toFixed(2)})`);
      } catch (e) { out.push(`level ${mipLevel}: ${(e as Error).message.slice(0, 40)}`); }
    }
    console.log(f.split('/').pop()!.slice(0, 44).padEnd(45), out.join('   '));
  }
})();
