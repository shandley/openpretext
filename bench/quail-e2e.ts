/**
 * End-to-end check of a curation made in OpenPretext's own interface.
 *
 * The king quail map (bCotChi1) was curated at Sanger in PretextView, and the
 * AGP PretextView wrote is public. This script makes the same curation again
 * in the running app, without importing that AGP:
 *
 *   1. turns the released AGP into a list of edits (cut, move, invert, paint,
 *      tag) with a small reader of its own, which shares no code with
 *      OpenPretext's AGP reader or writer;
 *   2. loads the real map in a browser and applies the edits through the
 *      interface: cuts, moves, inversions and scaffold painting through the
 *      script console, tags through the sidebar's contig list and tag controls;
 *   3. exports the AGP from the Export menu;
 *   4. compares that file with PretextView's, row by row;
 *   5. with --fasta, runs Sanger's `pretext-to-asm` on both AGPs with the
 *      assembly the map was built from and compares every file it writes.
 *
 * Setup (once; test-data/ is not committed): see bench/agp-acceptance.ts for
 * `pretext-to-asm`. The map was built from the two decontaminated haplotype
 * assemblies under species/Coturnix_chinensis/bCotChi1/assembly_curated/intermediates/
 * on GenomeArk; concatenate them with `H1.` and `H2.` put before each
 * sequence name, as the map names them.
 * Run:
 *   npm run build && npx vite preview --port 4173 &
 *   npx tsx bench/quail-e2e.ts --url http://localhost:4173 [--fasta combined.fa.gz] [--headed]
 */

import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUAIL = join(ROOT, 'test-data/case-study/quail');
const MAP = join(QUAIL, 'bCotChi1.combined.pretext');
const RELEASED = join(QUAIL, 'bCotChi1.combined.pretext.20240422.agp');
const OUT = join(ROOT, 'test-data/quail-e2e/out');
const TOOL = join(ROOT, 'test-data/agp-tpf-utils/.venv/bin/pretext-to-asm');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------------------
// The released AGP, read here with nothing from src/
// ---------------------------------------------------------------------------

interface Row { object: string; seq: string; beg: number; end: number; minus: boolean; painted: boolean; tags: string[] }

function readReleased(text: string): { rows: Row[]; bpPerTexel: number } {
  const res = /HiC MAP RESOLUTION: ([0-9.]+) bp\/texel/.exec(text);
  if (!res) throw new Error('The released AGP has no resolution line');
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f[4] !== 'W') continue;
    const extra = f.slice(9).filter((x) => x.trim() !== '');
    rows.push({
      object: f[0], seq: f[5], beg: Number(f[6]), end: Number(f[7]), minus: f[8] === '-',
      painted: extra[0] === 'Painted', tags: extra.filter((x) => x !== 'Painted'),
    });
  }
  return { rows, bpPerTexel: Number(res[1]) };
}

/** A piece of an input sequence: `seq` and its number among that sequence's pieces, left to right. */
type Piece = string;
const piece = (seq: string, k: number): Piece => `${seq}\u0000${k}`;

interface Plan {
  cuts: string[]; moves: string[]; inverts: string[]; paints: string[];
  /** Tag -> final positions that carry it. */
  tags: Map<string, number[]>;
  /** Final positions, in AGP row order. */
  placed: number;
  scaffolds: number;
}

/** The edits that take the map as loaded (sequence names in `initial` order) to the released curation. */
function plan(rows: Row[], bpPerTexel: number, initial: string[]): Plan {
  const bySeq = new Map<string, Row[]>();
  for (const r of rows) {
    if (!bySeq.has(r.seq)) bySeq.set(r.seq, []);
    bySeq.get(r.seq)!.push(r);
  }
  for (const list of bySeq.values()) list.sort((a, b) => a.beg - b.beg);
  for (const seq of bySeq.keys()) if (!initial.includes(seq)) throw new Error(`${seq} is in the AGP but not on the map`);

  // Cuts, from the right end of the map to the left and, inside a sequence,
  // from its right end to its left, so that no position named later has moved.
  const cuts: string[] = [];
  for (let i = initial.length - 1; i >= 0; i--) {
    const list = bySeq.get(initial[i]);
    if (!list || list.length < 2) continue;
    for (let k = list.length - 2; k >= 0; k--) {
      cuts.push(`cut #${i} ${Math.round(list[k].end / bpPerTexel)}`);
    }
  }
  const order: Piece[] = initial.flatMap((seq) => {
    const n = bySeq.get(seq)?.length ?? 1;
    return Array.from({ length: n }, (_, k) => piece(seq, k));
  });

  // Moves: put each row's piece at its place, left to right.
  const target: Piece[] = rows.map((r) => piece(r.seq, bySeq.get(r.seq)!.indexOf(r)));
  const moves: string[] = [];
  for (let t = 0; t < target.length; t++) {
    const cur = order.indexOf(target[t]);
    if (cur < t) throw new Error(`piece ${target[t]} is named on two rows`);
    if (cur === t) continue;
    moves.push(`move #${cur} to ${t}`);
    order.splice(cur, 1);
    order.splice(t, 0, target[t]);
  }

  const inverts = rows.flatMap((r, t) => (r.minus ? [`invert #${t}`] : []));

  const paints: string[] = [];
  const tags = new Map<string, number[]>();
  let scaffolds = 0;
  let previous = '';
  rows.forEach((r, t) => {
    if (r.painted) {
      if (r.object !== previous) paints.push(`scaffold create chr${++scaffolds}`);
      paints.push(`scaffold paint #${t} chr${scaffolds}`);
    }
    previous = r.object;
    for (const tag of r.tags) {
      if (!tags.has(tag)) tags.set(tag, []);
      tags.get(tag)!.push(t);
    }
  });
  return { cuts, moves, inverts, paints, tags, placed: rows.length, scaffolds };
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

async function runInConsole(page: Page, label: string, lines: string[]): Promise<void> {
  if (lines.length === 0) { console.log(`   ${label}: nothing to do`); return; }
  const started = Date.now();
  await page.locator('#script-input').fill(lines.join('\n'));
  await page.evaluate(() => { document.getElementById('script-output')!.textContent = ''; });
  await page.locator('#btn-run-script').click();
  const summary = page.locator('#script-output .script-output-info').filter({ hasText: /succeeded/ }).last();
  await summary.waitFor({ timeout: 300_000 });
  const text = (await summary.textContent()) ?? '';
  const m = /(\d+) succeeded, (\d+) failed/.exec(text);
  if (!m || Number(m[1]) !== lines.length || Number(m[2]) !== 0) {
    const errors = await page.locator('#script-output .script-output-error').allTextContents();
    throw new Error(`${label}: console reported "${text}" for ${lines.length} commands. ${errors.slice(0, 5).join(' | ')}`);
  }
  console.log(`   ${label}: ${lines.length} commands, ${text.trim()}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

async function sidebarNames(page: Page): Promise<string[]> {
  return page.locator('#contig-list .contig-item .contig-name').allTextContents();
}

const dataRows = (text: string): string[] =>
  text.split('\n').filter((l) => l !== '' && !l.startsWith('#')).map((l) => l.replace(/[\t\r]+$/, ''));

async function curate(url: string, headed: boolean): Promise<string> {
  const released = readReleased(readFileSync(RELEASED, 'utf8'));
  const browser = await chromium.launch({ headless: !headed, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

  console.log('1. Load the map');
  await page.goto(url);
  await page.locator('#file-input').setInputFiles(MAP);
  await page.locator('#welcome').waitFor({ state: 'hidden', timeout: 120_000 });
  await page.locator('#btn-sidebar').click();
  await page.locator('#contig-list .contig-item').first().waitFor({ timeout: 120_000 });
  const initial = await sidebarNames(page);
  console.log(`   ${initial.length} sequences on the map; the released curation has ${released.rows.length} sequence rows`);

  const p = plan(released.rows, released.bpPerTexel, initial);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'edits.script'), [
    '# Edits that reproduce the released king quail curation, derived from its AGP by bench/quail-e2e.ts',
    '# cuts', ...p.cuts, '# moves', ...p.moves, '# inversions', ...p.inverts, '# scaffolds', ...p.paints, '',
  ].join('\n'));

  console.log('2. Edit through the script console');
  await page.evaluate(() => document.getElementById('btn-console')?.click());
  await page.locator('#script-console.visible').waitFor();
  await runInConsole(page, 'cuts', p.cuts);
  await runInConsole(page, 'moves', p.moves);
  await runInConsole(page, 'inversions', p.inverts);
  await runInConsole(page, 'scaffolds', p.paints);
  await page.locator('#btn-close-console').click();

  console.log('3. Tag through the sidebar');
  for (const [tag, positions] of p.tags) {
    for (const [n, t] of positions.entries()) {
      await page.locator(`#contig-list .contig-item[data-order-index="${t}"]`)
        .click(n === 0 ? {} : { modifiers: ['ControlOrMeta'] });
    }
    const selected = await page.locator('#contig-list .contig-item.selected').count();
    if (selected !== positions.length) throw new Error(`tag ${tag}: ${selected} contigs selected, wanted ${positions.length}`);
    await page.locator('#metatag-custom').fill('');
    await page.locator('#metatag-select').selectOption(tag);
    await page.locator('#btn-apply-metatag').click();
    await page.locator(`#contig-list .contig-item[data-order-index="${positions[0]}"] .contig-badge.metatag[data-tag="${tag}"]`).waitFor();
    console.log(`   ${tag}: ${positions.length} contigs`);
  }

  console.log('4. Export from the Export menu');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.evaluate(() => (document.getElementById('btn-save-agp') as HTMLButtonElement).click()),
  ]);
  const ours = readFileSync(await download.path(), 'utf8');
  const oursPath = join(OUT, 'openpretext.agp');
  writeFileSync(oursPath, ours);
  await page.screenshot({ path: join(OUT, 'curated.png') });
  console.log(`   ${download.suggestedFilename()} saved to ${oursPath}`);

  if (pageErrors.length > 0) console.log(`   page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
  await browser.close();
  if (pageErrors.length > 0) throw new Error(`${pageErrors.length} error(s) in the page`);
  return oursPath;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareAGP(oursPath: string): boolean {
  console.log('5. Compare with PretextView\'s AGP');
  const theirs = dataRows(readFileSync(RELEASED, 'utf8'));
  const ours = dataRows(readFileSync(oursPath, 'utf8'));
  let different = 0;
  let first = '';
  for (let i = 0; i < Math.max(theirs.length, ours.length); i++) {
    if (theirs[i] !== ours[i]) {
      different++;
      if (!first) first = `row ${i + 1}\n      PretextView: ${JSON.stringify(theirs[i])}\n      OpenPretext: ${JSON.stringify(ours[i])}`;
    }
  }
  const header = (t: string) => t.split('\n').filter((l) => l.startsWith('#') && !/DESCRIPTION/.test(l)).join('\n');
  const sameHeader = header(readFileSync(RELEASED, 'utf8')) === header(readFileSync(oursPath, 'utf8'));
  console.log(`   ${theirs.length} rows in PretextView's file, ${ours.length} in OpenPretext's, ${different} differ; header lines ${sameHeader ? 'match' : 'DIFFER'}`);
  if (first) console.log(`   first difference at ${first}`);
  return different === 0 && sameHeader;
}

function sha(path: string): string {
  const bytes = readFileSync(path);
  // Compare what a gzip file holds, not its bytes, which carry a timestamp.
  const data = path.endsWith('.gz') ? execFileSync('gzip', ['-dc', path], { maxBuffer: 8 * 2 ** 30 }) : bytes;
  return createHash('sha256').update(data).digest('hex');
}

function runSanger(oursPath: string, fasta: string): boolean {
  console.log('6. Run pretext-to-asm on both AGPs with the assembly');
  if (!existsSync(TOOL)) throw new Error('pretext-to-asm is not set up; see bench/agp-acceptance.ts');
  const dirs = { theirs: join(OUT, 'asm-pretextview'), ours: join(OUT, 'asm-openpretext') };
  const inputs = { theirs: RELEASED, ours: oursPath };
  for (const who of ['theirs', 'ours'] as const) {
    mkdirSync(dirs[who], { recursive: true });
    const started = Date.now();
    execFileSync(TOOL, ['--assembly', fasta, '--pretext', inputs[who], '--output', join(dirs[who], 'bCotChi1.1.fa'), '--no-auto-find-yaml'],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 ** 28 });
    console.log(`   ${who === 'theirs' ? 'PretextView' : 'OpenPretext'} AGP: done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  const files = readdirSync(dirs.theirs).filter((f) => !f.endsWith('.log')).sort();
  const oursFiles = readdirSync(dirs.ours).filter((f) => !f.endsWith('.log')).sort();
  let same = files.join() === oursFiles.join();
  if (!same) console.log(`   different sets of files: ${files.join(', ')} vs ${oursFiles.join(', ')}`);
  for (const f of files) {
    if (!oursFiles.includes(f)) continue;
    const a = sha(join(dirs.theirs, f));
    const b = sha(join(dirs.ours, f));
    console.log(`   ${a === b ? 'same     ' : 'DIFFERENT'} ${f}  ${a.slice(0, 16)}`);
    if (a !== b) same = false;
  }
  return same;
}

async function main(): Promise<void> {
  const url = arg('--url') ?? 'http://localhost:4173';
  const fasta = arg('--fasta');
  const reuse = process.argv.includes('--reuse-agp');
  const oursPath = reuse ? join(OUT, 'openpretext.agp') : await curate(url, process.argv.includes('--headed'));
  const agpSame = compareAGP(oursPath);
  const asmSame = fasta ? runSanger(oursPath, resolve(fasta)) : null;
  console.log('');
  console.log(agpSame ? 'The AGP exported after curating in OpenPretext has the same rows as PretextView\'s.' : 'FAIL: the AGPs differ.');
  if (asmSame !== null) {
    console.log(asmSame ? 'pretext-to-asm builds the same files from both.' : 'FAIL: pretext-to-asm builds different files.');
  } else {
    console.log('pretext-to-asm was not run (no --fasta).');
  }
  process.exit(agpSame && asmSame !== false ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
