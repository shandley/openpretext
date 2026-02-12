/**
 * Tests for AIFeedback storage and aggregation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveFeedback,
  loadFeedback,
  getStrategyRatingSummary,
  clearFeedback,
  type FeedbackEntry,
} from '../../src/ai/AIFeedback';

// Mock localStorage for Node test environment
const storage = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
  get length() { return storage.size; },
  key: vi.fn((_index: number) => null),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('AIFeedback', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  describe('saveFeedback', () => {
    it('should store entries in localStorage', () => {
      const entry: FeedbackEntry = {
        strategyId: 'general',
        timestamp: 1000,
        rating: 'up',
        executed: false,
      };
      saveFeedback(entry);

      const stored = JSON.parse(storage.get('openpretext-ai-feedback')!);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(entry);
    });

    it('should append multiple entries', () => {
      saveFeedback({ strategyId: 'general', timestamp: 1000, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'pattern', timestamp: 2000, rating: 'down', executed: true });

      const entries = loadFeedback();
      expect(entries).toHaveLength(2);
      expect(entries[0].strategyId).toBe('general');
      expect(entries[1].strategyId).toBe('pattern');
    });

    it('should cap at 500 entries, trimming oldest', () => {
      // Pre-fill with 500 entries
      const existing: FeedbackEntry[] = [];
      for (let i = 0; i < 500; i++) {
        existing.push({
          strategyId: 'general',
          timestamp: i,
          rating: 'up',
          executed: false,
        });
      }
      storage.set('openpretext-ai-feedback', JSON.stringify(existing));

      // Add one more — should trim the oldest (timestamp=0)
      saveFeedback({
        strategyId: 'overflow',
        timestamp: 999999,
        rating: 'down',
        executed: true,
      });

      const entries = loadFeedback();
      expect(entries).toHaveLength(500);
      // Oldest entry (timestamp=0) should be gone
      expect(entries[0].timestamp).toBe(1);
      // Newest entry should be the one we just added
      expect(entries[entries.length - 1].strategyId).toBe('overflow');
      expect(entries[entries.length - 1].timestamp).toBe(999999);
    });
  });

  describe('loadFeedback', () => {
    it('should return empty array when no data exists', () => {
      expect(loadFeedback()).toEqual([]);
    });

    it('should return stored entries', () => {
      const entries: FeedbackEntry[] = [
        { strategyId: 'general', timestamp: 1000, rating: 'up', executed: false },
        { strategyId: 'pattern', timestamp: 2000, rating: 'down', executed: true },
      ];
      storage.set('openpretext-ai-feedback', JSON.stringify(entries));

      const result = loadFeedback();
      expect(result).toEqual(entries);
    });

    it('should return empty array for invalid JSON', () => {
      storage.set('openpretext-ai-feedback', 'not-json');
      expect(loadFeedback()).toEqual([]);
    });

    it('should return empty array for non-array JSON', () => {
      storage.set('openpretext-ai-feedback', JSON.stringify({ not: 'an-array' }));
      expect(loadFeedback()).toEqual([]);
    });
  });

  describe('getStrategyRatingSummary', () => {
    it('should aggregate feedback for a specific strategy', () => {
      saveFeedback({ strategyId: 'general', timestamp: 1000, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'general', timestamp: 2000, rating: 'up', executed: true });
      saveFeedback({ strategyId: 'general', timestamp: 3000, rating: 'down', executed: false });
      saveFeedback({ strategyId: 'pattern', timestamp: 4000, rating: 'up', executed: false });

      const summary = getStrategyRatingSummary('general');
      expect(summary).not.toBeNull();
      expect(summary!.up).toBe(2);
      expect(summary!.down).toBe(1);
      expect(summary!.total).toBe(3);
    });

    it('should return null for unknown strategy', () => {
      saveFeedback({ strategyId: 'general', timestamp: 1000, rating: 'up', executed: false });

      const summary = getStrategyRatingSummary('nonexistent');
      expect(summary).toBeNull();
    });

    it('should return null when no feedback exists at all', () => {
      expect(getStrategyRatingSummary('general')).toBeNull();
    });

    it('should only count entries for the requested strategy', () => {
      saveFeedback({ strategyId: 'pattern', timestamp: 1000, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'pattern', timestamp: 2000, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'general', timestamp: 3000, rating: 'down', executed: false });

      const patternSummary = getStrategyRatingSummary('pattern');
      expect(patternSummary).toEqual({ up: 2, down: 0, total: 2 });

      const generalSummary = getStrategyRatingSummary('general');
      expect(generalSummary).toEqual({ up: 0, down: 1, total: 1 });
    });
  });

  describe('clearFeedback', () => {
    it('should remove all entries', () => {
      saveFeedback({ strategyId: 'general', timestamp: 1000, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'pattern', timestamp: 2000, rating: 'down', executed: true });
      expect(loadFeedback()).toHaveLength(2);

      clearFeedback();
      expect(loadFeedback()).toEqual([]);
    });

    it('should be safe to call when no feedback exists', () => {
      expect(() => clearFeedback()).not.toThrow();
      expect(loadFeedback()).toEqual([]);
    });
  });

  describe('FeedbackEntry structure', () => {
    it('should preserve all fields correctly', () => {
      const entry: FeedbackEntry = {
        strategyId: 'workflow',
        timestamp: 1707782400000,
        rating: 'down',
        executed: true,
      };
      saveFeedback(entry);

      const loaded = loadFeedback();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].strategyId).toBe('workflow');
      expect(loaded[0].timestamp).toBe(1707782400000);
      expect(loaded[0].rating).toBe('down');
      expect(loaded[0].executed).toBe(true);
    });

    it('should handle both rating values', () => {
      saveFeedback({ strategyId: 'a', timestamp: 1, rating: 'up', executed: false });
      saveFeedback({ strategyId: 'b', timestamp: 2, rating: 'down', executed: true });

      const loaded = loadFeedback();
      expect(loaded[0].rating).toBe('up');
      expect(loaded[1].rating).toBe('down');
    });

    it('should handle executed as true and false', () => {
      saveFeedback({ strategyId: 'a', timestamp: 1, rating: 'up', executed: true });
      saveFeedback({ strategyId: 'b', timestamp: 2, rating: 'up', executed: false });

      const loaded = loadFeedback();
      expect(loaded[0].executed).toBe(true);
      expect(loaded[1].executed).toBe(false);
    });
  });
});
