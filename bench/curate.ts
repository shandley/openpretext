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

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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

  return { parseErrors, results, echoMessages, beforeMetrics, afterMetrics, agp, ok };
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

// ---------------------------------------------------------------------------
// CLI (arg parsing, file IO, process exit)
// ---------------------------------------------------------------------------

interface CliArgs {
  pretext?: string;
  script?: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretext') args.pretext = argv[++i];
    else if (a === '--script') args.script = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const USAGE = `curate — headless "curation as code" for OpenPretext

Usage:
  npx tsx bench/curate.ts --pretext <file.pretext> --script <file.dsl> [--out <file.agp>]

Loads a .pretext assembly, applies a DSL curation script, and writes AGP
(to --out, or stdout if omitted) plus a summary (to stderr). Exits non-zero
if any line fails to parse or execute.`;

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

  const outcome = applyCurationScript(map, assembly.contigOrder, scriptText);

  // Summary -> stderr so `curate ... > out.agp` yields clean AGP on stdout.
  process.stderr.write(`${formatSummary(outcome, sourceLines)}\n`);

  if (args.out) {
    await writeFile(args.out, outcome.agp, 'utf8');
    process.stderr.write(`Wrote AGP to ${args.out}\n`);
  } else {
    process.stdout.write(outcome.agp);
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
