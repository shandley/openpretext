/**
 * DSLRunner — the single place the curation DSL is built into a ScriptContext
 * and executed. Both the Script Console and the AI Assist panel run DSL through
 * here, so they share one execution surface (including view navigation) and can
 * never drift apart.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { CurationEngine, undoBatch } from '../curation/CurationEngine';
import { SelectionManager } from '../curation/SelectionManager';
import { autoSortContigs, autoCutContigs } from '../curation/BatchOperations';
import { calculateMetrics } from '../curation/QualityMetrics';
import { parseScript, type ParseError } from '../scripting/ScriptParser';
import { executeScript, type ScriptContext, type ScriptResult } from '../scripting/ScriptExecutor';

/** Monotonic per-session counters for unique batch ids. */
let scriptRunSeq = 0;
let previewSeq = 0;

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
    const undoDepthBefore = state.get().undoStack.length;
    // Suppress per-op UI refresh during the script; refresh once at the end.
    ctx.suppressCurationRefresh = true;
    try {
      results = executeScript(parseResult.commands, scriptCtx);
    } finally {
      ctx.suppressCurationRefresh = false;
    }
    // Group the script's curation operations into one undo unit so a single
    // Ctrl+Z reverts the whole script (stamped before the refresh so the undo
    // history panel shows the batch). One op needs no grouping.
    const undoDepthAfter = state.get().undoStack.length;
    if (undoDepthAfter - undoDepthBefore >= 2) {
      state.assignBatchId(undoDepthBefore, `script-${++scriptRunSeq}`);
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

/**
 * Build a context whose mutating operations are no-ops but whose reads hit the
 * real state, so a script can be parsed and validated (contig refs resolved,
 * join adjacency checked, scaffolds looked up) without changing anything.
 *
 * Limitation: because mutations are no-ops, a line that depends on an earlier
 * line's result (operate on a fragment created by a prior cut, paint into a
 * scaffold created earlier in the script) will report a false failure.
 */
function buildDryRunContext(ctx: AppContext, onEcho: (message: string) => void): ScriptContext {
  const noop = () => {};
  return {
    curation: { cut: noop, join: noop, invert: noop, move: noop },
    selection: { selectSingle: noop, selectRange: noop, selectAll: noop, clearSelection: noop },
    scaffold: {
      createScaffold: () => -1,
      deleteScaffold: noop,
      paintContigs: noop,
      getAllScaffolds: () => ctx.scaffoldManager.getAllScaffolds(),
    },
    state: { get: () => state.get(), update: noop },
    batch: {
      autoCutContigs: () => ({ operationsPerformed: 0, description: 'auto-cut (not simulated in preview)' }),
      autoSortContigs: () => ({ operationsPerformed: 0, description: 'auto-sort (not simulated in preview)' }),
    },
    nav: { zoomToContigRange: noop, resetView: noop, goto: noop },
    onEcho,
  };
}

/**
 * Validate a script against the current assembly WITHOUT applying it. Every line
 * is checked (continue-on-error) so the full plan and all errors are reported.
 * Safe: never mutates state.
 */
export function dryRunValidate(ctx: AppContext, text: string): DSLRunOutcome {
  const parseResult = parseScript(text);
  const echoMessages: string[] = [];
  let results: ScriptResult[] = [];

  if (parseResult.commands.length > 0) {
    const dryCtx = buildDryRunContext(ctx, (msg) => echoMessages.push(msg));
    results = executeScript(parseResult.commands, dryCtx, { continueOnError: true });
  }

  return {
    parseErrors: parseResult.errors,
    results,
    echoMessages,
    commandCount: parseResult.commands.length,
  };
}

export interface EffectsDiff {
  contigCountBefore: number;
  contigCountAfter: number;
  n50Before: number;
  n50After: number;
  /** Positions whose contig changed (only when the count is unchanged; null otherwise). */
  contigsMoved: number | null;
  /** Operations that were applied then reverted. */
  applied: number;
}

/**
 * Preview a script's real effect (contig count, N50, reordering) by actually
 * running it, capturing the resulting metrics, then atomically reverting it via
 * the batch-undo primitive and restoring the redo stack, so nothing is kept.
 *
 * The revert runs in `finally`, so an unexpected throw still restores state.
 * This briefly mutates the real assembly (the accepted trade-off for accurate
 * effects); a crash between apply and revert is the only uncovered window.
 */
export function previewEffects(
  ctx: AppContext,
  text: string
): { outcome: DSLRunOutcome; diff: EffectsDiff | null } {
  const parseResult = parseScript(text);
  const echoMessages: string[] = [];
  let results: ScriptResult[] = [];
  let diff: EffectsDiff | null = null;

  if (parseResult.commands.length > 0) {
    const sBefore = state.get();
    const beforeOrder = [...sBefore.contigOrder];
    const beforeContigs = sBefore.map?.contigs ?? [];
    const beforeMetrics = calculateMetrics(beforeContigs, beforeOrder);
    const undoBefore = sBefore.undoStack.length;
    const redoBefore = [...sBefore.redoStack];

    const scriptCtx = buildScriptContext(ctx, (msg) => echoMessages.push(msg));
    ctx.suppressCurationRefresh = true;
    try {
      results = executeScript(parseResult.commands, scriptCtx, { continueOnError: true });

      const sAfter = state.get();
      const afterOrder = [...sAfter.contigOrder];
      const afterMetrics = calculateMetrics(sAfter.map?.contigs ?? [], afterOrder);
      const contigsMoved =
        beforeOrder.length === afterOrder.length
          ? afterOrder.reduce((n, id, i) => (id === beforeOrder[i] ? n : n + 1), 0)
          : null;
      diff = {
        contigCountBefore: beforeMetrics.contigCount,
        contigCountAfter: afterMetrics.contigCount,
        n50Before: beforeMetrics.n50,
        n50After: afterMetrics.n50,
        contigsMoved,
        applied: sAfter.undoStack.length - undoBefore,
      };
    } finally {
      // Always revert whatever got applied, then restore the redo stack so the
      // preview leaves no trace.
      const applied = state.get().undoStack.length - undoBefore;
      if (applied > 0) {
        state.assignBatchId(undoBefore, `preview-${++previewSeq}`);
        undoBatch(`preview-${previewSeq}`);
      }
      state.update({ redoStack: redoBefore });
      ctx.suppressCurationRefresh = false;
    }
    ctx.refreshAfterCuration();
    ctx.updateSidebarScaffoldList();
  }

  return {
    outcome: {
      parseErrors: parseResult.errors,
      results,
      echoMessages,
      commandCount: parseResult.commands.length,
    },
    diff,
  };
}
