/**
 * ScriptConsole — in-app scripting console for automation.
 *
 * Module-local state: scriptConsoleVisible flag and command history.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { operationsToScript } from '../scripting/ScriptReplay';
import { DSL_REFERENCE, type DSLCommandDoc } from '../scripting/DSLReference';
import { runDSL } from './DSLRunner';

let scriptConsoleVisible = false;

/**
 * Escape a string for safe insertion as text content in the output pane's
 * innerHTML. Output lines embed contig names (from the loaded .pretext file)
 * and raw echo/error text, so they must never be treated as markup. These
 * strings only ever land between tags (never inside an attribute), so escaping
 * &, <, and > is sufficient to neutralize tag/entity injection while keeping
 * names with quotes readable. (Also needed for the help reference, whose syntax
 * strings contain <placeholder> tokens.)
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

// ---------------------------------------------------------------------------
// Command history (persisted across sessions)
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'openpretext.console.history';
const HISTORY_MAX = 50;

let history: string[] = loadHistory();
/** Cursor into `history` while recalling; -1 means "not currently recalling". */
let historyIndex = -1;
/** The in-progress input stashed when history recall begins. */
let historyDraft = '';

function loadHistory(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable or full — history is best-effort */
  }
}

function pushHistory(text: string): void {
  historyIndex = -1;
  if (!text) return;
  if (history[history.length - 1] === text) return; // skip consecutive duplicates
  history.push(text);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  saveHistory();
}

// ---------------------------------------------------------------------------
// Help reference
// ---------------------------------------------------------------------------

const HELP_CATEGORIES: DSLCommandDoc['category'][] = [
  'Curation',
  'Selection',
  'Scaffold',
  'Navigation',
  'Meta',
];

function renderHelpHtml(): string {
  let html =
    '<div class="script-output-info">Curation DSL. Reference a contig by name (chr1) or 0-based index (#0). Ctrl/Cmd+Enter runs; Up/Down recalls history.</div>';
  for (const cat of HELP_CATEGORIES) {
    const items = DSL_REFERENCE.filter((d) => d.category === cat);
    if (items.length === 0) continue;
    html += `<div class="script-help-cat">${escapeHtml(cat)}</div>`;
    for (const d of items) {
      html +=
        `<div class="script-help-row"><code>${escapeHtml(d.syntax)}</code>` +
        `<span class="script-help-summary">${escapeHtml(d.summary)}</span></div>`;
    }
  }
  return html;
}

function showHelp(): void {
  const output = document.getElementById('script-output');
  if (output) output.innerHTML = renderHelpHtml();
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export function isScriptConsoleVisible(): boolean {
  return scriptConsoleVisible;
}

export function toggleScriptConsole(): void {
  scriptConsoleVisible = !scriptConsoleVisible;
  const el = document.getElementById('script-console');
  if (el) el.classList.toggle('visible', scriptConsoleVisible);
  if (scriptConsoleVisible) {
    const input = document.getElementById('script-input') as HTMLTextAreaElement;
    input?.focus();
  }
}

export function setupScriptConsole(ctx: AppContext): void {
  document.getElementById('btn-console')?.addEventListener('click', () => {
    toggleScriptConsole();
  });
  document.getElementById('btn-close-console')?.addEventListener('click', () => {
    scriptConsoleVisible = false;
    document.getElementById('script-console')?.classList.remove('visible');
  });
  document.getElementById('btn-run-script')?.addEventListener('click', () => {
    runScript(ctx);
  });
  document.getElementById('btn-help-script')?.addEventListener('click', () => {
    showHelp();
  });
  document.getElementById('btn-clear-script')?.addEventListener('click', () => {
    const input = document.getElementById('script-input') as HTMLTextAreaElement;
    const output = document.getElementById('script-output');
    if (input) input.value = '';
    if (output) output.innerHTML = '<span class="script-output-info">Output cleared.</span>';
  });

  // Generate script from operation log
  document.getElementById('btn-generate-from-log')?.addEventListener('click', () => {
    const s = state.get();
    if (s.undoStack.length === 0) {
      const output = document.getElementById('script-output');
      if (output) output.innerHTML = '<span class="script-output-info">No operations in log. Perform some curation operations first.</span>';
      return;
    }
    const contigs = s.map?.contigs ?? [];
    const scaffoldNames = new Map<number, string>();
    for (const sc of ctx.scaffoldManager.getAllScaffolds()) {
      scaffoldNames.set(sc.id, sc.name);
    }
    const script = operationsToScript(s.undoStack, contigs, {
      includeTimestamps: true,
      includeHeader: true,
      scaffoldNames,
    });
    const scriptInput = document.getElementById('script-input') as HTMLTextAreaElement;
    if (scriptInput) scriptInput.value = script;
    const output = document.getElementById('script-output');
    if (output) output.innerHTML = `<span class="script-output-info">Generated ${s.undoStack.length} operation(s) as script. Edit and re-run as needed.</span>`;
  });

  const input = document.getElementById('script-input') as HTMLTextAreaElement;
  // Typing resets any in-progress history recall (programmatic value changes
  // during recall do not fire 'input', so recall is not self-interrupting).
  input?.addEventListener('input', () => { historyIndex = -1; });

  input?.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter runs the script
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runScript(ctx);
      return;
    }
    // Up/Down recall command history. For a single-line input recall always
    // applies; for a multi-line script only at the top/bottom edge so normal
    // vertical cursor movement still works.
    if (e.key === 'ArrowUp' && (!input.value.includes('\n') || input.selectionStart === 0)) {
      if (history.length === 0) return;
      if (historyIndex === -1) { historyDraft = input.value; historyIndex = history.length; }
      if (historyIndex > 0) {
        historyIndex--;
        e.preventDefault();
        setInputValue(input, history[historyIndex]);
      }
      return;
    }
    if (e.key === 'ArrowDown' && (!input.value.includes('\n') || input.selectionStart === input.value.length)) {
      if (historyIndex === -1) return;
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        setInputValue(input, history[historyIndex]);
      } else {
        historyIndex = -1;
        setInputValue(input, historyDraft);
      }
      return;
    }
    // Tab inserts spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.substring(0, start) + '  ' + input.value.substring(end);
      input.selectionStart = input.selectionEnd = start + 2;
    }
  });
}

/** Set the textarea value and place the caret at the end (used by history recall). */
function setInputValue(input: HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
}

export function runScript(ctx: AppContext): void {
  const input = document.getElementById('script-input') as HTMLTextAreaElement;
  const outputEl = document.getElementById('script-output');
  if (!input || !outputEl) return;

  const text = input.value.trim();
  if (!text) {
    outputEl.innerHTML = '<span class="script-output-info">No script to run.</span>';
    return;
  }

  // `help` / `?` / `commands` show the DSL reference instead of executing.
  if (/^(help|\?|commands)$/i.test(text)) {
    showHelp();
    return;
  }

  pushHistory(text);
  const outcome = runDSL(ctx, text);

  // Show parse errors
  let html = '';
  for (const err of outcome.parseErrors) {
    html += `<div class="script-output-error">Parse error (line ${err.line}): ${escapeHtml(err.message)}</div>`;
  }

  // Show execution results. Each result's message is already the human-readable
  // outcome (including echo text), rendered in execution order, so echoes need
  // no separate pass.
  if (outcome.commandCount > 0) {
    for (const result of outcome.results) {
      const cls = result.success ? 'script-output-success' : 'script-output-error';
      html += `<div class="${cls}">Line ${result.line}: ${escapeHtml(result.message)}</div>`;
    }

    const successCount = outcome.results.filter((r) => r.success).length;
    const failCount = outcome.results.filter((r) => !r.success).length;
    const executed = outcome.results.length;
    const notRun = outcome.commandCount - executed;
    html += `<div class="script-output-info">---</div>`;
    if (notRun > 0) {
      // Execution halts on the first failure; be explicit about what did not run.
      const lastLine = outcome.results[executed - 1]?.line;
      html += `<div class="script-output-info">${successCount} succeeded, ${failCount} failed; stopped at line ${lastLine} (${notRun} of ${outcome.commandCount} not run)</div>`;
    } else {
      html += `<div class="script-output-info">${successCount} succeeded, ${failCount} failed (${outcome.commandCount} total)</div>`;
    }
  }

  outputEl.innerHTML = html || '<span class="script-output-info">No commands to execute.</span>';
}
