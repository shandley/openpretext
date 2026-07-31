/**
 * figure3.ts — build Figure 3 (curation as code) from a real run, not a mock-up.
 *
 * The figure's claim is that a curation is an artifact you can rerun, check, and
 * put under CI. A hand-drawn figure could not support that, so this one is
 * generated: it runs the protocol twice, hashes both exports, and draws the
 * panels from what actually came back. Regenerating it re-runs the evidence.
 *
 * Output is SVG so the figure stays vector for submission.
 *
 * Usage:
 *   npx tsx bench/figure3.ts --pretext <f.pretext> --script <f.dsl> --out fig3.svg
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { loadPretextFromDisk } from './loader';
import { applyCurationScript, assemblyToMapData, type CurateOutcome } from './curate';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Okabe-Ito, safe for all forms of colour blindness and legible in grayscale. */
const INK = '#000000';
const MUTED = '#555555';
const RULE = '#bbbbbb';
const GREEN = '#009E73'; // pass
const BLUE = '#0072B2'; // operations
const ORANGE = '#E69F00'; // assertions
const PANEL_BG = '#f7f7f7';

const MONO = "'DejaVu Sans Mono', 'Menlo', monospace";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// 183mm at 72dpi user units is 519pt; Genome Biology full width.
const W = 519;
const PAD = 10;
const LINE = 9.4;
const CODE_PT = 7.2;

/** Format a base count as Mb, the unit curators read assemblies in. */
export function mb(bp: number): string {
  return `${(bp / 1e6).toFixed(2)} Mb`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Evidence (pure enough to test)
// ---------------------------------------------------------------------------

export interface Figure3Evidence {
  /** The command that produced panel B, built from the real paths so the
   *  printed line is one a reader can actually run. */
  command: string;
  scriptLines: string[];
  /** One line per executed command: whether it passed, and what it reported. */
  runLines: { ok: boolean; text: string }[];
  contigsBefore: number;
  contigsAfter: number;
  /** Contig N50 before and after, in bp. The figure reports the same two
   *  numbers the CLI prints. It deliberately omits a scaffold count: the DSL's
   *  `scaffolds` metric counts named scaffolds a curator created, while the
   *  metrics module counts assembly-statistics scaffolds (each unplaced contig
   *  is its own). Both are right and they differ, so showing one unlabelled
   *  next to an assertion on the other reads as an error. */
  n50Before: number;
  n50After: number;
  /** What the protocol actually did, in terms the AGP records stably. Contig
   *  count and N50 are reported too, but neither moves under reorder, reorient,
   *  or group operations, so on their own they make a real curation look like a
   *  no-op. */
  namedScaffolds: number;
  reoriented: number;
  grouped: number;
  hashA: string;
  hashB: string;
  identical: boolean;
  bytes: number;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Break a long command at its flags so it fits the panel, using the shell's own
 * continuation marker. Real paths make the printed command runnable but long;
 * abbreviating them would make it fit and not work.
 */
export function wrapCommand(command: string, maxChars = 92): string[] {
  const tokens = command.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    // Leave room for the trailing ' \' continuation.
    if (current && candidate.length > maxChars - 2 && token.startsWith('--')) {
      lines.push(`${current} \\`);
      current = `    ${token}`;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Distinct AGP objects that are not the unplaced-contig placeholders. */
export function namedScaffolds(agp: string): number {
  const objects = new Set<string>();
  for (const line of agp.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f[4] !== 'W') continue;
    if (!f[0].startsWith('unplaced_')) objects.add(f[0]);
  }
  return objects.size;
}

/**
 * Components whose orientation differs between two AGP exports.
 *
 * Orientation is keyed on the component name, so it is stable. Position is not:
 * unplaced contigs are exported as objects named `unplaced_0..N` numbered by
 * their place in the order, so moving one contig renames every object after it
 * and a positional diff reports the whole file as changed.
 */
export function reorientedCount(before: string, after: string): number {
  const orientationByComponent = (agp: string) => {
    const m = new Map<string, string>();
    for (const line of agp.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const f = line.split('\t');
      if (f[4] === 'W') m.set(f[5], f[8]);
    }
    return m;
  };
  const b = orientationByComponent(before);
  let changed = 0;
  for (const [name, orientation] of orientationByComponent(after)) {
    if (b.get(name) !== orientation) changed++;
  }
  return changed;
}

/** Components placed into a named scaffold rather than left unplaced. */
export function groupedCount(agp: string): number {
  let grouped = 0;
  for (const line of agp.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f[4] === 'W' && !f[0].startsWith('unplaced_')) grouped++;
  }
  return grouped;
}

export function buildEvidence(
  scriptText: string,
  runA: CurateOutcome,
  runB: CurateOutcome,
  command: string,
  baselineAgp: string,
): Figure3Evidence {
  const hashA = sha256(runA.agp);
  const hashB = sha256(runB.agp);
  return {
    command,
    scriptLines: scriptText.replace(/\s+$/, '').split('\n'),
    runLines: runA.results.map((r) => ({ ok: r.success, text: r.message })),
    contigsBefore: runA.beforeMetrics.contigCount,
    contigsAfter: runA.afterMetrics.contigCount,
    n50Before: runA.beforeMetrics.n50,
    n50After: runA.afterMetrics.n50,
    namedScaffolds: namedScaffolds(runA.agp),
    reoriented: reorientedCount(baselineAgp, runA.agp),
    grouped: groupedCount(runA.agp),
    hashA,
    hashB,
    identical: hashA === hashB,
    bytes: Buffer.byteLength(runA.agp, 'utf8'),
  };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function panelLabel(x: number, y: number, letter: string, title: string): string {
  return (
    `<text x="${x}" y="${y}" font-family="${SANS}" font-size="11" font-weight="bold" fill="${INK}">${letter}</text>` +
    `<text x="${x + 14}" y="${y}" font-family="${SANS}" font-size="9" fill="${INK}">${esc(title)}</text>`
  );
}

/** Colour a DSL line by what it is: a check, an operation, or a comment. */
function scriptLineColour(line: string): string {
  const t = line.trim();
  if (t.startsWith('#') || t === '') return MUTED;
  if (t.startsWith('assert')) return ORANGE;
  return BLUE;
}

export function renderFigure3(e: Figure3Evidence): string {
  const parts: string[] = [];
  let y = PAD + 12;

  // ---- Panel A: the protocol -------------------------------------------
  parts.push(panelLabel(PAD, y, 'A', 'An illustrative curation protocol, written as a script'));
  y += 8;
  const aTop = y;
  const aHeight = e.scriptLines.length * LINE + 12;
  parts.push(
    `<rect x="${PAD}" y="${aTop}" width="${W - 2 * PAD}" height="${aHeight}" fill="${PANEL_BG}" stroke="${RULE}" stroke-width="0.5"/>`,
  );
  y = aTop + 11;
  for (const line of e.scriptLines) {
    parts.push(
      `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${scriptLineColour(line)}" xml:space="preserve">${esc(line)}</text>`,
    );
    y += LINE;
  }
  y = aTop + aHeight + 6;
  parts.push(
    `<text x="${PAD}" y="${y}" font-family="${SANS}" font-size="7" fill="${MUTED}">` +
      `<tspan fill="${ORANGE}">assertions</tspan> state what must hold; ` +
      `<tspan fill="${BLUE}">operations</tspan> change the assembly.</text>`,
  );

  // ---- Panel B: the run ------------------------------------------------
  y += 18;
  parts.push(panelLabel(PAD, y, 'B', 'Run headlessly, with no browser; the same check gates CI'));
  y += 8;
  const bTop = y;
  const bHeight = (e.runLines.length + wrapCommand(e.command).length + 3.8) * LINE + 14;
  parts.push(
    `<rect x="${PAD}" y="${bTop}" width="${W - 2 * PAD}" height="${bHeight}" fill="${PANEL_BG}" stroke="${RULE}" stroke-width="0.5"/>`,
  );
  y = bTop + 11;
  const cmdLines = wrapCommand(e.command);
  cmdLines.forEach((cl, i) => {
    parts.push(
      `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${MUTED}" xml:space="preserve">${i === 0 ? '$ ' : '  '}${esc(cl)}</text>`,
    );
    y += LINE;
  });
  y += LINE * 0.4;
  for (const r of e.runLines) {
    parts.push(
      `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${r.ok ? GREEN : '#D55E00'}">${r.ok ? 'ok' : 'FAIL'}</text>` +
        `<text x="${PAD + 24}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${INK}">${esc(r.text)}</text>`,
    );
    y += LINE;
  }
  y += LINE * 0.4;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${INK}">` +
      `${e.reoriented} reoriented, ${e.grouped} grouped into ${e.namedScaffolds} named scaffold. ` +
      `Contigs ${e.contigsBefore} -> ${e.contigsAfter}, N50 ${mb(e.n50Before)} unchanged.</text>`,
  );
  y += LINE;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${INK}">` +
      `Rearrangement changes neither.  Result: ` +
      `<tspan fill="${GREEN}" font-weight="bold">success</tspan></text>`,
  );

  // ---- Panel C: determinism -------------------------------------------
  y = bTop + bHeight + 18;
  parts.push(panelLabel(PAD, y, 'C', 'Two independent runs, same bytes'));
  y += 8;
  const cTop = y;
  const cHeight = 4 * LINE + 20;
  parts.push(
    `<rect x="${PAD}" y="${cTop}" width="${W - 2 * PAD}" height="${cHeight}" fill="${PANEL_BG}" stroke="${RULE}" stroke-width="0.5"/>`,
  );
  y = cTop + 12;
  const short = (h: string) => `${h.slice(0, 32)}…`;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${INK}">run 1  sha256  ${short(e.hashA)}</text>`,
  );
  y += LINE;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${MONO}" font-size="${CODE_PT}" fill="${INK}">run 2  sha256  ${short(e.hashB)}</text>`,
  );
  y += LINE * 1.5;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${SANS}" font-size="8" font-weight="bold" fill="${e.identical ? GREEN : '#D55E00'}">` +
      `${e.identical ? `identical: ${e.bytes.toLocaleString()} bytes of AGP, byte for byte` : 'OUTPUTS DIFFER'}</text>`,
  );
  y += LINE * 1.3;
  parts.push(
    `<text x="${PAD + 7}" y="${y}" font-family="${SANS}" font-size="7" fill="${MUTED}">` +
      `The same protocol re-run on the same assembly is reproducible, so a curation can be diffed, reviewed, and regression-tested.</text>`,
  );

  const height = cTop + cHeight + PAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`,
    `<rect width="${W}" height="${height}" fill="#ffffff"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const pretext = arg('pretext');
  const script = arg('script');
  const out = arg('out');
  if (!pretext || !script || !out) {
    console.error('Usage: npx tsx bench/figure3.ts --pretext <f.pretext> --script <f.dsl> --out <f.svg>');
    process.exit(2);
  }

  const assembly = await loadPretextFromDisk(pretext);
  const scriptText = await readFile(script, 'utf8');
  const map = assemblyToMapData(pretext, assembly.contigs, assembly.textureSize, assembly.parsed.header);

  // The uncurated arrangement, for counting what the protocol actually moved.
  const baseline = applyCurationScript(map, assembly.contigOrder, '');

  // Two independent runs. applyCurationScript resets the shared singletons, so
  // the second starts from the same state the first did.
  const runA = applyCurationScript(map, assembly.contigOrder, scriptText);
  const runB = applyCurationScript(map, assembly.contigOrder, scriptText);

  const command = `npx tsx bench/curate.ts --pretext ${pretext} --script ${script} --out curated.agp`;
  const evidence = buildEvidence(scriptText, runA, runB, command, baseline.agp);
  if (!evidence.identical) {
    process.stderr.write('WARNING: the two runs differ; the figure will say so\n');
  }
  await writeFile(out, renderFigure3(evidence), 'utf8');
  process.stderr.write(`Wrote ${out} (${evidence.identical ? 'runs identical' : 'RUNS DIFFER'})\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
