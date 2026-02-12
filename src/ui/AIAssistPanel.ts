/**
 * AIAssistPanel — AI-powered curation assistant panel.
 *
 * Captures a contact map screenshot, sends it to Claude's vision API
 * with assembly context, and renders DSL suggestions the user can
 * execute individually.
 *
 * Module-local state: aiPanelVisible flag.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { CurationEngine } from '../curation/CurationEngine';
import { SelectionManager } from '../curation/SelectionManager';
import { parseScript } from '../scripting/ScriptParser';
import { executeScript, type ScriptContext } from '../scripting/ScriptExecutor';
import { autoSortContigs, autoCutContigs } from '../curation/BatchOperations';
import { captureDataURL } from '../export/SnapshotExporter';
import { AIClient, AIAuthError, AIRateLimitError } from '../ai/AIClient';
import { buildAnalysisContext } from '../ai/AIContext';
import { buildSystemPrompt, buildUserMessage } from '../ai/AIPrompts';
import {
  loadStrategyLibrary,
  getStrategyById,
  loadCustomStrategies,
  saveCustomStrategies,
  deleteCustomStrategy,
  mergeStrategies,
  type StrategyLibrary,
  type PromptStrategy,
  type StrategyExample,
} from '../data/PromptStrategy';
import { exportStrategyAsJSON, parseImportedStrategies } from '../ai/AIStrategyIO';
import { attachFeedbackButtons } from './AIFeedbackUI';
import { getStrategyRatingSummary } from '../ai/AIFeedback';

const STORAGE_KEY = 'openpretext-ai-key';

let aiPanelVisible = false;
let strategyLibrary: StrategyLibrary | null = null;

export function isAIPanelVisible(): boolean {
  return aiPanelVisible;
}

export function toggleAIAssist(): void {
  aiPanelVisible = !aiPanelVisible;
  const el = document.getElementById('ai-assist-panel');
  if (el) el.classList.toggle('visible', aiPanelVisible);
}

/**
 * Parse an AI response into alternating prose and DSL code blocks.
 * Exported for testing.
 */
export function parseAIResponse(text: string): Array<{ type: 'prose' | 'dsl'; content: string }> {
  const blocks: Array<{ type: 'prose' | 'dsl'; content: string }> = [];
  const parts = text.split(/```(?:dsl)?\s*\n?/);

  for (let i = 0; i < parts.length; i++) {
    const content = parts[i].trim();
    if (!content) continue;
    // Odd indices are inside code fences
    blocks.push({ type: i % 2 === 1 ? 'dsl' : 'prose', content });
  }

  return blocks;
}

function runDSLBlock(ctx: AppContext, dsl: string): void {
  const parseResult = parseScript(dsl);

  const scriptCtx: ScriptContext = {
    curation: CurationEngine,
    selection: SelectionManager,
    scaffold: ctx.scaffoldManager,
    state: state,
    batch: { autoCutContigs, autoSortContigs },
    onEcho: () => {},
  };

  if (parseResult.errors.length > 0) {
    const errMsg = parseResult.errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n');
    ctx.showToast(`Parse errors:\n${errMsg}`, 5000);
    return;
  }

  if (parseResult.commands.length === 0) {
    ctx.showToast('No commands to execute', 3000);
    return;
  }

  const results = executeScript(parseResult.commands, scriptCtx);
  ctx.refreshAfterCuration();
  ctx.updateSidebarScaffoldList();

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  ctx.showToast(`Executed: ${successCount} succeeded, ${failCount} failed`, 3000);
}

function renderResults(ctx: AppContext, text: string, strategyId: string): void {
  const resultsEl = document.getElementById('ai-results');
  if (!resultsEl) return;

  const blocks = parseAIResponse(text);
  resultsEl.innerHTML = '';

  for (const block of blocks) {
    if (block.type === 'prose') {
      const div = document.createElement('div');
      div.className = 'ai-prose';
      div.textContent = block.content;
      resultsEl.appendChild(div);
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'ai-code-block';

      const pre = document.createElement('pre');
      pre.textContent = block.content;
      wrapper.appendChild(pre);

      const btn = document.createElement('button');
      btn.className = 'ai-run-btn';
      btn.textContent = 'Run';
      btn.addEventListener('click', () => {
        runDSLBlock(ctx, block.content);
      });
      wrapper.appendChild(btn);

      attachFeedbackButtons(wrapper, strategyId, block.content);

      resultsEl.appendChild(wrapper);
    }
  }
}

async function analyzeMap(ctx: AppContext): Promise<void> {
  const statusEl = document.getElementById('ai-status');
  const resultsEl = document.getElementById('ai-results');

  const apiKey = localStorage.getItem(STORAGE_KEY);
  if (!apiKey) {
    if (statusEl) statusEl.textContent = 'Please enter your Anthropic API key above.';
    return;
  }

  const s = state.get();
  if (!s.map) {
    if (statusEl) statusEl.textContent = 'No assembly loaded. Open a .pretext file first.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Analyzing contact map...';
  if (resultsEl) resultsEl.innerHTML = '';

  try {
    // Capture the contact map screenshot (preserveDrawingBuffer is enabled)
    const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    if (!canvas) throw new Error('Canvas not found');
    const dataURL = captureDataURL(canvas, { includeOverlays: true });
    const base64 = dataURL.replace(/^data:image\/png;base64,/, '');

    // Build context
    const context = buildAnalysisContext(ctx);
    const userMessage = buildUserMessage(context);

    // Build system prompt with selected strategy
    const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
    const strategyId = select?.value ?? 'general';
    const strategy = strategyLibrary ? getStrategyById(strategyLibrary, strategyId) : undefined;
    const systemPrompt = buildSystemPrompt(strategy);

    // Call the API
    const client = new AIClient(apiKey);
    const response = await client.analyze(base64, systemPrompt, userMessage);

    if (statusEl) statusEl.textContent = '';
    renderResults(ctx, response, strategyId);
  } catch (err: any) {
    if (err instanceof AIAuthError) {
      if (statusEl) statusEl.textContent = 'Invalid API key. Please check and try again.';
    } else if (err instanceof AIRateLimitError) {
      if (statusEl) statusEl.textContent = 'Rate limited. Please wait a moment and try again.';
    } else {
      if (statusEl) statusEl.textContent = `Error: ${err.message ?? 'Unknown error'}`;
    }
  }
}

/** All strategies (built-in + custom) currently displayed in the dropdown. */
let allStrategies: PromptStrategy[] = [];

/** The strategy currently being edited (null = new strategy). */
let editingStrategyId: string | null = null;

function refreshStrategyDropdown(ctx: AppContext): void {
  const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
  const descEl = document.getElementById('ai-strategy-desc');
  if (!select) return;

  const builtIn = strategyLibrary?.strategies ?? [];
  const custom = loadCustomStrategies();
  allStrategies = mergeStrategies(builtIn, custom);

  const previousValue = select.value;
  select.innerHTML = '';
  for (const s of allStrategies) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.isCustom ? `${s.name} (Custom)` : s.name;
    select.appendChild(opt);
  }

  // Restore previous selection if it still exists
  if (allStrategies.some((s) => s.id === previousValue)) {
    select.value = previousValue;
  }

  updateStrategyDesc();
  updateEditorButtons();
}

function updateStrategyDesc(): void {
  const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
  const descEl = document.getElementById('ai-strategy-desc');
  if (!select || !descEl) return;
  const strategy = allStrategies.find((s) => s.id === select.value);
  let text = strategy?.description ?? '';
  const summary = getStrategyRatingSummary(select.value);
  if (summary && summary.total > 0) {
    const pct = Math.round((summary.up / summary.total) * 100);
    text += ` (${pct}% positive, ${summary.total} ratings)`;
  }
  descEl.textContent = text;
}

function updateEditorButtons(): void {
  const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
  const editBtn = document.getElementById('btn-ai-edit-strategy');
  const deleteBtn = document.getElementById('btn-ai-delete-strategy');
  if (!select || !editBtn || !deleteBtn) return;

  const strategy = allStrategies.find((s) => s.id === select.value);
  const isCustom = strategy?.isCustom === true;
  editBtn.style.display = isCustom ? 'inline-block' : 'none';
  deleteBtn.style.display = isCustom ? 'inline-block' : 'none';
}

function showEditor(strategy: PromptStrategy | null): void {
  const editor = document.getElementById('ai-strategy-editor');
  if (!editor) return;

  editingStrategyId = strategy?.id ?? null;

  const nameInput = document.getElementById('ai-editor-name') as HTMLInputElement;
  const descInput = document.getElementById('ai-editor-desc') as HTMLInputElement;
  const catSelect = document.getElementById('ai-editor-category') as HTMLSelectElement;
  const suppInput = document.getElementById('ai-editor-supplement') as HTMLTextAreaElement;
  const examplesContainer = document.getElementById('ai-editor-examples');

  if (nameInput) nameInput.value = strategy?.name ?? '';
  if (descInput) descInput.value = strategy?.description ?? '';
  if (catSelect) catSelect.value = strategy?.category ?? 'general';
  if (suppInput) suppInput.value = strategy?.supplement ?? '';

  // Populate examples
  if (examplesContainer) {
    examplesContainer.innerHTML = '';
    if (strategy?.examples && strategy.examples.length > 0) {
      for (const ex of strategy.examples) {
        addExampleRow(examplesContainer, ex.scenario, ex.commands);
      }
    }
  }

  editor.style.display = 'block';
}

function hideEditor(): void {
  const editor = document.getElementById('ai-strategy-editor');
  if (editor) editor.style.display = 'none';
  editingStrategyId = null;
}

function addExampleRow(container: HTMLElement, scenario: string = '', commands: string = ''): void {
  const row = document.createElement('div');
  row.className = 'ai-example-row';

  const scenarioInput = document.createElement('input');
  scenarioInput.type = 'text';
  scenarioInput.placeholder = 'Scenario description';
  scenarioInput.className = 'ai-editor-input';
  scenarioInput.value = scenario;

  const commandsInput = document.createElement('textarea');
  commandsInput.placeholder = 'DSL commands';
  commandsInput.className = 'ai-editor-textarea ai-editor-commands';
  commandsInput.rows = 2;
  commandsInput.value = commands;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ai-small-btn ai-delete-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(scenarioInput);
  row.appendChild(commandsInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function collectExamples(): StrategyExample[] {
  const container = document.getElementById('ai-editor-examples');
  if (!container) return [];
  const rows = container.querySelectorAll('.ai-example-row');
  const examples: StrategyExample[] = [];
  rows.forEach((row) => {
    const scenario = (row.querySelector('input') as HTMLInputElement)?.value?.trim() ?? '';
    const commands = (row.querySelector('textarea') as HTMLTextAreaElement)?.value?.trim() ?? '';
    if (scenario || commands) {
      examples.push({ scenario, commands });
    }
  });
  return examples;
}

function saveEditorStrategy(ctx: AppContext): void {
  const nameInput = document.getElementById('ai-editor-name') as HTMLInputElement;
  const descInput = document.getElementById('ai-editor-desc') as HTMLInputElement;
  const catSelect = document.getElementById('ai-editor-category') as HTMLSelectElement;
  const suppInput = document.getElementById('ai-editor-supplement') as HTMLTextAreaElement;

  const name = nameInput?.value?.trim();
  if (!name) {
    ctx.showToast('Strategy name is required', 3000);
    return;
  }

  const examples = collectExamples();
  const category = (catSelect?.value ?? 'general') as PromptStrategy['category'];

  const existing = loadCustomStrategies();

  if (editingStrategyId) {
    // Update existing
    const idx = existing.findIndex((s) => s.id === editingStrategyId);
    if (idx !== -1) {
      existing[idx] = {
        ...existing[idx],
        name,
        description: descInput?.value?.trim() ?? '',
        category,
        supplement: suppInput?.value?.trim() ?? '',
        examples,
        isCustom: true,
      };
    }
  } else {
    // Create new
    const id = 'custom-' + Date.now().toString(36);
    existing.push({
      id,
      name,
      description: descInput?.value?.trim() ?? '',
      category,
      supplement: suppInput?.value?.trim() ?? '',
      examples,
      isCustom: true,
    });
  }

  saveCustomStrategies(existing);
  hideEditor();
  refreshStrategyDropdown(ctx);
  ctx.showToast(editingStrategyId ? 'Strategy updated' : 'Strategy created', 2000);
}

export function setupAIAssist(ctx: AppContext): void {
  // Toggle button
  document.getElementById('btn-ai-assist')?.addEventListener('click', () => {
    toggleAIAssist();
  });

  // Close button
  document.getElementById('btn-close-ai')?.addEventListener('click', () => {
    aiPanelVisible = false;
    document.getElementById('ai-assist-panel')?.classList.remove('visible');
  });

  // Save API key
  document.getElementById('btn-ai-save-key')?.addEventListener('click', () => {
    const input = document.getElementById('ai-api-key') as HTMLInputElement;
    if (input?.value) {
      localStorage.setItem(STORAGE_KEY, input.value.trim());
      ctx.showToast('API key saved', 2000);
    }
  });

  // Load saved key into input
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    const input = document.getElementById('ai-api-key') as HTMLInputElement;
    if (input) input.value = savedKey;
  }

  // Analyze button
  document.getElementById('btn-ai-analyze')?.addEventListener('click', () => {
    analyzeMap(ctx);
  });

  // Strategy dropdown change
  document.getElementById('ai-strategy-select')?.addEventListener('change', () => {
    updateStrategyDesc();
    updateEditorButtons();
  });

  // New strategy button
  document.getElementById('btn-ai-new-strategy')?.addEventListener('click', () => {
    showEditor(null);
  });

  // Edit strategy button
  document.getElementById('btn-ai-edit-strategy')?.addEventListener('click', () => {
    const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
    const strategy = allStrategies.find((s) => s.id === select?.value);
    if (strategy?.isCustom) {
      showEditor(strategy);
    }
  });

  // Delete strategy button
  document.getElementById('btn-ai-delete-strategy')?.addEventListener('click', () => {
    const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
    const strategy = allStrategies.find((s) => s.id === select?.value);
    if (strategy?.isCustom) {
      deleteCustomStrategy(strategy.id);
      hideEditor();
      refreshStrategyDropdown(ctx);
      ctx.showToast('Strategy deleted', 2000);
    }
  });

  // Editor save button
  document.getElementById('btn-ai-editor-save')?.addEventListener('click', () => {
    saveEditorStrategy(ctx);
  });

  // Editor cancel button
  document.getElementById('btn-ai-editor-cancel')?.addEventListener('click', () => {
    hideEditor();
  });

  // Add example button
  document.getElementById('btn-ai-add-example')?.addEventListener('click', () => {
    const container = document.getElementById('ai-editor-examples');
    if (container) addExampleRow(container);
  });

  // Export strategy button
  document.getElementById('btn-ai-export')?.addEventListener('click', () => {
    const select = document.getElementById('ai-strategy-select') as HTMLSelectElement;
    const strategy = allStrategies.find((s) => s.id === select?.value);
    if (strategy) {
      exportStrategyAsJSON(strategy);
      ctx.showToast('Strategy exported', 2000);
    }
  });

  // Import strategy button — triggers hidden file input
  document.getElementById('btn-ai-import')?.addEventListener('click', () => {
    const fileInput = document.getElementById('ai-strategy-import') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  // Handle imported strategy file
  document.getElementById('ai-strategy-import')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseImportedStrategies(reader.result as string);
        if (imported.length === 0) {
          ctx.showToast('No strategies found in file', 3000);
          return;
        }

        const existing = loadCustomStrategies();
        const existingIds = new Set(existing.map((s) => s.id));
        let added = 0;
        for (const s of imported) {
          if (!existingIds.has(s.id)) {
            existing.push(s);
            existingIds.add(s.id);
            added++;
          }
        }

        saveCustomStrategies(existing);
        refreshStrategyDropdown(ctx);
        ctx.showToast(`Imported ${added} ${added === 1 ? 'strategy' : 'strategies'}`, 3000);
      } catch (err: any) {
        ctx.showToast(`Import failed: ${err.message}`, 4000);
      }
    };
    reader.readAsText(file);
  });

  // Load strategy library and populate dropdown
  loadStrategyLibrary()
    .then((lib) => {
      strategyLibrary = lib;
      refreshStrategyDropdown(ctx);
    })
    .catch(() => {
      // Strategy loading is optional — panel still works without it
      // Still load custom strategies even if built-in loading fails
      refreshStrategyDropdown(ctx);
    });
}
