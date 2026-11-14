/**
 * Check the haplotype-order warning against the tool it predicts.
 *
 * `src/export/HaplotypeOrder.ts` repeats how Sanger's `pretext-to-asm` groups
 * painted scaffolds of several haplotypes into chromosomes. This script lays
 * out a small made-up genome (three chromosomes, two haplotypes) in several
 * orders, writes OpenPretext's AGP for each, runs the real `pretext-to-asm`
 * on it, and compares what the tool did with what the module said it would:
 *
 *   - how many scaffolds got a lettered name (SUPER_2A, SUPER_2B, ...),
 *   - whether the tool stopped.
 *
 * Setup (once), as for bench/agp-acceptance.ts:
 *   git clone https://github.com/sanger-tol/agp-tpf-utils test-data/agp-tpf-utils
 *   cd test-data/agp-tpf-utils && uv venv .venv && uv pip install --python .venv/bin/python -e .
 * Run:
 *   npx tsx bench/haplotype-order-check.ts
 *
 * Work files go under test-data/haplotype-order/ (not tracked).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, type ContigInfo, type MapData } from '../src/core/State';
import { metaTags } from '../src/curation/MetaTagManager';
import { contigExclusion } from '../src/curation/ContigExclusion';
import { exportAGP } from '../src/export/AGPWriter';
import { buildAGPObjects } from '../src/export/AGPModel';
import { checkHaplotypeOrder, paintedAutosomes } from '../src/export/HaplotypeOrder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'test-data/agp-tpf-utils/.venv/bin/pretext-to-asm');
const WORK = join(ROOT, 'test-data/haplotype-order');

// Sequence name -> width in texels. 1000 bp per texel. Lengths differ so the
// tool's size ranking is unambiguous. Names carry no haplotype the tool could
// read from them.
const SEQS: Array<[string, number]> = [
  ['seqA', 90], ['seqB', 70], ['seqC', 50], ['seqD', 88], ['seqE', 68], ['seqF', 48], ['seqG', 20],
];
const BP_PER_TEXEL = 1000;

/** One painted scaffold: the sequence it holds and its tags. Unlisted sequences stay unpainted. */
type Layout = Array<[string, string[]]>;

interface Scenario { name: string; layout: Layout }

const H1 = 'Hap_1';
const H2 = 'Hap_2';
const SCENARIOS: Scenario[] = [
  { name: 'partners side by side', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqB', [H1]], ['seqE', [H2]], ['seqC', [H1]], ['seqF', [H2]]] },
  { name: 'all of one haplotype, then the other', layout: [['seqA', [H1]], ['seqB', [H1]], ['seqC', [H1]], ['seqD', [H2]], ['seqE', [H2]], ['seqF', [H2]]] },
  { name: 'one pair out of place', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqB', [H1]], ['seqC', [H1]], ['seqE', [H2]], ['seqF', [H2]]] },
  { name: 'chromosome with no partner, untagged', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqB', [H1]], ['seqC', [H1]], ['seqF', [H2]]] },
  { name: 'chromosome with no partner, tagged Singleton', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqB', [H1, 'Singleton']], ['seqC', [H1]], ['seqF', [H2]]] },
  { name: 'named sex chromosome between pairs', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqG', ['Z', H1]], ['seqB', [H1]], ['seqE', [H2]]] },
  { name: 'painted scaffold with no haplotype tag', layout: [['seqA', [H1]], ['seqD', [H2]], ['seqB', []]] },
  { name: 'second-haplotype chromosome split off by Singleton', layout: [['seqA', [H1]], ['seqD', [H2, 'Singleton']], ['seqE', [H2]]] },
];

function loadScenario(layout: Layout): void {
  let at = 0;
  const contigs: ContigInfo[] = SEQS.map(([name, texels], i) => {
    const c: ContigInfo = {
      name, originalIndex: i, length: texels * BP_PER_TEXEL,
      pixelStart: at, pixelEnd: at + texels, inverted: false, scaffoldId: null,
    };
    at += texels;
    return c;
  });
  const order: number[] = [];
  metaTags.clearAll();
  contigExclusion.clearAll();
  layout.forEach(([name, tags], k) => {
    const id = SEQS.findIndex(([n]) => n === name);
    contigs[id].scaffoldId = k + 1;
    order.push(id);
    if (tags.length > 0) metaTags.setTags(id, tags);
  });
  for (let id = 0; id < SEQS.length; id++) if (!order.includes(id)) order.push(id);
  const map = {
    filename: 'made-up.pretext', textureSize: at, numMipMaps: 1, tileResolution: at,
    tilesPerDimension: 1, contigs, contactMap: null, rawTiles: null,
    parsedHeader: null, extensions: new Map(),
    genomeLength: at * BP_PER_TEXEL, fileContigCount: SEQS.length,
  } satisfies MapData;
  state.reset();
  state.update({ map, contigOrder: order });
}

function writeFasta(path: string): void {
  // A fixed pseudo-random sequence, so runs are repeatable.
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  const lines: string[] = [];
  for (const [name, texels] of SEQS) {
    lines.push(`>${name}`);
    let seq = '';
    for (let i = 0; i < texels * BP_PER_TEXEL; i++) seq += 'ACGT'[next() % 4];
    for (let i = 0; i < seq.length; i += 60) lines.push(seq.slice(i, i + 60));
  }
  writeFileSync(path, lines.join('\n') + '\n');
}

/** Sequence names in every FASTA the tool wrote. */
function outputNames(dir: string): string[] {
  const names: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.fa$/.test(f)) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (line.startsWith('>')) names.push(line.slice(1).split(/\s/)[0]);
    }
  }
  return names;
}

if (!existsSync(TOOL)) {
  console.error('pretext-to-asm is not set up under test-data/agp-tpf-utils. See the setup lines at the top of this file.');
  process.exit(2);
}
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const fasta = join(WORK, 'made-up.fa');
writeFasta(fasta);

let failures = 0;
SCENARIOS.forEach((sc, i) => {
  loadScenario(sc.layout);
  const s = state.get();
  const autosomes = paintedAutosomes(buildAGPObjects(s.map!, s.contigOrder), s.map!, (id) => metaTags.getTags(id));
  const report = checkHaplotypeOrder(autosomes!);
  const predictStop = report.untagged.length > 0 || report.missingFirst.length > 0;
  const predictLettered = report.lettered.reduce((n, run) => n + run.scaffolds.length, 0);

  const dir = join(WORK, `case${i + 1}`);
  mkdirSync(dir);
  const agp = join(dir, 'openpretext.agp');
  writeFileSync(agp, exportAGP(s));

  let stopped = false;
  let why = '';
  try {
    execFileSync(TOOL, ['--assembly', fasta, '--pretext', agp, '--output', join(dir, 'out.1.fa'), '--no-write-log'], { stdio: 'pipe' });
  } catch (err: any) {
    stopped = true;
    why = (err.stderr?.toString() ?? err.message).trim().split('\n').filter((l: string) => /Error|missing|empty/i.test(l)).slice(0, 2).join(' | ');
  }
  const names = stopped ? [] : outputNames(dir);
  const lettered = names.filter((n) => /^SUPER_\d+[A-Z](_|$)/.test(n));

  const ok = stopped === predictStop && (stopped || lettered.length === predictLettered);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc.name}`);
  console.log(`       predicted: ${predictStop ? 'tool stops' : `${predictLettered} lettered`}`);
  console.log(`       tool:      ${stopped ? `stopped (${why})` : `${lettered.length} lettered${lettered.length ? ': ' + lettered.sort().join(' ') : ''}`}`);
});

console.log(failures === 0
  ? `\nAll ${SCENARIOS.length} layouts: pretext-to-asm did what HaplotypeOrder.ts predicted.`
  : `\n${failures} of ${SCENARIOS.length} layouts differ.`);
process.exit(failures === 0 ? 0 : 1);
