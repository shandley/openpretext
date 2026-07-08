import { describe, it, expect } from 'vitest';
import { parseLine } from '../../src/scripting/ScriptParser';
import { DSL_REFERENCE, type DSLCommandDoc } from '../../src/scripting/DSLReference';

/**
 * The keywords the parser's `parseLine` switch recognizes. Kept explicit here
 * so that adding a parser command without documenting it fails this test.
 */
const PARSER_KEYWORDS = [
  'cut',
  'join',
  'invert',
  'move',
  'select',
  'deselect',
  'scaffold',
  'zoom',
  'goto',
  'echo',
  'autocut',
  'autosort',
] as const;

const VALID_CATEGORIES: DSLCommandDoc['category'][] = [
  'Curation',
  'Selection',
  'Scaffold',
  'Navigation',
  'Meta',
];

/** First whitespace-delimited token of an example, lowercased. */
function leadingKeyword(example: string): string {
  return example.trim().split(/\s+/)[0].toLowerCase();
}

describe('DSL_REFERENCE', () => {
  it('has at least one entry', () => {
    expect(DSL_REFERENCE.length).toBeGreaterThan(0);
  });

  it('every entry has valid shape', () => {
    for (const entry of DSL_REFERENCE) {
      expect(VALID_CATEGORIES).toContain(entry.category);
      expect(typeof entry.syntax).toBe('string');
      expect(entry.syntax.trim().length).toBeGreaterThan(0);
      expect(typeof entry.summary).toBe('string');
      expect(entry.summary.trim().length).toBeGreaterThan(0);
      expect(typeof entry.example).toBe('string');
      expect(entry.example.trim().length).toBeGreaterThan(0);
    }
  });

  it('every example parses without throwing and yields a non-null command', () => {
    for (const entry of DSL_REFERENCE) {
      let cmd: ReturnType<typeof parseLine>;
      expect(() => {
        cmd = parseLine(entry.example);
      }, `example failed to parse: '${entry.example}'`).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(cmd!, `example produced null command: '${entry.example}'`).not.toBeNull();
    }
  });

  it('documents every keyword the parser recognizes', () => {
    const documented = new Set(DSL_REFERENCE.map(e => leadingKeyword(e.example)));
    for (const keyword of PARSER_KEYWORDS) {
      expect(
        documented.has(keyword),
        `parser keyword '${keyword}' is not covered by any DSL_REFERENCE example`
      ).toBe(true);
    }
  });

  it('does not document keywords the parser does not recognize', () => {
    const known = new Set<string>(PARSER_KEYWORDS);
    for (const entry of DSL_REFERENCE) {
      const keyword = leadingKeyword(entry.example);
      expect(
        known.has(keyword),
        `example uses keyword '${keyword}' not recognized by the parser: '${entry.example}'`
      ).toBe(true);
    }
  });
});
