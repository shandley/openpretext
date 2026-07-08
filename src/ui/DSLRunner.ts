/**
 * DSLRunner — the single place the curation DSL is built into a ScriptContext
 * and executed. Both the Script Console and the AI Assist panel run DSL through
 * here, so they share one execution surface (including view navigation) and can
 * never drift apart.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { CurationEngine } from '../curation/CurationEngine';
import { SelectionManager } from '../curation/SelectionManager';
import { autoSortContigs, autoCutContigs } from '../curation/BatchOperations';
import { parseScript, type ParseError } from '../scripting/ScriptParser';
import { executeScript, type ScriptContext, type ScriptResult } from '../scripting/ScriptExecutor';

export interface DSLRunOutcome {
  /** Errors from parsing (one per malformed line). */
  parseErrors: ParseError[];
  /** Results from executing the parsed commands, in order. */
  results: ScriptResult[];
  /** Messages emitted by `echo` commands, in execution order. */
  echoMessages: string[];
  /** Number of commands that parsed successfully (>= results.length if execution halted early). */
  commandCount: number;
}

/**
 * Build the ScriptContext wiring the DSL to the live application: curation,
 * selection, scaffolds, batch ops, and view navigation (the real Camera).
 */
export function buildScriptContext(ctx: AppContext, onEcho: (message: string) => void): ScriptContext {
  return {
    curation: CurationEngine,
    selection: SelectionManager,
    scaffold: ctx.scaffoldManager,
    state,
    batch: { autoCutContigs, autoSortContigs },
    nav: {
      zoomToContigRange: (start, end) => ctx.camera.zoomToRegion(start, start, end, end),
      resetView: () => ctx.camera.resetView(),
      goto: (x, y) => ctx.camera.animateTo({ x, y }),
    },
    onEcho,
  };
}

/**
 * Parse and execute a DSL script against the live application, refreshing the
 * UI once afterward. Returns a structured outcome the caller renders however it
 * likes (the console writes to its output pane; the AI panel shows a toast).
 *
 * @param opts.haltOnParseError - When true, do not execute anything if any line
 *   failed to parse (used by the AI panel so a malformed block is never applied
 *   partially). Default false: execute the lines that did parse.
 */
export function runDSL(
  ctx: AppContext,
  text: string,
  opts?: { haltOnParseError?: boolean }
): DSLRunOutcome {
  const parseResult = parseScript(text);
  const echoMessages: string[] = [];
  let results: ScriptResult[] = [];

  const halt = opts?.haltOnParseError === true && parseResult.errors.length > 0;

  if (!halt && parseResult.commands.length > 0) {
    const scriptCtx = buildScriptContext(ctx, (msg) => echoMessages.push(msg));
    // Suppress per-op UI refresh during the script; refresh once at the end.
    ctx.suppressCurationRefresh = true;
    try {
      results = executeScript(parseResult.commands, scriptCtx);
    } finally {
      ctx.suppressCurationRefresh = false;
    }
    ctx.refreshAfterCuration();
    ctx.updateSidebarScaffoldList();
  }

  return {
    parseErrors: parseResult.errors,
    results,
    echoMessages,
    commandCount: parseResult.commands.length,
  };
}
