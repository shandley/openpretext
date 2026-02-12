/**
 * PromptStrategy — types and loader for the prompt strategy library.
 *
 * Each strategy augments the base AI system prompt with domain-specific
 * guidance and optional few-shot examples. Supports built-in strategies
 * from prompt-strategies.json and user-created custom strategies stored
 * in localStorage.
 */

export interface StrategyExample {
  /** Description of what the user sees in the contact map. */
  scenario: string;
  /** DSL commands that address the scenario. */
  commands: string;
}

export interface PromptStrategy {
  id: string;
  name: string;
  description: string;
  category: 'general' | 'pattern' | 'workflow' | 'organism';
  /** Text appended to the base system prompt. Empty string means use base prompt as-is. */
  supplement: string;
  /** Few-shot examples shown to the model. */
  examples: StrategyExample[];
  /** True for user-created strategies stored in localStorage. */
  isCustom?: boolean;
}

export interface StrategyLibrary {
  version: string;
  strategies: PromptStrategy[];
}

const CUSTOM_STORAGE_KEY = 'openpretext-custom-strategies';

let cached: StrategyLibrary | null = null;

export async function loadStrategyLibrary(): Promise<StrategyLibrary> {
  if (cached) return cached;
  const url = new URL('data/prompt-strategies.json', document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load prompt strategies: ${response.status}`);
  }
  const data: StrategyLibrary = await response.json();
  cached = data;
  return data;
}

export function getStrategyById(
  library: StrategyLibrary,
  id: string,
): PromptStrategy | undefined {
  return library.strategies.find((s) => s.id === id);
}

/** Load custom strategies from localStorage. Returns empty array if none exist. */
export function loadCustomStrategies(): PromptStrategy[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s: PromptStrategy) => ({ ...s, isCustom: true }));
  } catch {
    return [];
  }
}

/** Save custom strategies to localStorage. */
export function saveCustomStrategies(strategies: PromptStrategy[]): void {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(strategies));
}

/** Delete a custom strategy by id. */
export function deleteCustomStrategy(id: string): void {
  const strategies = loadCustomStrategies();
  const filtered = strategies.filter((s) => s.id !== id);
  saveCustomStrategies(filtered);
}

/** Merge built-in and custom strategies into a single array. Custom strategies are marked with isCustom: true. */
export function mergeStrategies(
  builtIn: PromptStrategy[],
  custom: PromptStrategy[],
): PromptStrategy[] {
  const tagged = custom.map((s) => ({ ...s, isCustom: true as const }));
  return [...builtIn, ...tagged];
}

/** Reset cache (for testing). */
export function _resetCache(): void {
  cached = null;
}
