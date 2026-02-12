/**
 * Tests for custom strategy management in PromptStrategy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadCustomStrategies,
  saveCustomStrategies,
  deleteCustomStrategy,
  mergeStrategies,
  type PromptStrategy,
} from '../../src/data/PromptStrategy';

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

const CUSTOM_STORAGE_KEY = 'openpretext-custom-strategies';

function makeStrategy(overrides: Partial<PromptStrategy> = {}): PromptStrategy {
  return {
    id: 'test-1',
    name: 'Test Strategy',
    description: 'A test strategy',
    category: 'general',
    supplement: 'Some supplement text',
    examples: [],
    ...overrides,
  };
}

describe('Custom Strategy Management', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  describe('loadCustomStrategies', () => {
    it('should return empty array when localStorage is empty', () => {
      const result = loadCustomStrategies();
      expect(result).toEqual([]);
    });

    it('should return empty array when localStorage contains invalid JSON', () => {
      localStorage.setItem(CUSTOM_STORAGE_KEY, 'not json');
      const result = loadCustomStrategies();
      expect(result).toEqual([]);
    });

    it('should return empty array when localStorage contains a non-array', () => {
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
      const result = loadCustomStrategies();
      expect(result).toEqual([]);
    });

    it('should mark loaded strategies with isCustom: true', () => {
      const strategy = makeStrategy({ isCustom: false });
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify([strategy]));
      const result = loadCustomStrategies();
      expect(result).toHaveLength(1);
      expect(result[0].isCustom).toBe(true);
    });
  });

  describe('saveCustomStrategies', () => {
    it('should persist strategies to localStorage', () => {
      const strategies = [makeStrategy()];
      saveCustomStrategies(strategies);
      const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('test-1');
    });

    it('should overwrite previous strategies', () => {
      saveCustomStrategies([makeStrategy({ id: 'a' })]);
      saveCustomStrategies([makeStrategy({ id: 'b' })]);
      const result = loadCustomStrategies();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b');
    });
  });

  describe('saveCustomStrategies/loadCustomStrategies round-trip', () => {
    it('should round-trip a single strategy', () => {
      const strategy = makeStrategy({
        id: 'round-trip',
        name: 'Round Trip',
        description: 'Tests round-trip',
        category: 'pattern',
        supplement: 'supplement text',
        examples: [{ scenario: 'test scenario', commands: 'invert chr1' }],
      });
      saveCustomStrategies([strategy]);
      const loaded = loadCustomStrategies();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('round-trip');
      expect(loaded[0].name).toBe('Round Trip');
      expect(loaded[0].description).toBe('Tests round-trip');
      expect(loaded[0].category).toBe('pattern');
      expect(loaded[0].supplement).toBe('supplement text');
      expect(loaded[0].examples).toHaveLength(1);
      expect(loaded[0].examples[0].scenario).toBe('test scenario');
      expect(loaded[0].examples[0].commands).toBe('invert chr1');
      expect(loaded[0].isCustom).toBe(true);
    });

    it('should round-trip multiple strategies', () => {
      const strategies = [
        makeStrategy({ id: 'a', name: 'Alpha' }),
        makeStrategy({ id: 'b', name: 'Beta' }),
        makeStrategy({ id: 'c', name: 'Gamma' }),
      ];
      saveCustomStrategies(strategies);
      const loaded = loadCustomStrategies();
      expect(loaded).toHaveLength(3);
      expect(loaded.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('deleteCustomStrategy', () => {
    it('should remove a strategy by id', () => {
      saveCustomStrategies([
        makeStrategy({ id: 'keep' }),
        makeStrategy({ id: 'remove' }),
      ]);
      deleteCustomStrategy('remove');
      const result = loadCustomStrategies();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('keep');
    });

    it('should do nothing if id does not exist', () => {
      saveCustomStrategies([makeStrategy({ id: 'exists' })]);
      deleteCustomStrategy('does-not-exist');
      const result = loadCustomStrategies();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('exists');
    });

    it('should handle empty storage gracefully', () => {
      deleteCustomStrategy('anything');
      const result = loadCustomStrategies();
      expect(result).toEqual([]);
    });
  });

  describe('mergeStrategies', () => {
    it('should combine built-in and custom arrays', () => {
      const builtIn: PromptStrategy[] = [
        makeStrategy({ id: 'general', name: 'General Analysis' }),
      ];
      const custom: PromptStrategy[] = [
        makeStrategy({ id: 'custom-1', name: 'My Custom' }),
      ];
      const merged = mergeStrategies(builtIn, custom);
      expect(merged).toHaveLength(2);
      expect(merged[0].id).toBe('general');
      expect(merged[1].id).toBe('custom-1');
    });

    it('should mark custom strategies with isCustom: true', () => {
      const builtIn: PromptStrategy[] = [
        makeStrategy({ id: 'general' }),
      ];
      const custom: PromptStrategy[] = [
        makeStrategy({ id: 'custom-1', isCustom: false }),
      ];
      const merged = mergeStrategies(builtIn, custom);
      expect(merged[0].isCustom).toBeUndefined();
      expect(merged[1].isCustom).toBe(true);
    });

    it('should not modify built-in strategies', () => {
      const builtIn: PromptStrategy[] = [
        makeStrategy({ id: 'general', name: 'General' }),
      ];
      const custom: PromptStrategy[] = [];
      const merged = mergeStrategies(builtIn, custom);
      expect(merged).toHaveLength(1);
      expect(merged[0].isCustom).toBeUndefined();
    });

    it('should handle empty arrays', () => {
      expect(mergeStrategies([], [])).toEqual([]);
    });

    it('should handle only custom strategies', () => {
      const custom: PromptStrategy[] = [
        makeStrategy({ id: 'custom-only' }),
      ];
      const merged = mergeStrategies([], custom);
      expect(merged).toHaveLength(1);
      expect(merged[0].isCustom).toBe(true);
    });

    it('should preserve order: built-in first, then custom', () => {
      const builtIn: PromptStrategy[] = [
        makeStrategy({ id: 'b1' }),
        makeStrategy({ id: 'b2' }),
      ];
      const custom: PromptStrategy[] = [
        makeStrategy({ id: 'c1' }),
        makeStrategy({ id: 'c2' }),
      ];
      const merged = mergeStrategies(builtIn, custom);
      expect(merged.map((s) => s.id)).toEqual(['b1', 'b2', 'c1', 'c2']);
    });
  });

  describe('custom strategies have isCustom flag', () => {
    it('loadCustomStrategies always sets isCustom: true', () => {
      const strategy = makeStrategy({ id: 'flag-test' });
      delete (strategy as any).isCustom;
      saveCustomStrategies([strategy]);
      const loaded = loadCustomStrategies();
      expect(loaded[0].isCustom).toBe(true);
    });

    it('mergeStrategies always sets isCustom: true on custom entries', () => {
      const custom = [makeStrategy({ id: 'merge-flag' })];
      const merged = mergeStrategies([], custom);
      expect(merged[0].isCustom).toBe(true);
    });
  });
});
