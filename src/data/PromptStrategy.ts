/**
 * PromptStrategy — types and loader for the prompt strategy library.
 *
 * Each strategy augments the base AI system prompt with domain-specific
 * guidance and optional few-shot examples.
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
}

export interface StrategyLibrary {
  version: string;
  strategies: PromptStrategy[];
}

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

/** Reset cache (for testing). */
export function _resetCache(): void {
  cached = null;
}
