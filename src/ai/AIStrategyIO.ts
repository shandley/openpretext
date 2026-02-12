/**
 * AIStrategyIO — export and import prompt strategies as JSON files.
 *
 * Enables sharing strategies between users via file exchange.
 * Uses the same download pattern as SnapshotExporter (create <a>, click, remove).
 */

import type { PromptStrategy } from '../data/PromptStrategy';

/** Built-in strategy IDs that must not be overwritten by imports. */
const BUILT_IN_IDS = new Set([
  'general',
  'inversion-focus',
  'scaffolding',
  'fragmented-assembly',
  'micro-chromosomes',
]);

/**
 * Export a single strategy as a JSON file download.
 * Triggers a browser download of `strategy-{id}.json`.
 */
export function exportStrategyAsJSON(strategy: PromptStrategy): void {
  const json = JSON.stringify(strategy, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `strategy-${strategy.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export all custom strategies as a single JSON file download.
 * Format: { version: "1.0.0", strategies: [...] }
 */
export function exportAllCustomStrategies(strategies: PromptStrategy[]): void {
  const payload = {
    version: '1.0.0',
    strategies,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'custom-strategies.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse imported JSON text into an array of PromptStrategy objects.
 *
 * Accepts either a single strategy object or an object with a `strategies` array.
 * All imported strategies are marked with `isCustom: true`.
 * IDs that conflict with built-in strategy IDs are prefixed with "imported-".
 *
 * @throws {Error} If the JSON is invalid or required fields are missing.
 */
export function parseImportedStrategies(jsonText: string): PromptStrategy[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON');
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid JSON: expected an object');
  }

  let rawStrategies: unknown[];

  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.strategies)) {
    rawStrategies = obj.strategies;
  } else if (typeof obj.id === 'string') {
    // Single strategy object
    rawStrategies = [obj];
  } else {
    throw new Error('Invalid format: expected a strategy object or { strategies: [...] }');
  }

  const results: PromptStrategy[] = [];

  for (const raw of rawStrategies) {
    if (raw === null || typeof raw !== 'object') {
      throw new Error('Invalid strategy: expected an object');
    }

    const s = raw as Record<string, unknown>;

    if (typeof s.id !== 'string' || !s.id) {
      throw new Error('Invalid strategy: missing required field "id"');
    }
    if (typeof s.name !== 'string' || !s.name) {
      throw new Error('Invalid strategy: missing required field "name"');
    }
    if (typeof s.supplement !== 'string') {
      throw new Error('Invalid strategy: missing required field "supplement"');
    }

    let id = s.id;
    if (BUILT_IN_IDS.has(id)) {
      id = `imported-${id}`;
    }

    results.push({
      id,
      name: s.name as string,
      description: (typeof s.description === 'string' ? s.description : '') as string,
      category: isValidCategory(s.category) ? s.category : 'general',
      supplement: s.supplement as string,
      examples: Array.isArray(s.examples) ? filterValidExamples(s.examples) : [],
      isCustom: true,
    });
  }

  return results;
}

function isValidCategory(value: unknown): value is PromptStrategy['category'] {
  return value === 'general' || value === 'pattern' || value === 'workflow' || value === 'organism';
}

/** Keep only example entries that have string scenario and commands fields. */
function filterValidExamples(arr: unknown[]): { scenario: string; commands: string }[] {
  const result: { scenario: string; commands: string }[] = [];
  for (const item of arr) {
    if (item !== null && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.scenario === 'string' && typeof obj.commands === 'string') {
        result.push({ scenario: obj.scenario, commands: obj.commands });
      }
    }
  }
  return result;
}
