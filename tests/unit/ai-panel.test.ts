/**
 * Tests for the parseAIResponse function from AIAssistPanel.
 */

import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ui/AIAssistPanel';

describe('parseAIResponse', () => {
  it('parses prose-only response', () => {
    const blocks = parseAIResponse('The map looks well-curated. No changes needed.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('prose');
    expect(blocks[0].content).toBe('The map looks well-curated. No changes needed.');
  });

  it('parses a single DSL block with surrounding prose', () => {
    const text = `I see an inversion in chr3. Here's the fix:

\`\`\`dsl
invert chr3
\`\`\`

This should correct the orientation.`;

    const blocks = parseAIResponse(text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('prose');
    expect(blocks[0].content).toContain('inversion');
    expect(blocks[1].type).toBe('dsl');
    expect(blocks[1].content).toBe('invert chr3');
    expect(blocks[2].type).toBe('prose');
    expect(blocks[2].content).toContain('correct the orientation');
  });

  it('parses multiple DSL blocks', () => {
    const text = `First, fix the inversion:

\`\`\`dsl
invert chr3
\`\`\`

Then reorder:

\`\`\`dsl
move chr5 before chr2
\`\`\`

Done.`;

    const blocks = parseAIResponse(text);
    expect(blocks).toHaveLength(5);
    expect(blocks[0].type).toBe('prose');
    expect(blocks[1].type).toBe('dsl');
    expect(blocks[1].content).toBe('invert chr3');
    expect(blocks[2].type).toBe('prose');
    expect(blocks[3].type).toBe('dsl');
    expect(blocks[3].content).toBe('move chr5 before chr2');
    expect(blocks[4].type).toBe('prose');
  });

  it('handles code block without dsl language tag', () => {
    const text = `Try this:

\`\`\`
invert #0
\`\`\``;

    const blocks = parseAIResponse(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe('dsl');
    expect(blocks[1].content).toBe('invert #0');
  });

  it('handles multi-line DSL blocks', () => {
    const text = `Here are several operations:

\`\`\`dsl
invert chr3
move chr5 after chr1
join chr2 chr3
\`\`\``;

    const blocks = parseAIResponse(text);
    const dslBlock = blocks.find((b) => b.type === 'dsl');
    expect(dslBlock).toBeDefined();
    expect(dslBlock!.content).toContain('invert chr3');
    expect(dslBlock!.content).toContain('move chr5 after chr1');
    expect(dslBlock!.content).toContain('join chr2 chr3');
  });

  it('handles empty input', () => {
    const blocks = parseAIResponse('');
    expect(blocks).toHaveLength(0);
  });

  it('filters out empty blocks between consecutive fences', () => {
    const text = `\`\`\`dsl
invert chr1
\`\`\`
\`\`\`dsl
invert chr2
\`\`\``;

    const blocks = parseAIResponse(text);
    const dslBlocks = blocks.filter((b) => b.type === 'dsl');
    expect(dslBlocks).toHaveLength(2);
    expect(dslBlocks[0].content).toBe('invert chr1');
    expect(dslBlocks[1].content).toBe('invert chr2');
  });
});
