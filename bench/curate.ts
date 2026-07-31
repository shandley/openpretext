/**
 * curate.ts — headless "curation as code" CLI.
 *
 * Loads a genome assembly (.pretext) in Node, applies a DSL curation script to
 * it with no browser, and exports the curated result as AGP plus a summary.
 * This makes a curation session reproducible and scriptable outside the viewer.
 *
 * Usage:
 *   npx tsx bench/curate.ts --pretext <file.pretext> --script <file.dsl> [--out <file.agp>]
 *
 * The DSL executor (src/scripting/ScriptExecutor.ts) is deliberately DOM-free,
 * so the same execution surface the browser uses runs here unchanged. We build
 * the ScriptContext directly from the real singletons (state, CurationEngine,
 * SelectionManager, a ScaffoldManager instance, and the batch ops) rather than
 * importing DSLRunner.buildScriptContext, which needs a live Camera/AppContext.
 */

import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

import { state } from '../src/core/State';
import type { AppState, MapData, ContigInfo } from '../src/core/State';
import { CurationEngine } from '../src/curation/CurationEngine';
import { SelectionManager } from '../src/curation/SelectionManager';
import { ScaffoldManager } from '../src/curation/ScaffoldManager';
import { autoCutContigs, autoSortContigs } from '../src/curation/BatchOperations';
import { contigExclusion } from '../src/curation/ContigExclusion';
import { misassemblyFlags } from '../src/curation/MisassemblyFlags';
import { calculateMetrics, type AssemblyMetrics } from '../src/curation/QualityMetrics';
import { parseScript, type ParseError } from '../src/scripting/ScriptParser';
import {
  executeScript,
  type ScriptContext,
  type ScriptResult,
} from '../src/scripting/ScriptExecutor';
import { exportAGP } from '../src/export/AGPWriter';
import { exportFASTA, resolveContigSequence } from '../src/export/FASTAWriter';
import { parseFASTAStream } from '../src/formats/FASTAParser';
import { loadPretextFromDisk } from './loader';

// ---------------------------------------------------------------------------
// Core (testable, no filesystem, no process)
// ---------------------------------------------------------------------------

/** Outcome of applying a curation script to an assembly. */
export interface CurateOutcome {
  /** Parse errors, one per malformed line (execution still runs the lines that parsed). */
  parseErrors: ParseError[];
  /** Per-command results in execution order. With continueOnError=false this
   *  truncates at the first failure. */
  results: ScriptResult[];
  /** Messages emitted by `echo` commands, in order. */
  echoMessages: string[];
  /** Metrics of the assembly before the script ran. */
  beforeMetrics: AssemblyMetrics;
  /** Metrics of the assembly after the script ran. */
  afterMetrics: AssemblyMetrics;
  /** AGP text reflecting the curated order and orientation. */
  agp: string;
  /** FASTA text of the curated assembly. Only present when reference sequences
   *  were supplied; a .pretext carries no sequence of its own. */
  fasta?: string;
  /** Contigs with no sequence in the supplied reference, by name. Present
   *  alongside `fasta`. A non-empty list means the FASTA is incomplete. */
  missingSequences?: string[];
  /** True iff no parse errors and every executed command succeeded. */
  ok: boolean;
}

/**
 * Apply a DSL curation script to an in-memory assembly and return the results,
 * before/after metrics, and the exported AGP.
 *
 * This is the CLI's core, kept free of arg-parsing and file IO so it is unit
 * testable against a synthetic map. It drives the real singletons: it resets
 * `state`, populates it with the given map + order, wires a fresh
 * ScaffoldManager into CurationEngine, and clears the ContigExclusion singleton
 * so a prior run never leaks into this one.
 *
 * Execution uses `{ continueOnError: false }`, so a failed line halts the run
 * and its result is the last entry in `results`.
 */
export function applyCurationScript(
  map: MapData,
  contigOrder: number[],
  scriptText: string,
  sequences?: Map<string, string>,
): CurateOutcome {
  // Reset shared singletons so repeated calls (and a prior file) never leak.
  state.reset();
  contigExclusion.clearAll();
  const scaffoldManager = new ScaffoldManager();
  CurationEngine.setScaffoldManager(scaffoldManager);

  state.update({ map, contigOrder: [...contigOrder] });

  const beforeMetrics = calculateMetrics(map.contigs, state.get().contigOrder);

  const { commands, errors: parseErrors } = parseScript(scriptText);
  const echoMessages: string[] = [];

  const ctx: ScriptContext = {
    curation: CurationEngine,
    selection: SelectionManager,
    scaffold: scaffoldManager,
    state,
    batch: { autoCutContigs, autoSortContigs },
    // Headless: view navigation has no target, so these are no-ops.
    nav: { zoomToContigRange: () => {}, resetView: () => {}, goto: () => {} },
    // Metrics/flags for `assert` and `select where` (works headless — this is
    // what makes a curation script a self-checking, CI-runnable protocol).
    query: {
      contigCount: () => state.get().contigOrder.length,
      n50: () => calculateMetrics(state.get().map?.contigs ?? [], state.get().contigOrder).n50,
      totalLength: () => calculateMetrics(state.get().map?.contigs ?? [], state.get().contigOrder).totalLength,
      scaffoldCount: () => scaffoldManager.getAllScaffolds().length,
      misassemblyCount: () => misassemblyFlags.getFlaggedCount(),
      isMisassembled: (orderIndex) => misassemblyFlags.isFlagged(orderIndex),
      isExcluded: (orderIndex) => {
        const contigId = state.get().contigOrder[orderIndex];
        return contigId != null && contigExclusion.isExcluded(contigId);
      },
    },
    onEcho: (msg) => echoMessages.push(msg),
  };

  const results =
    commands.length > 0
      ? executeScript(commands, ctx, { continueOnError: false })
      : [];

  const after = state.get();
  const afterMetrics = calculateMetrics(after.map!.contigs, after.contigOrder);
  const agp = exportAGP(after);

  const ok = parseErrors.length === 0 && results.every((r) => r.success);

  const outcome: CurateOutcome = {
    parseErrors, results, echoMessages, beforeMetrics, afterMetrics, agp, ok,
  };

  // FASTA is the deliverable a curation actually produces, so a replay that
  // reproduces it proves more than one that reproduces coordinates alone. It
  // needs the reference sequences: a .pretext stores contact counts, not bases.
  if (sequences) {
    outcome.fasta = exportFASTA(after, sequences);
    const order = contigExclusion.getIncludedOrder(after.contigOrder);
    outcome.missingSequences = order
      .map((i) => after.map!.contigs[i])
      .filter((c) => c && resolveContigSequence(c, sequences) === undefined)
      .map((c) => c!.name);
  }

  return outcome;
}

/**
 * Build a headless MapData from a disk-loaded assembly. The overview contact
 * map is not stashed (it is overview-sized, not textureSize², and nothing on
 * the curation / AGP / metrics path reads it); textureSize stays the full pixel
 * dimension so contig pixel coordinates remain consistent.
 */
export function assemblyToMapData(
  filename: string,
  contigs: ContigInfo[],
  textureSize: number,
  header: { mipMapLevels: number; textureResolution: number; numberOfTextures1D: number },
): MapData {
  return {
    filename,
    textureSize,
    numMipMaps: header.mipMapLevels,
    tileResolution: header.textureResolution,
    tilesPerDimension: header.numberOfTextures1D,
    contigs,
    contactMap: null,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

/** A reference FASTA and the name prefix to apply to every record in it. */
export interface FastaSource {
  path: string;
  /** Prepended to each record name. Empty for the usual single-file case. */
  prefix: string;
}

/**
 * Parse a `--fasta` value of the form `path` or `path=prefix`.
 *
 * The prefix exists because a curated map is not always one haplotype. Quail
 * bCotChi1 was curated as hap1 and hap2 concatenated into one map, whose contigs
 * are `H1.scaffold_N` / `H2.scaffold_N`, while each release FASTA names its own
 * records plain `scaffold_N`. Without a prefix per file the two never join.
 */
export function parseFastaArg(value: string): FastaSource {
  const i = value.lastIndexOf('=');
  if (i <= 0) return { path: value, prefix: '' };
  return { path: value.slice(0, i), prefix: value.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// CLI (arg parsing, file IO, process exit)
// ---------------------------------------------------------------------------

interface CliArgs {
  pretext?: string;
  script?: string;
  out?: string;
  fasta: FastaSource[];
  outFasta?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { fasta: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretext') args.pretext = argv[++i];
    else if (a === '--script') args.script = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fasta') args.fasta.push(parseFastaArg(argv[++i]!));
    else if (a === '--out-fasta') args.outFasta = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/**
 * Read reference sequences into the name-to-sequence map exportFASTA expects.
 *
 * Streams and gunzips, because a vertebrate haplotype decompresses past V8's
 * maximum string length and could not be read whole.
 */
async function loadSequences(sources: FastaSource[]): Promise<Map<string, string>> {
  const sequences = new Map<string, string>();
  for (const src of sources) {
    let stream: NodeJS.ReadableStream = createReadStream(src.path);
    if (src.path.endsWith('.gz')) stream = stream.pipe(createGunzip());
    const text = Readable.toWeb(Readable.from(stream)) as unknown as ReadableStream<Uint8Array>;
    const records = await parseFASTAStream(text.pipeThrough(new TextDecoderStream()));
    for (const r of records) sequences.set(`${src.prefix}${r.name}`, r.sequence);
  }
  return sequences;
}

const USAGE = `curate — headless "curation as code" for OpenPretext

Usage:
  npx tsx bench/curate.ts --pretext <file.pretext> --script <file.dsl>
                          [--out <file.agp>]
                          [--fasta <ref.fasta[.gz]>[=<prefix>] ...] [--out-fasta <file.fa>]

Loads a .pretext assembly, applies a DSL curation script, and writes AGP
(to --out, or stdout if omitted) plus a summary (to stderr). Exits non-zero
if any line fails to parse or execute.

Give --fasta to also export the curated sequence. A .pretext holds contact
counts and no bases, so the reference the map was built from must be supplied.
Repeat --fasta once per file, with =<prefix> when the map's contig names carry
one the FASTA does not:

  --fasta hap1.fa.gz=H1. --fasta hap2.fa.gz=H2.

Whole haplotypes are held in memory. For a vertebrate genome, raise the heap:
  NODE_OPTIONS=--max-old-space-size=8192 npx tsx bench/curate.ts ...`;

function formatSummary(outcome: CurateOutcome, sourceLines: string[]): string {
  const lines: string[] = [];
  lines.push('=== Curation summary ===');

  if (outcome.parseErrors.length > 0) {
    lines.push(`Parse errors (${outcome.parseErrors.length}):`);
    for (const e of outcome.parseErrors) {
      lines.push(`  line ${e.line}: ${e.message}`);
    }
  }

  lines.push('Commands:');
  if (outcome.results.length === 0) {
    lines.push('  (none executed)');
  }
  for (const r of outcome.results) {
    const status = r.success ? 'ok  ' : 'FAIL';
    const src = sourceLines[r.line - 1]?.trim() ?? '';
    lines.push(`  [${status}] line ${r.line}: ${r.message}${src ? `  (${src})` : ''}`);
  }

  const b = outcome.beforeMetrics;
  const a = outcome.afterMetrics;
  lines.push('Metrics (before -> after):');
  lines.push(`  contigs: ${b.contigCount} -> ${a.contigCount}`);
  lines.push(`  N50:     ${b.n50} -> ${a.n50}`);

  if (outcome.fasta !== undefined) {
    const missing = outcome.missingSequences ?? [];
    lines.push('FASTA:');
    lines.push(`  ${outcome.fasta.length} bytes`);
    if (missing.length > 0) {
      const shown = missing.slice(0, 5).join(', ');
      lines.push(`  WARNING: no sequence for ${missing.length} contigs: ${shown}${missing.length > 5 ? ' ...' : ''}`);
      lines.push('  those contigs are emitted as headers with no bases; check --fasta and any =prefix');
    }
  }

  lines.push(`Result: ${outcome.ok ? 'success' : 'FAILURE'}`);
  return lines.join('\n');
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${USAGE}\n`);
    return 2;
  }

  if (!args.pretext || !args.script) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const assembly = await loadPretextFromDisk(args.pretext);
  const scriptText = await readFile(args.script, 'utf8');
  const sourceLines = scriptText.split('\n');

  const map = assemblyToMapData(
    args.pretext,
    assembly.contigs,
    assembly.textureSize,
    assembly.parsed.header,
  );

  const sequences = args.fasta.length > 0 ? await loadSequences(args.fasta) : undefined;
  if (sequences) {
    process.stderr.write(`Loaded ${sequences.size} reference sequences\n`);
  }

  const outcome = applyCurationScript(map, assembly.contigOrder, scriptText, sequences);

  // Summary -> stderr so `curate ... > out.agp` yields clean AGP on stdout.
  process.stderr.write(`${formatSummary(outcome, sourceLines)}\n`);

  if (args.out) {
    await writeFile(args.out, outcome.agp, 'utf8');
    process.stderr.write(`Wrote AGP to ${args.out}\n`);
  } else {
    process.stdout.write(outcome.agp);
  }

  if (outcome.fasta !== undefined) {
    if (args.outFasta) {
      await writeFile(args.outFasta, outcome.fasta, 'utf8');
      process.stderr.write(`Wrote FASTA to ${args.outFasta}\n`);
    } else {
      process.stderr.write('FASTA exported but not written; pass --out-fasta to save it\n');
    }
  } else if (args.outFasta) {
    process.stderr.write('--out-fasta needs --fasta: a .pretext carries no sequence\n');
    return 2;
  }

  return outcome.ok ? 0 : 1;
}

// Only run when invoked directly (not when imported by the test).
// import.meta.url matches the executed file's URL under tsx/node ESM.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
