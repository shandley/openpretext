/**
 * Tests for src/ai/AIStrategyIO.ts — strategy export/import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportStrategyAsJSON,
  exportAllCustomStrategies,
  parseImportedStrategies,
} from '../../src/ai/AIStrategyIO';
import type { PromptStrategy } from '../../src/data/PromptStrategy';

function makeStrategy(overrides: Partial<PromptStrategy> = {}): PromptStrategy {
  return {
    id: 'test-strategy',
    name: 'Test Strategy',
    description: 'A test strategy',
    category: 'general',
    supplement: 'Test supplement text',
    examples: [],
    ...overrides,
  };
}

describe('AIStrategyIO', () => {
  describe('parseImportedStrategies', () => {
    it('parses a valid single strategy JSON', () => {
      const strategy = makeStrategy();
      const json = JSON.stringify(strategy);
      const result = parseImportedStrategies(json);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-strategy');
      expect(result[0].name).toBe('Test Strategy');
      expect(result[0].supplement).toBe('Test supplement text');
    });

    it('parses a valid strategies array format', () => {
      const payload = {
        version: '1.0.0',
        strategies: [
          makeStrategy({ id: 'strat-1', name: 'Strategy 1' }),
          makeStrategy({ id: 'strat-2', name: 'Strategy 2' }),
        ],
      };
      const result = parseImportedStrategies(JSON.stringify(payload));
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('strat-1');
      expect(result[1].id).toBe('strat-2');
    });

    it('sets isCustom: true on all imported strategies', () => {
      const strategy = makeStrategy({ isCustom: false });
      const result = parseImportedStrategies(JSON.stringify(strategy));
      expect(result[0].isCustom).toBe(true);
    });

    it('sets isCustom: true even when not present in source', () => {
      const json = JSON.stringify({
        id: 'no-custom-field',
        name: 'No Custom',
        supplement: 'text',
      });
      const result = parseImportedStrategies(json);
      expect(result[0].isCustom).toBe(true);
    });

    it('prefixes ID with "imported-" when it conflicts with a built-in ID', () => {
      const result = parseImportedStrategies(
        JSON.stringify(makeStrategy({ id: 'general' })),
      );
      expect(result[0].id).toBe('imported-general');
    });

    it('prefixes conflicting built-in IDs for all known built-ins', () => {
      const builtInIds = [
        'general',
        'inversion-focus',
        'scaffolding',
        'fragmented-assembly',
        'micro-chromosomes',
      ];
      for (const id of builtInIds) {
        const result = parseImportedStrategies(
          JSON.stringify(makeStrategy({ id })),
        );
        expect(result[0].id).toBe(`imported-${id}`);
      }
    });

    it('does not prefix non-conflicting IDs', () => {
      const result = parseImportedStrategies(
        JSON.stringify(makeStrategy({ id: 'my-custom-strategy' })),
      );
      expect(result[0].id).toBe('my-custom-strategy');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseImportedStrategies('not json {')).toThrow('Invalid JSON');
    });

    it('throws on non-object JSON', () => {
      expect(() => parseImportedStrategies('"just a string"')).toThrow(
        'Invalid JSON: expected an object',
      );
    });

    it('throws on null JSON', () => {
      expect(() => parseImportedStrategies('null')).toThrow(
        'Invalid JSON: expected an object',
      );
    });

    it('throws when required field "id" is missing', () => {
      const json = JSON.stringify({
        strategies: [{ name: 'No ID', supplement: 'text' }],
      });
      expect(() => parseImportedStrategies(json)).toThrow('missing required field "id"');
    });

    it('throws when required field "name" is missing', () => {
      const json = JSON.stringify({
        strategies: [{ id: 'no-name', supplement: 'text' }],
      });
      expect(() => parseImportedStrategies(json)).toThrow('missing required field "name"');
    });

    it('throws when required field "supplement" is missing', () => {
      const json = JSON.stringify({
        strategies: [{ id: 'no-supp', name: 'No Supplement' }],
      });
      expect(() => parseImportedStrategies(json)).toThrow('missing required field "supplement"');
    });

    it('throws on object without id or strategies', () => {
      const json = JSON.stringify({ foo: 'bar' });
      expect(() => parseImportedStrategies(json)).toThrow('Invalid format');
    });

    it('defaults category to "general" when invalid', () => {
      const json = JSON.stringify(
        makeStrategy({ category: 'invalid' as any }),
      );
      const result = parseImportedStrategies(json);
      expect(result[0].category).toBe('general');
    });

    it('preserves valid category values', () => {
      for (const cat of ['general', 'pattern', 'workflow', 'organism'] as const) {
        const json = JSON.stringify(makeStrategy({ category: cat }));
        const result = parseImportedStrategies(json);
        expect(result[0].category).toBe(cat);
      }
    });

    it('defaults description to empty string when missing', () => {
      const json = JSON.stringify({
        id: 'no-desc',
        name: 'No Desc',
        supplement: 'text',
      });
      const result = parseImportedStrategies(json);
      expect(result[0].description).toBe('');
    });

    it('defaults examples to empty array when missing', () => {
      const json = JSON.stringify({
        id: 'no-examples',
        name: 'No Examples',
        supplement: 'text',
      });
      const result = parseImportedStrategies(json);
      expect(result[0].examples).toEqual([]);
    });

    it('preserves examples when present', () => {
      const strategy = makeStrategy({
        examples: [{ scenario: 'test scenario', commands: 'invert chr1' }],
      });
      const result = parseImportedStrategies(JSON.stringify(strategy));
      expect(result[0].examples).toHaveLength(1);
      expect(result[0].examples[0].scenario).toBe('test scenario');
      expect(result[0].examples[0].commands).toBe('invert chr1');
    });
  });

  describe('exportStrategyAsJSON', () => {
    let mockClick: ReturnType<typeof vi.fn>;
    let mockAppendChild: ReturnType<typeof vi.fn>;
    let mockRemoveChild: ReturnType<typeof vi.fn>;
    let capturedDownload: string;
    let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockClick = vi.fn();
      capturedDownload = '';
      mockAnchor = { href: '', download: '', click: mockClick };

      mockClick.mockImplementation(() => {
        capturedDownload = mockAnchor.download;
      });

      // Set up minimal DOM globals for the export functions
      const origDoc = globalThis.document;
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;

      mockAppendChild = globalThis.document.body.appendChild as any;
      mockRemoveChild = globalThis.document.body.removeChild as any;

      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      globalThis.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // document will be cleaned up since it's replaced per test
    });

    it('creates a download link with correct filename', () => {
      const strategy = makeStrategy({ id: 'my-strat' });
      exportStrategyAsJSON(strategy);

      expect(mockClick).toHaveBeenCalled();
      expect(capturedDownload).toBe('strategy-my-strat.json');
      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();
    });

    it('creates a Blob with correct JSON content', () => {
      const strategy = makeStrategy();
      exportStrategyAsJSON(strategy);

      const createObjectURL = globalThis.URL.createObjectURL as ReturnType<typeof vi.fn>;
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');
    });

    it('revokes the object URL after download', () => {
      const strategy = makeStrategy();
      exportStrategyAsJSON(strategy);

      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  describe('exportAllCustomStrategies', () => {
    let mockClick: ReturnType<typeof vi.fn>;
    let capturedDownload: string;
    let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockClick = vi.fn();
      capturedDownload = '';
      mockAnchor = { href: '', download: '', click: mockClick };

      mockClick.mockImplementation(() => {
        capturedDownload = mockAnchor.download;
      });

      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      } as any;

      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
      globalThis.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('exports with filename custom-strategies.json', () => {
      exportAllCustomStrategies([makeStrategy()]);

      expect(mockClick).toHaveBeenCalled();
      expect(capturedDownload).toBe('custom-strategies.json');
    });

    it('creates a Blob with correct type', () => {
      const strategies = [
        makeStrategy({ id: 's1' }),
        makeStrategy({ id: 's2' }),
      ];
      exportAllCustomStrategies(strategies);

      const createObjectURL = globalThis.URL.createObjectURL as ReturnType<typeof vi.fn>;
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');
    });

    it('revokes the object URL after download', () => {
      exportAllCustomStrategies([makeStrategy()]);
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });
  });
});
