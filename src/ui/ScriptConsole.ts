/**
 * ScriptConsole — in-app scripting console for automation.
 *
 * Module-local state: scriptConsoleVisible flag.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { CurationEngine } from '../curation/CurationEngine';
import { SelectionManager } from '../curation/SelectionManager';
import { parseScript } from '../scripting/ScriptParser';
import { executeScript, type ScriptContext } from '../scripting/ScriptExecutor';
import { operationsToScript } from '../scripting/ScriptReplay';
import { autoSortContigs, autoCutContigs } from '../curation/BatchOperations';

let scriptConsoleVisible = false;

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

  // Ctrl+Enter to run script
  const input = document.getElementById('script-input') as HTMLTextAreaElement;
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runScript(ctx);
    }
    // Tab key inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.substring(0, start) + '  ' + input.value.substring(end);
      input.selectionStart = input.selectionEnd = start + 2;
    }
  });
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

  const parseResult = parseScript(text);

  // Build script context
  const echoMessages: string[] = [];
  const scriptCtx: ScriptContext = {
    curation: CurationEngine,
    selection: SelectionManager,
    scaffold: ctx.scaffoldManager,
    state: state,
    batch: { autoCutContigs, autoSortContigs },
    onEcho: (msg) => echoMessages.push(msg),
  };

  // Show parse errors
  let html = '';
  if (parseResult.errors.length > 0) {
    for (const err of parseResult.errors) {
      html += `<div class="script-output-error">Parse error (line ${err.line}): ${err.message}</div>`;
    }
  }

  // Execute commands
  if (parseResult.commands.length > 0) {
    const results = executeScript(parseResult.commands, scriptCtx);
    for (const result of results) {
      const cls = result.success ? 'script-output-success' : 'script-output-error';
      html += `<div class="${cls}">Line ${result.line}: ${result.message}</div>`;
    }

    // Show echo output
    for (const msg of echoMessages) {
      html += `<div class="script-output-info">${msg}</div>`;
    }

    // Refresh UI after script execution
    ctx.refreshAfterCuration();
    ctx.updateSidebarScaffoldList();

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    html += `<div class="script-output-info">---</div>`;
    html += `<div class="script-output-info">${successCount} succeeded, ${failCount} failed (${results.length} total)</div>`;
  }

  outputEl.innerHTML = html || '<span class="script-output-info">No commands to execute.</span>';
}
