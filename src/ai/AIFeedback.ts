/**
 * AIFeedback — localStorage-backed per-suggestion feedback storage.
 *
 * Stores thumbs-up/down ratings for AI code block suggestions, keyed
 * by prompt strategy. Caps storage at 500 entries (oldest trimmed).
 */

const FEEDBACK_KEY = 'openpretext-ai-feedback';
const MAX_ENTRIES = 500;

export interface FeedbackEntry {
  strategyId: string;
  timestamp: number;
  rating: 'up' | 'down';
  /** Whether the user clicked "Run" on this code block. */
  executed: boolean;
}

/** Load all feedback entries from localStorage. Returns empty array if none exist. */
export function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Save a feedback entry. Appends to existing entries, trimming oldest if > 500. */
export function saveFeedback(entry: FeedbackEntry): void {
  const entries = loadFeedback();
  entries.push(entry);
  // Trim oldest entries if we exceed the cap
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
}

/** Aggregate feedback for a specific strategy. Returns null if no feedback exists. */
export function getStrategyRatingSummary(
  strategyId: string,
): { up: number; down: number; total: number } | null {
  const entries = loadFeedback();
  const matched = entries.filter((e) => e.strategyId === strategyId);
  if (matched.length === 0) return null;
  const up = matched.filter((e) => e.rating === 'up').length;
  const down = matched.filter((e) => e.rating === 'down').length;
  return { up, down, total: matched.length };
}

/** Clear all feedback entries (for testing/reset). */
export function clearFeedback(): void {
  localStorage.removeItem(FEEDBACK_KEY);
}
