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
import { SYSTEM_PROMPT, buildUserMessage } from '../ai/AIPrompts';

const STORAGE_KEY = 'openpretext-ai-key';

let aiPanelVisible = false;

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

function renderResults(ctx: AppContext, text: string): void {
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

    // Call the API
    const client = new AIClient(apiKey);
    const response = await client.analyze(base64, SYSTEM_PROMPT, userMessage);

    if (statusEl) statusEl.textContent = '';
    renderResults(ctx, response);
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
}
